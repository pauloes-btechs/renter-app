import { getDb, tx } from "../db/client";
import { listParties, listRooms, getPropertyForGroup, activeMembers, getGroup } from "../server/repo";
import { createGroup } from "../server/services/groups";
import { createInvitation, joinViaInvitation } from "../server/services/parties";
import { saveDraft, shareDraft, submitPreferences } from "../server/services/questionnaire";
import { castVote, openVoting, runOptimization, selectedProposal } from "../server/services/allocation";
import { DEMO_GROUP, DEMO_PARTIES, DEMO_PROPERTY, DEMO_ROOMS } from "./fixture";

export function clearDemo() {
  tx((d) => {
    const users = d.prepare("SELECT id FROM users WHERE is_demo = 1").all() as { id: string }[];
    d.prepare("DELETE FROM groups WHERE is_demo = 1").run();
    for (const u of users) {
      // Only delete demo users that no longer belong to any group.
      const used = d.prepare("SELECT 1 FROM groups WHERE organizer_user_id=? UNION SELECT 1 FROM party_memberships WHERE user_id=?").get(u.id, u.id);
      if (!used) d.prepare("DELETE FROM users WHERE id=?").run(u.id);
    }
  });
}

/**
 * Seeds the demo group by driving the real services (invites, joins, questionnaires, optimizer, votes),
 * so the seeded state is exactly what the application logic produces.
 */
export function seedDemo(opts: { stage?: "voting" | "collected" } = {}) {
  clearDemo();
  const [first, ...rest] = DEMO_PARTIES;
  const { groupId, userId: organizerId } = createGroup(
    {
      organizerName: first.members[0].name,
      groupName: DEMO_GROUP.name,
      propertyName: DEMO_PROPERTY.name,
      totalCents: DEMO_PROPERTY.costItems[0].amountCents,
      currency: "USD",
      partyCount: DEMO_GROUP.maxParties,
      maxPartySize: DEMO_GROUP.maxPartySize,
      sharedBps: DEMO_GROUP.sharedBps,
      organizerJoins: true,
      organizerPartyName: first.answers.partyName,
    },
    null,
    { isDemo: true },
  );
  const d = getDb();
  d.prepare("UPDATE property_cost_items SET label=? WHERE property_id=?").run(DEMO_PROPERTY.costItems[0].label, getPropertyForGroup(groupId, d).id);
  const rooms = listRooms(getPropertyForGroup(groupId).id);
  const keyToId = Object.fromEntries(DEMO_ROOMS.map((t, i) => [t.key, rooms[i].id]));
  const mapAnswers = (a: (typeof DEMO_PARTIES)[number]["answers"]) => ({
    ...a,
    roomRanking: a.roomRanking.map((k) => keyToId[k]),
    refusedRooms: a.refusedRooms.map((k) => keyToId[k]),
    bids: Object.fromEntries(Object.entries(a.bids).map(([k, v]) => [keyToId[k], v])),
  });

  const parties = listParties(groupId);
  const members: Record<string, string[]> = {};
  DEMO_PARTIES.forEach((fx, i) => {
    const party = parties[i];
    members[party.id] = i === 0 ? [organizerId] : [];
    const invite = createInvitation(organizerId, groupId, { partyId: party.id, label: fx.slot, expiresInDays: 90 });
    const toJoin = i === 0 ? fx.members.slice(1) : fx.members;
    for (const m of toJoin) {
      const r = joinViaInvitation(invite.token, { displayName: m.name });
      members[party.id].push(r.userId);
    }
  });
  getDb().prepare(`UPDATE users SET is_demo=1 WHERE id IN (SELECT user_id FROM party_memberships WHERE group_id=?)`).run(groupId);

  DEMO_PARTIES.forEach((fx, i) => {
    const party = parties[i];
    const rep = members[party.id][0];
    saveDraft(rep, party.id, mapAnswers(fx.answers));
    if (fx.secondMemberDraft && members[party.id][1]) {
      const second = members[party.id][1];
      const sd = fx.secondMemberDraft;
      saveDraft(second, party.id, {
        ...mapAnswers(fx.answers),
        ...(sd.priorities ? { priorities: sd.priorities } : {}),
        ...(sd.roomRanking ? { roomRanking: sd.roomRanking.map((k) => keyToId[k]) } : {}),
      });
      shareDraft(second, party.id);
    }
    submitPreferences(rep, party.id);
  });
  void rest;

  if (opts.stage !== "collected") {
    runOptimization(organizerId, groupId);
    openVoting(organizerId, groupId);
    const sel = selectedProposal(getDb(), groupId)!;
    castVote(organizerId, groupId, { proposalId: sel.id, decision: "approve", comment: "Master suite works for us — thanks all!" });
    const lena = members[parties[2].id][0];
    castVote(lena, groupId, { proposalId: sel.id, decision: "approve", comment: "" });
  }
  return { groupId, organizerId, parties: parties.map((p) => ({ id: p.id, members: members[p.id] })) };
}

export function findDemoGroup() {
  const row = getDb().prepare("SELECT id FROM groups WHERE is_demo=1 ORDER BY created_at DESC LIMIT 1").get() as { id: string } | undefined;
  return row ? getGroup(row.id) : undefined;
}

export interface Persona { key: string; label: string; userId: string; name: string; partyName: string | null; landing: string; role: string }

export function demoPersonas(): Persona[] {
  const g = findDemoGroup();
  if (!g) return [];
  const d = getDb();
  const organizer = d.prepare("SELECT display_name FROM users WHERE id=?").get(g.organizer_user_id) as { display_name: string };
  const out: Persona[] = [
    { key: "organizer", label: "Organizer", userId: g.organizer_user_id, name: organizer.display_name, partyName: null, landing: `/group/${g.id}`, role: "Organizer · also in Party A" },
  ];
  for (const p of listParties(g.id, d, true)) {
    activeMembers(p.id, d).forEach((m, i) => {
      out.push({
        key: `${p.slot_label.replace("Party ", "").toLowerCase()}${i + 1}`,
        label: `${p.slot_label}, member ${i + 1}`,
        userId: m.user_id,
        name: m.display_name,
        partyName: p.name,
        landing: `/party/${p.id}`,
        role: p.representative_user_id === m.user_id ? "Representative" : "Party member",
      });
    });
  }
  return out;
}
