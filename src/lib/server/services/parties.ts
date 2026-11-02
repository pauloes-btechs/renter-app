import type Database from "better-sqlite3";
import { z } from "zod";
import { getDb, tx } from "../../db/client";
import { decrypt, encrypt, hashToken, newId, randomToken } from "../crypto";
import { AppError, conflict, forbid, invalid, notFound } from "../errors";
import {
  activeMembers,
  bumpVersion,
  getGroup,
  getParty,
  getPreferences,
  listParties,
  logActivity,
  membershipFor,
  type InvitationRow,
} from "../repo";
import { createSession, createUser } from "./auth";
import { assertNotFinalized, materialChange, recomputeStatus, requireGroup, requireOrganizer, slotLabel } from "./groups";

type DB = Database.Database;
const DAY = 86_400_000;

export function addPartySlot(actorId: string, groupId: string, label?: string) {
  return tx((d) => {
    const g = requireOrganizer(d, groupId, actorId);
    assertNotFinalized(g);
    const parties = listParties(groupId, d);
    if (parties.length >= g.max_parties) throw invalid(`This group allows at most ${g.max_parties} parties.`);
    const all = listParties(groupId, d, true);
    const id = newId("pty");
    const slot = slotLabel(all.length);
    d.prepare("INSERT INTO parties (id, group_id, slot_label, name, sort, status) VALUES (?,?,?,?,?, 'open')").run(id, groupId, slot, label?.trim() || slot, all.length);
    logActivity(d, groupId, actorId, "party.added", `${slot} slot added`);
    materialChange(d, groupId, actorId, "a party slot was added");
    return id;
  });
}

/** Organizer removes a party (e.g. they dropped out). Memberships end, invites are revoked. */
export function removeParty(actorId: string, groupId: string, partyId: string) {
  return tx((d) => {
    const g = requireOrganizer(d, groupId, actorId);
    assertNotFinalized(g);
    const p = getParty(partyId, d);
    if (!p || p.group_id !== groupId || p.status === "left") throw notFound("Party not found.");
    const now = new Date().toISOString();
    d.prepare("UPDATE parties SET status='left' WHERE id=?").run(partyId);
    d.prepare("UPDATE party_memberships SET left_at=? WHERE party_id=? AND left_at IS NULL").run(now, partyId);
    d.prepare("UPDATE invitations SET revoked_at=? WHERE party_id=? AND revoked_at IS NULL").run(now, partyId);
    logActivity(d, groupId, actorId, "party.removed", `${p.name} left the trip`);
    materialChange(d, groupId, actorId, `${p.name} left the group`);
  });
}

export const inviteSchema = z.object({
  partyId: z.string().nullable(),
  label: z.string().trim().max(60).default(""),
  expiresInDays: z.number().int().min(1).max(90).default(14),
  maxUses: z.number().int().min(1).max(50).nullable().default(null),
});

/** Organizer can invite to any slot (or a general link); a representative can invite to their own party. */
export function createInvitation(actorId: string, groupId: string, raw: z.input<typeof inviteSchema>) {
  const input = inviteSchema.parse(raw);
  return tx((d) => {
    const g = requireGroup(d, groupId);
    assertNotFinalized(g);
    const isOrganizer = g.organizer_user_id === actorId;
    if (input.partyId) {
      const p = getParty(input.partyId, d);
      if (!p || p.group_id !== groupId || p.status === "left") throw notFound("Party not found.");
      if (!isOrganizer && p.representative_user_id !== actorId) throw forbid("Only the organizer or this party's representative can invite.");
    } else if (!isOrganizer) throw forbid("Only the organizer can create a general invitation link.");
    const token = randomToken(18);
    const id = newId("inv");
    d.prepare(
      "INSERT INTO invitations (id, group_id, party_id, label, token_hash, token_enc, created_by, expires_at, max_uses) VALUES (?,?,?,?,?,?,?,?,?)",
    ).run(id, groupId, input.partyId, input.label, hashToken(token), encrypt(token), actorId, new Date(Date.now() + input.expiresInDays * DAY).toISOString(), input.maxUses);
    if (g.status === "draft") {
      d.prepare("UPDATE groups SET status='collecting' WHERE id=?").run(groupId);
      recomputeStatus(d, groupId);
    }
    logActivity(d, groupId, actorId, "invite.created", input.partyId ? `Invitation created for ${getParty(input.partyId, d)!.name}` : "General invitation link created");
    bumpVersion(d, groupId);
    return { id, token };
  });
}

export function revokeInvitation(actorId: string, groupId: string, invitationId: string) {
  return tx((d) => {
    const g = requireGroup(d, groupId);
    const inv = d.prepare("SELECT * FROM invitations WHERE id=? AND group_id=?").get(invitationId, groupId) as InvitationRow | undefined;
    if (!inv) throw notFound("Invitation not found.");
    const party = inv.party_id ? getParty(inv.party_id, d) : undefined;
    if (g.organizer_user_id !== actorId && !(party && party.representative_user_id === actorId)) throw forbid();
    d.prepare("UPDATE invitations SET revoked_at=? WHERE id=? AND revoked_at IS NULL").run(new Date().toISOString(), invitationId);
    logActivity(d, groupId, actorId, "invite.revoked", "An invitation link was revoked");
    bumpVersion(d, groupId);
  });
}

export function invitationLinkToken(inv: InvitationRow): string {
  return decrypt(inv.token_enc);
}

export function listInvitations(actorId: string, groupId: string) {
  const d = getDb();
  const g = requireGroup(d, groupId);
  const rows = d.prepare("SELECT * FROM invitations WHERE group_id=? ORDER BY created_at DESC").all(groupId) as InvitationRow[];
  const isOrganizer = g.organizer_user_id === actorId;
  return rows
    .filter((r) => isOrganizer || (r.party_id && getParty(r.party_id, d)?.representative_user_id === actorId))
    .map((r) => ({ ...r, token: invitationLinkToken(r), active: inviteActive(r) }));
}

export function inviteActive(inv: InvitationRow) {
  return !inv.revoked_at && inv.expires_at > new Date().toISOString() && (inv.max_uses == null || inv.uses < inv.max_uses);
}

/** Public lookup for the join page. Reveals only what a holder of the link should see. */
export function resolveInvitation(token: string) {
  const d = getDb();
  const inv = d.prepare("SELECT * FROM invitations WHERE token_hash=?").get(hashToken(token)) as InvitationRow | undefined;
  if (!inv) return { ok: false as const, reason: "This invitation link is not valid." };
  if (inv.revoked_at) return { ok: false as const, reason: "This invitation link has been revoked. Ask the organizer for a new one." };
  if (inv.expires_at <= new Date().toISOString()) return { ok: false as const, reason: "This invitation link has expired. Ask the organizer for a new one." };
  if (inv.max_uses != null && inv.uses >= inv.max_uses) return { ok: false as const, reason: "This invitation link has already been used." };
  const g = getGroup(inv.group_id, d)!;
  if (g.status === "finalized") return { ok: false as const, reason: "This trip's agreement is already finalized." };
  const party = inv.party_id ? getParty(inv.party_id, d) : undefined;
  const parties = listParties(g.id, d).map((p) => ({ id: p.id, name: p.name, slot: p.slot_label, members: activeMembers(p.id, d).map((m) => m.display_name) }));
  return {
    ok: true as const,
    invitation: { id: inv.id, partyId: inv.party_id },
    group: { id: g.id, name: g.name, maxPartySize: g.max_party_size, maxParties: g.max_parties },
    party: party ? parties.find((p) => p.id === party.id)! : null,
    openParties: parties.filter((p) => p.members.length < g.max_party_size),
    canCreateParty: false,
  };
}

export const joinSchema = z.object({
  displayName: z.string().trim().min(1).max(40),
  partyId: z.string().optional(),
});

function assertUniqueName(d: DB, groupId: string, name: string, exceptUserId?: string) {
  const clash = d
    .prepare(
      `SELECT 1 FROM party_memberships m JOIN users u ON u.id = m.user_id
       WHERE m.group_id = ? AND m.left_at IS NULL AND lower(u.display_name) = lower(?) AND u.id != ?`,
    )
    .get(groupId, name, exceptUserId ?? "");
  const org = d.prepare("SELECT 1 FROM groups g JOIN users u ON u.id=g.organizer_user_id WHERE g.id=? AND lower(u.display_name)=lower(?) AND u.id != ?").get(groupId, name, exceptUserId ?? "");
  if (clash || org) throw conflict(`Someone in this group is already called "${name}". Please use a distinct display name.`);
}

/**
 * Join a party through an invitation. Runs in a single IMMEDIATE transaction so concurrent joins can
 * never exceed the party cap or create duplicate memberships.
 */
export function joinViaInvitation(token: string, raw: z.input<typeof joinSchema>, existingUserId?: string | null) {
  const input = joinSchema.parse(raw);
  return tx((d) => {
    const inv = d.prepare("SELECT * FROM invitations WHERE token_hash=?").get(hashToken(token)) as InvitationRow | undefined;
    if (!inv || !inviteActive(inv)) throw new AppError("invalid", "This invitation is no longer valid.");
    const g = getGroup(inv.group_id, d)!;
    assertNotFinalized(g);
    const partyId = inv.party_id ?? input.partyId;
    if (!partyId) throw invalid("Choose which party you are joining.");
    const party = getParty(partyId, d);
    if (!party || party.group_id !== g.id || party.status === "left") throw notFound("That party is not available.");

    if (existingUserId) {
      const existing = membershipFor(g.id, existingUserId, d);
      if (existing) {
        if (existing.party_id === partyId) return { userId: existingUserId, partyId, sessionToken: null, alreadyMember: true };
        throw conflict("You're already in another party in this group.");
      }
    }
    const members = activeMembers(partyId, d);
    if (members.length >= g.max_party_size) throw conflict(`${party.name} is full (maximum ${g.max_party_size} per party).`);
    assertUniqueName(d, g.id, input.displayName, existingUserId ?? undefined);

    let userId = existingUserId ?? null;
    let sessionToken: string | null = null;
    if (!userId) {
      userId = createUser(d, input.displayName);
      sessionToken = createSession(d, userId);
    } else {
      d.prepare("UPDATE users SET display_name=? WHERE id=?").run(input.displayName, userId);
    }
    const role = members.length === 0 ? "representative" : "member";
    d.prepare("INSERT INTO party_memberships (id, party_id, group_id, user_id, role) VALUES (?,?,?,?,?)").run(newId("mem"), partyId, g.id, userId, role);
    if (members.length === 0) d.prepare("UPDATE parties SET status='active', representative_user_id=? WHERE id=?").run(userId, partyId);
    d.prepare("UPDATE invitations SET uses = uses + 1 WHERE id=?").run(inv.id);

    // If the party's submitted size is now smaller than its membership, its preferences need a re-check.
    const pref = getPreferences(partyId, d);
    if (pref && pref.data.partySize < members.length + 1) {
      d.prepare("DELETE FROM party_preferences WHERE party_id=?").run(partyId);
      logActivity(d, g.id, userId, "preferences.reopened", `${party.name} must confirm its party size again`);
    }
    logActivity(d, g.id, userId, "party.joined", `${input.displayName} joined ${party.name}`);
    materialChange(d, g.id, userId, `${input.displayName} joined ${party.name}`);
    return { userId, partyId, sessionToken, alreadyMember: false };
  });
}

/** A member leaves their party. If they were the representative, the next member takes over. */
export function leaveParty(actorId: string, groupId: string) {
  return tx((d) => {
    const g = requireGroup(d, groupId);
    assertNotFinalized(g);
    const m = membershipFor(groupId, actorId, d);
    if (!m) throw notFound("You're not in a party in this group.");
    d.prepare("UPDATE party_memberships SET left_at=? WHERE id=?").run(new Date().toISOString(), m.id);
    const remaining = activeMembers(m.party_id, d);
    const party = getParty(m.party_id, d)!;
    if (remaining.length === 0) {
      d.prepare("UPDATE parties SET status='open', representative_user_id=NULL WHERE id=?").run(m.party_id);
      d.prepare("DELETE FROM party_preferences WHERE party_id=?").run(m.party_id);
    } else if (party.representative_user_id === actorId) {
      d.prepare("UPDATE parties SET representative_user_id=? WHERE id=?").run(remaining[0].user_id, m.party_id);
      d.prepare("UPDATE party_memberships SET role='representative' WHERE id=?").run(remaining[0].id);
    }
    logActivity(d, groupId, actorId, "party.left", `A member left ${party.name}`);
    materialChange(d, groupId, actorId, `a member left ${party.name}`);
  });
}

export function setRepresentative(actorId: string, partyId: string, userId: string) {
  return tx((d) => {
    const party = getParty(partyId, d);
    if (!party) throw notFound();
    const g = requireGroup(d, party.group_id);
    if (g.organizer_user_id !== actorId && party.representative_user_id !== actorId) throw forbid("Only the representative or organizer can change this.");
    const target = activeMembers(partyId, d).find((m) => m.user_id === userId);
    if (!target) throw invalid("That person isn't in this party.");
    d.prepare("UPDATE party_memberships SET role='member' WHERE party_id=? AND left_at IS NULL").run(partyId);
    d.prepare("UPDATE party_memberships SET role='representative' WHERE id=?").run(target.id);
    d.prepare("UPDATE parties SET representative_user_id=? WHERE id=?").run(userId, partyId);
    logActivity(d, g.id, actorId, "party.representative", `${target.display_name} now represents ${party.name}`);
    bumpVersion(d, g.id);
  });
}
