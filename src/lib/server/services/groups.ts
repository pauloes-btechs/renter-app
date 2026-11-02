import type Database from "better-sqlite3";
import { z } from "zod";
import { tx } from "../../db/client";
import { DEMO_PROPERTY, DEMO_ROOMS, type RoomTemplate } from "../../demo/fixture";
import { ATTRIBUTE_KEYS } from "../../engine/types";
import { newId } from "../crypto";
import { AppError, forbid, invalid, notFound } from "../errors";
import {
  activeMembers,
  bumpVersion,
  getGroup,
  getPreferences,
  getPropertyForGroup,
  listParties,
  listRooms,
  logActivity,
  type GroupRow,
  type GroupStatus,
} from "../repo";
import { createSession, createUser } from "./auth";
import { syncApproval } from "./allocation";

type DB = Database.Database;

export const METHOD_LABELS = {
  weighted: "Weighted (fixed room weights)",
  hybrid: "Weighted + auction comparison",
  auction: "Auction-led price discovery",
} as const;

export function slotLabel(i: number) {
  return `Party ${String.fromCharCode(65 + (i % 26))}${i >= 26 ? Math.floor(i / 26) : ""}`;
}

export function requireGroup(d: DB, groupId: string): GroupRow {
  const g = getGroup(groupId, d);
  if (!g) throw notFound("Group not found.");
  return g;
}

export function requireOrganizer(d: DB, groupId: string, actorId: string): GroupRow {
  const g = requireGroup(d, groupId);
  if (g.organizer_user_id !== actorId) throw forbid("Only the organizer can do that.");
  return g;
}

export function assertNotFinalized(g: GroupRow) {
  if (g.status === "finalized") throw new AppError("locked", "This agreement is finalized. Reopen it before making changes.");
}

export const createGroupSchema = z.object({
  organizerName: z.string().trim().min(1).max(40),
  groupName: z.string().trim().min(1).max(80),
  propertyName: z.string().trim().min(1).max(80),
  totalCents: z.number().int().min(100).max(100_000_000),
  currency: z.string().length(3).default("USD"),
  partyCount: z.number().int().min(1).max(26),
  maxPartySize: z.number().int().min(1).max(12),
  sharedBps: z.number().int().min(0).max(10000).default(4000),
  organizerJoins: z.boolean().default(true),
  organizerPartyName: z.string().trim().max(60).optional(),
});
export type CreateGroupInput = z.infer<typeof createGroupSchema>;

export function insertRoomFromTemplate(d: DB, propertyId: string, t: RoomTemplate, sort: number): string {
  const id = newId("room");
  d.prepare(
    `INSERT INTO rooms (id, property_id, name, short_name, sort, bed_config, capacity, bed_count, has_bunk, accessible, weight_milli,
      quality_rating, attributes_json, image_key, description) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    id, propertyId, t.name, t.shortName, sort, t.bedConfig, t.capacity, t.bedCount, t.hasBunk ? 1 : 0, t.accessible ? 1 : 0,
    t.weightMilli, t.qualityRating, JSON.stringify(t.attributes), t.imageKey, t.description,
  );
  t.amenities.forEach((a, i) => d.prepare("INSERT INTO room_amenities (id, room_id, label, icon, sort) VALUES (?,?,?,?,?)").run(newId("amn"), id, a.label, a.icon, i));
  return id;
}

/**
 * Creates the organizer (if needed), the property (seeded with the demo house template), the stay,
 * the group, pricing config and empty party slots. The organizer optionally takes Party A.
 */
export function createGroup(raw: CreateGroupInput, existingUserId?: string | null, opts: { isDemo?: boolean } = {}) {
  const input = createGroupSchema.parse(raw);
  return tx((d) => {
    const userId = existingUserId ?? createUser(d, input.organizerName, { isDemo: opts.isDemo });
    const sessionToken = existingUserId ? null : createSession(d, userId);
    const propertyId = newId("prop");
    d.prepare("INSERT INTO properties (id, name, location, description, currency, shared_amenities_json) VALUES (?,?,?,?,?,?)").run(
      propertyId, input.propertyName, DEMO_PROPERTY.location, DEMO_PROPERTY.description, input.currency, JSON.stringify(DEMO_PROPERTY.sharedAmenities),
    );
    d.prepare("INSERT INTO property_cost_items (id, property_id, label, kind, amount_cents, sort) VALUES (?,?,?,?,?,0)").run(
      newId("cost"), propertyId, "Entire stay", "base", input.totalCents,
    );
    DEMO_ROOMS.forEach((t, i) => insertRoomFromTemplate(d, propertyId, t, i));
    const stayId = newId("stay");
    d.prepare("INSERT INTO stays (id, property_id, check_in, check_out) VALUES (?,?,?,?)").run(stayId, propertyId, DEMO_PROPERTY.checkIn, DEMO_PROPERTY.checkOut);
    const groupId = newId("grp");
    d.prepare(
      "INSERT INTO groups (id, stay_id, name, organizer_user_id, status, max_parties, max_party_size, is_demo) VALUES (?,?,?,?,?,?,?,?)",
    ).run(groupId, stayId, input.groupName, userId, "draft", input.partyCount, input.maxPartySize, opts.isDemo ? 1 : 0);
    d.prepare("INSERT INTO pricing_configurations (id, group_id, shared_bps) VALUES (?,?,?)").run(newId("prc"), groupId, input.sharedBps);
    const partyIds: string[] = [];
    for (let i = 0; i < input.partyCount; i++) {
      const pid = newId("pty");
      d.prepare("INSERT INTO parties (id, group_id, slot_label, name, sort, status) VALUES (?,?,?,?,?, 'open')").run(pid, groupId, slotLabel(i), slotLabel(i), i);
      partyIds.push(pid);
    }
    if (input.organizerJoins) {
      const pid = partyIds[0];
      d.prepare("INSERT INTO party_memberships (id, party_id, group_id, user_id, role) VALUES (?,?,?,?, 'representative')").run(newId("mem"), pid, groupId, userId);
      d.prepare("UPDATE parties SET status='active', representative_user_id=?, name=? WHERE id=?").run(
        userId, input.organizerPartyName || input.organizerName, pid,
      );
    }
    logActivity(d, groupId, userId, "group.created", `${input.organizerName} created the group`);
    return { groupId, userId, sessionToken, partyIds };
  });
}

/** Recompute pre-proposal statuses from data. Post-proposal statuses are driven by explicit actions. */
export function recomputeStatus(d: DB, groupId: string): GroupStatus {
  const g = requireGroup(d, groupId);
  if (!["collecting", "ready"].includes(g.status)) return g.status;
  const parties = listParties(groupId, d);
  const complete = parties.length > 0 && parties.every((p) => p.status === "active" && !!getPreferences(p.id, d));
  const next: GroupStatus = complete ? "ready" : "collecting";
  if (next !== g.status) d.prepare("UPDATE groups SET status = ? WHERE id = ?").run(next, groupId);
  return next;
}

/**
 * A material change (price, rooms, membership, preferences) invalidates any current proposal version
 * and all live votes, then returns the group to collecting/ready.
 */
export function materialChange(d: DB, groupId: string, actorId: string | null, reason: string) {
  const g = requireGroup(d, groupId);
  assertNotFinalized(g);
  const now = new Date().toISOString();
  const current = d.prepare("SELECT id FROM proposal_versions WHERE group_id = ? AND status = 'current'").get(groupId) as { id: string } | undefined;
  if (current) {
    d.prepare("UPDATE proposal_versions SET status='stale', stale_reason=? WHERE id=?").run(reason, current.id);
    const n = d
      .prepare(
        `UPDATE votes SET invalidated_at=?, invalidated_reason=? WHERE invalidated_at IS NULL AND proposal_id IN
         (SELECT id FROM allocation_proposals WHERE version_id = ?)`,
      )
      .run(now, reason, current.id).changes;
    logActivity(d, groupId, actorId, "proposal.stale", `Proposal marked out of date: ${reason}${n ? ` (${n} approval${n === 1 ? "" : "s"} cleared)` : ""}`);
  }
  if (["proposed", "voting", "approved"].includes(g.status)) {
    d.prepare("UPDATE groups SET status='collecting' WHERE id=?").run(groupId);
  }
  recomputeStatus(d, groupId);
  bumpVersion(d, groupId);
}

export function startCollecting(actorId: string, groupId: string) {
  return tx((d) => {
    const g = requireOrganizer(d, groupId, actorId);
    if (g.status !== "draft") return;
    d.prepare("UPDATE groups SET status='collecting' WHERE id=?").run(groupId);
    recomputeStatus(d, groupId);
    logActivity(d, groupId, actorId, "group.collecting", "Property confirmed — collecting preferences");
    bumpVersion(d, groupId);
  });
}

export const propertyDetailsSchema = z.object({
  name: z.string().trim().min(1).max(80),
  location: z.string().trim().max(120).default(""),
  description: z.string().trim().max(1000).default(""),
  currency: z.string().regex(/^[A-Z]{3}$/),
  listingUrl: z.string().trim().max(500).optional().or(z.literal("")),
  sharedAmenities: z.array(z.string().trim().min(1).max(60)).max(30),
  checkIn: z.string().optional().or(z.literal("")),
  checkOut: z.string().optional().or(z.literal("")),
});

export function updatePropertyDetails(actorId: string, groupId: string, raw: z.input<typeof propertyDetailsSchema>) {
  const input = propertyDetailsSchema.parse(raw);
  return tx((d) => {
    const g = requireOrganizer(d, groupId, actorId);
    assertNotFinalized(g);
    const p = getPropertyForGroup(groupId, d);
    const currencyChanged = p.currency !== input.currency;
    d.prepare("UPDATE properties SET name=?, location=?, description=?, currency=?, listing_url=?, shared_amenities_json=? WHERE id=?").run(
      input.name, input.location, input.description, input.currency, input.listingUrl || null, JSON.stringify(input.sharedAmenities), p.id,
    );
    d.prepare("UPDATE stays SET check_in=?, check_out=? WHERE property_id=?").run(input.checkIn || null, input.checkOut || null, p.id);
    logActivity(d, groupId, actorId, "property.updated", "Property details updated");
    if (currencyChanged) materialChange(d, groupId, actorId, "currency changed");
    else bumpVersion(d, groupId);
  });
}

export const costItemsSchema = z
  .array(
    z.object({
      label: z.string().trim().min(1).max(60),
      kind: z.enum(["base", "cleaning", "tax", "service", "other"]),
      amountCents: z.number().int().min(0).max(100_000_000),
    }),
  )
  .min(1)
  .max(12);

export function setCostItems(actorId: string, groupId: string, raw: z.input<typeof costItemsSchema>) {
  const items = costItemsSchema.parse(raw);
  const total = items.reduce((a, i) => a + i.amountCents, 0);
  if (total <= 0) throw invalid("Total rental cost must be greater than zero.");
  return tx((d) => {
    const g = requireOrganizer(d, groupId, actorId);
    assertNotFinalized(g);
    const p = getPropertyForGroup(groupId, d);
    const before = (d.prepare("SELECT COALESCE(SUM(amount_cents),0) t FROM property_cost_items WHERE property_id=?").get(p.id) as { t: number }).t;
    const beforeItems = JSON.stringify(d.prepare("SELECT label, kind, amount_cents FROM property_cost_items WHERE property_id=? ORDER BY sort").all(p.id));
    d.prepare("DELETE FROM property_cost_items WHERE property_id=?").run(p.id);
    items.forEach((it, i) =>
      d.prepare("INSERT INTO property_cost_items (id, property_id, label, kind, amount_cents, sort) VALUES (?,?,?,?,?,?)").run(newId("cost"), p.id, it.label, it.kind, it.amountCents, i),
    );
    const afterItems = JSON.stringify(items.map((i) => ({ label: i.label, kind: i.kind, amount_cents: i.amountCents })));
    if (before !== total) {
      logActivity(d, groupId, actorId, "pricing.total", `Total rental cost changed to ${(total / 100).toFixed(2)}`);
      materialChange(d, groupId, actorId, "total rental cost changed");
    } else if (beforeItems !== afterItems) {
      logActivity(d, groupId, actorId, "pricing.items", "Cost line items relabelled (total unchanged)");
      bumpVersion(d, groupId);
    }
  });
}

export const pricingSchema = z.object({
  sharedBps: z.number().int().min(0).max(10000),
  method: z.enum(["weighted", "hybrid", "auction"]).optional(),
});

export function updatePricing(actorId: string, groupId: string, raw: z.input<typeof pricingSchema>) {
  const input = pricingSchema.parse(raw);
  return tx((d) => {
    const g = requireOrganizer(d, groupId, actorId);
    assertNotFinalized(g);
    const cur = d.prepare("SELECT shared_bps, method FROM pricing_configurations WHERE group_id=?").get(groupId) as { shared_bps: number; method: string };
    const method = input.method ?? cur.method;
    if (cur.shared_bps === input.sharedBps && cur.method === method) return;
    d.prepare("UPDATE pricing_configurations SET shared_bps=?, method=?, version=version+1, updated_at=? WHERE group_id=?").run(input.sharedBps, method, new Date().toISOString(), groupId);
    if (cur.shared_bps !== input.sharedBps)
      logActivity(d, groupId, actorId, "pricing.split", `Shared/private split changed to ${input.sharedBps / 100}% / ${(10000 - input.sharedBps) / 100}%`);
    if (cur.method !== method) logActivity(d, groupId, actorId, "pricing.method", `Pricing method set to ${METHOD_LABELS[method as keyof typeof METHOD_LABELS]}`);
    materialChange(d, groupId, actorId, cur.method !== method ? "pricing method changed" : "pricing split changed");
  });
}

const attrShape = Object.fromEntries(ATTRIBUTE_KEYS.map((k) => [k, z.number().min(0).max(1)])) as Record<(typeof ATTRIBUTE_KEYS)[number], z.ZodNumber>;
export const roomSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1).max(60),
  shortName: z.string().trim().max(30).default(""),
  bedConfig: z.string().trim().max(60).default(""),
  capacity: z.number().int().min(1).max(12),
  bedCount: z.number().int().min(1).max(12),
  hasBunk: z.boolean(),
  accessible: z.boolean(),
  weightMilli: z.number().int().min(0).max(10_000),
  qualityRating: z.number().int().min(1).max(5),
  description: z.string().trim().max(500).default(""),
  imageKey: z.enum(["master", "view", "comfort", "bunk", "generic"]).default("generic"),
  attributes: z.object(attrShape),
  amenities: z.array(z.string().trim().min(1).max(60)).max(12).default([]),
});
export type RoomEdit = z.input<typeof roomSchema>;

export function upsertRoom(actorId: string, groupId: string, raw: RoomEdit) {
  const r = roomSchema.parse(raw);
  return tx((d) => {
    const g = requireOrganizer(d, groupId, actorId);
    assertNotFinalized(g);
    const p = getPropertyForGroup(groupId, d);
    let id = r.id;
    if (id) {
      const existing = d.prepare("SELECT id FROM rooms WHERE id=? AND property_id=?").get(id, p.id);
      if (!existing) throw notFound("Room not found in this property.");
      d.prepare(
        `UPDATE rooms SET name=?, short_name=?, bed_config=?, capacity=?, bed_count=?, has_bunk=?, accessible=?, weight_milli=?,
         quality_rating=?, description=?, image_key=?, attributes_json=? WHERE id=?`,
      ).run(r.name, r.shortName, r.bedConfig, r.capacity, r.bedCount, r.hasBunk ? 1 : 0, r.accessible ? 1 : 0, r.weightMilli, r.qualityRating, r.description, r.imageKey, JSON.stringify(r.attributes), id);
      d.prepare("DELETE FROM room_amenities WHERE room_id=?").run(id);
    } else {
      const sort = (d.prepare("SELECT COALESCE(MAX(sort),-1)+1 s FROM rooms WHERE property_id=?").get(p.id) as { s: number }).s;
      id = insertRoomFromTemplate(
        d,
        p.id,
        {
          key: "custom", name: r.name, shortName: r.shortName || `Bedroom ${sort + 1}`, bedConfig: r.bedConfig, capacity: r.capacity,
          bedCount: r.bedCount, hasBunk: r.hasBunk, accessible: r.accessible, weightMilli: r.weightMilli, qualityRating: r.qualityRating,
          description: r.description, imageKey: r.imageKey, attributes: r.attributes, amenities: [],
        },
        sort,
      );
    }
    r.amenities.forEach((a, i) => d.prepare("INSERT INTO room_amenities (id, room_id, label, icon, sort) VALUES (?,?,?,?,?)").run(newId("amn"), id, a, "dot", i));
    logActivity(d, groupId, actorId, "room.updated", `${r.name} ${raw.id ? "updated" : "added"}`);
    materialChange(d, groupId, actorId, `bedroom "${r.name}" changed`);
    return id!;
  });
}

export function deleteRoom(actorId: string, groupId: string, roomId: string) {
  return tx((d) => {
    const g = requireOrganizer(d, groupId, actorId);
    assertNotFinalized(g);
    const p = getPropertyForGroup(groupId, d);
    const rooms = listRooms(p.id, d);
    if (rooms.length <= 1) throw invalid("A property needs at least one bedroom.");
    const room = rooms.find((r) => r.id === roomId);
    if (!room) throw notFound("Room not found.");
    // Proposals referencing this room become invalid; remove their assignments via cascade.
    materialChange(d, groupId, actorId, `bedroom "${room.name}" removed`);
    d.prepare("DELETE FROM rooms WHERE id=?").run(roomId);
    logActivity(d, groupId, actorId, "room.deleted", `${room.name} removed`);
  });
}

export const rulesSchema = z.object({
  name: z.string().trim().min(1).max(80),
  maxParties: z.number().int().min(1).max(26),
  maxPartySize: z.number().int().min(1).max(12),
  approvalPolicy: z.enum(["unanimous", "majority"]),
});

export function updateRules(actorId: string, groupId: string, raw: z.input<typeof rulesSchema>) {
  const r = rulesSchema.parse(raw);
  return tx((d) => {
    const g = requireOrganizer(d, groupId, actorId);
    assertNotFinalized(g);
    const parties = listParties(groupId, d);
    if (r.maxParties < parties.length) throw invalid(`There are already ${parties.length} party slots. Remove slots before lowering the limit.`);
    for (const p of parties) {
      const n = activeMembers(p.id, d).length;
      const pref = getPreferences(p.id, d);
      if (n > r.maxPartySize || (pref && pref.data.partySize > r.maxPartySize))
        throw invalid(`${p.name} already has more than ${r.maxPartySize} traveler(s).`);
    }
    d.prepare("UPDATE groups SET name=?, max_parties=?, max_party_size=?, approval_policy=? WHERE id=?").run(r.name, r.maxParties, r.maxPartySize, r.approvalPolicy, groupId);
    logActivity(d, groupId, actorId, "group.rules", "Group rules updated");
    if (g.approval_policy !== r.approvalPolicy) {
      logActivity(d, groupId, actorId, "group.policy", `Approval policy set to ${r.approvalPolicy}`);
      syncApproval(d, groupId);
    }
    bumpVersion(d, groupId);
  });
}
