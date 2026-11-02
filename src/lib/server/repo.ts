import type Database from "better-sqlite3";
import { getDb } from "../db/client";
import type { AttributeKey, RoomInput } from "../engine/types";
import type { QuestionnaireData } from "../domain/questionnaire";

type DB = Database.Database;

export type GroupStatus = "draft" | "collecting" | "ready" | "proposed" | "voting" | "approved" | "finalized";
export const STATUS_ORDER: GroupStatus[] = ["draft", "collecting", "ready", "proposed", "voting", "approved", "finalized"];
export const STATUS_LABELS: Record<GroupStatus, string> = {
  draft: "Draft",
  collecting: "Collecting preferences",
  ready: "Ready to optimize",
  proposed: "Proposed",
  voting: "Voting",
  approved: "Approved",
  finalized: "Finalized",
};

export interface UserRow { id: string; display_name: string; email: string | null; is_demo: number; created_at: string }
export interface GroupRow {
  id: string; stay_id: string; name: string; organizer_user_id: string; status: GroupStatus; max_parties: number;
  max_party_size: number; approval_policy: "unanimous" | "majority"; is_demo: number; version: number; created_at: string;
}
export interface PropertyRow {
  id: string; name: string; location: string; description: string; currency: string; source_kind: string;
  listing_url: string | null; shared_amenities_json: string;
}
export interface RoomRow {
  id: string; property_id: string; name: string; short_name: string; sort: number; bed_config: string; capacity: number;
  bed_count: number; has_bunk: number; accessible: number; weight_milli: number; quality_rating: number;
  attributes_json: string; image_key: string; description: string;
}
export interface PartyRow {
  id: string; group_id: string; slot_label: string; name: string; sort: number; representative_user_id: string | null;
  status: "open" | "active" | "left"; created_at: string;
}
export interface MembershipRow { id: string; party_id: string; group_id: string; user_id: string; role: string; joined_at: string; left_at: string | null }
export interface InvitationRow {
  id: string; group_id: string; party_id: string | null; label: string; token_hash: string; token_enc: string; created_by: string;
  created_at: string; expires_at: string; revoked_at: string | null; max_uses: number | null; uses: number;
}

export const db = () => getDb();

export function getUser(id: string, d: DB = db()): UserRow | undefined {
  return d.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
}
export function getGroup(id: string, d: DB = db()): GroupRow | undefined {
  return d.prepare("SELECT * FROM groups WHERE id = ?").get(id) as GroupRow | undefined;
}
export function getPropertyForGroup(groupId: string, d: DB = db()): PropertyRow {
  return d
    .prepare("SELECT p.* FROM properties p JOIN stays s ON s.property_id = p.id JOIN groups g ON g.stay_id = s.id WHERE g.id = ?")
    .get(groupId) as PropertyRow;
}
export function getStayForGroup(groupId: string, d: DB = db()) {
  return d.prepare("SELECT s.* FROM stays s JOIN groups g ON g.stay_id = s.id WHERE g.id = ?").get(groupId) as {
    id: string; property_id: string; check_in: string | null; check_out: string | null;
  };
}
export function listRooms(propertyId: string, d: DB = db()): RoomRow[] {
  return d.prepare("SELECT * FROM rooms WHERE property_id = ? ORDER BY sort, id").all(propertyId) as RoomRow[];
}
export function listAmenities(roomIds: string[], d: DB = db()) {
  if (roomIds.length === 0) return [] as { id: string; room_id: string; label: string; icon: string; sort: number }[];
  return d
    .prepare(`SELECT * FROM room_amenities WHERE room_id IN (${roomIds.map(() => "?").join(",")}) ORDER BY sort`)
    .all(...roomIds) as { id: string; room_id: string; label: string; icon: string; sort: number }[];
}
export function listCostItems(propertyId: string, d: DB = db()) {
  return d.prepare("SELECT * FROM property_cost_items WHERE property_id = ? ORDER BY sort, id").all(propertyId) as {
    id: string; property_id: string; label: string; kind: string; amount_cents: number; sort: number;
  }[];
}
export function totalCents(propertyId: string, d: DB = db()): number {
  return (d.prepare("SELECT COALESCE(SUM(amount_cents),0) t FROM property_cost_items WHERE property_id = ?").get(propertyId) as { t: number }).t;
}
export function getPricing(groupId: string, d: DB = db()) {
  return d.prepare("SELECT * FROM pricing_configurations WHERE group_id = ?").get(groupId) as {
    id: string; group_id: string; shared_bps: number; method: "weighted" | "hybrid" | "auction"; version: number; updated_at: string;
  };
}
export function listParties(groupId: string, d: DB = db(), includeLeft = false): PartyRow[] {
  return d
    .prepare(`SELECT * FROM parties WHERE group_id = ? ${includeLeft ? "" : "AND status != 'left'"} ORDER BY sort, created_at, id`)
    .all(groupId) as PartyRow[];
}
export function getParty(id: string, d: DB = db()): PartyRow | undefined {
  return d.prepare("SELECT * FROM parties WHERE id = ?").get(id) as PartyRow | undefined;
}
export function activeMembers(partyId: string, d: DB = db()) {
  return d
    .prepare(
      "SELECT m.*, u.display_name FROM party_memberships m JOIN users u ON u.id = m.user_id WHERE m.party_id = ? AND m.left_at IS NULL ORDER BY m.joined_at, m.id",
    )
    .all(partyId) as (MembershipRow & { display_name: string })[];
}
export function membershipFor(groupId: string, userId: string, d: DB = db()) {
  return d.prepare("SELECT * FROM party_memberships WHERE group_id = ? AND user_id = ? AND left_at IS NULL").get(groupId, userId) as
    | MembershipRow
    | undefined;
}
export function getPreferences(partyId: string, d: DB = db()) {
  const row = d.prepare("SELECT * FROM party_preferences WHERE party_id = ?").get(partyId) as
    | { id: string; party_id: string; data_json: string; finalized_by: string; finalized_at: string; version: number }
    | undefined;
  return row ? { ...row, data: JSON.parse(row.data_json) as QuestionnaireData } : undefined;
}
export function listDrafts(partyId: string, d: DB = db()) {
  return (
    d
      .prepare(
        "SELECT q.*, u.display_name FROM questionnaires q JOIN users u ON u.id = q.user_id WHERE q.party_id = ? ORDER BY q.updated_at",
      )
      .all(partyId) as { id: string; party_id: string; user_id: string; data_json: string; updated_at: string; shared_at: string | null; display_name: string }[]
  ).map((r) => ({ ...r, data: JSON.parse(r.data_json) as QuestionnaireData }));
}

export function roomRowToInput(r: RoomRow): RoomInput {
  return {
    id: r.id,
    name: r.name,
    capacity: r.capacity,
    bedCount: r.bed_count,
    hasBunk: !!r.has_bunk,
    accessible: !!r.accessible,
    weightMilli: r.weight_milli,
    attributes: JSON.parse(r.attributes_json) as Record<AttributeKey, number>,
    sort: r.sort,
  };
}

export function logActivity(d: DB, groupId: string, userId: string | null, type: string, message: string, data: unknown = {}) {
  d.prepare("INSERT INTO activity_events (id, group_id, user_id, type, message, data_json) VALUES (?, ?, ?, ?, ?, ?)").run(
    `evt_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`,
    groupId,
    userId,
    type,
    message,
    JSON.stringify(data),
  );
}

export function bumpVersion(d: DB, groupId: string) {
  d.prepare("UPDATE groups SET version = version + 1 WHERE id = ?").run(groupId);
}
