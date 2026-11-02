import { beforeEach, describe, expect, it } from "vitest";
import { useTempDb } from "./setup";
useTempDb("workflow");

import { getDb } from "@/lib/db/client";
import { seedDemo } from "@/lib/demo/seed";
import { activeMembers, getGroup, getPreferences, listParties, listRooms, getPropertyForGroup } from "@/lib/server/repo";
import { createGroup, updatePricing, upsertRoom, updateRules, setCostItems } from "@/lib/server/services/groups";
import { createInvitation, joinViaInvitation, leaveParty, removeParty, resolveInvitation, revokeInvitation } from "@/lib/server/services/parties";
import { getDraft, saveDraft, submitPreferences } from "@/lib/server/services/questionnaire";
import {
  approvalState, applyMarketWeights, castVote, finalizeAgreement, openVoting, reopenAgreement, runOptimization, selectProposal, selectedProposal,
} from "@/lib/server/services/allocation";
import { createAccessLink, redeemAccessLink, userFromSession } from "@/lib/server/services/auth";
import { DEMO_EXPECTED } from "@/lib/demo/fixture";

function breakdowns(proposalId: string) {
  return getDb().prepare("SELECT cb.*, r.name room FROM cost_breakdowns cb JOIN room_assignments ra ON ra.proposal_id=cb.proposal_id AND ra.party_id=cb.party_id JOIN rooms r ON r.id=ra.room_id WHERE cb.proposal_id=?").all(proposalId) as { party_id: string; total_cents: number; room: string }[];
}

describe("seeded demo", () => {
  let s: ReturnType<typeof seedDemo>;
  beforeEach(() => {
    s = seedDemo();
  });

  it("seeds 4 parties, 6 travelers, voting with 2 approvals", () => {
    const parties = listParties(s.groupId);
    expect(parties).toHaveLength(4);
    expect(parties.reduce((a, p) => a + activeMembers(p.id).length, 0)).toBe(6);
    expect(getGroup(s.groupId)!.status).toBe("voting");
    const st = approvalState(getDb(), s.groupId);
    expect(st.approvals).toBe(2);
    expect(st.needed).toBe(4);
  });

  it("recommended allocation matches the fixture exactly", () => {
    const sel = selectedProposal(getDb(), s.groupId)!;
    const rows = breakdowns(sel.id);
    const names = ["Master Suite", "View Room", "Comfort Room", "Twin/Bunk Room"];
    const exp = [DEMO_EXPECTED.A, DEMO_EXPECTED.B, DEMO_EXPECTED.C, DEMO_EXPECTED.D];
    s.parties.forEach((p, i) => {
      const r = rows.find((x) => x.party_id === p.id)!;
      expect(r.room).toBe(names[i]);
      expect(r.total_cents).toBe(exp[i].cents);
    });
    expect(rows.reduce((a, r) => a + r.total_cents, 0)).toBe(420_000);
  });

  it("finalization requires every party; then produces a ledger", () => {
    const sel = selectedProposal(getDb(), s.groupId)!;
    expect(() => finalizeAgreement(s.organizerId, s.groupId)).toThrow(/approve/);
    castVote(s.parties[1].members[0], s.groupId, { proposalId: sel.id, decision: "approve" });
    castVote(s.parties[3].members[0], s.groupId, { proposalId: sel.id, decision: "approve" });
    expect(getGroup(s.groupId)!.status).toBe("approved");
    finalizeAgreement(s.organizerId, s.groupId);
    expect(getGroup(s.groupId)!.status).toBe("finalized");
    const ledger = getDb().prepare("SELECT SUM(amount_cents) t FROM ledger_entries WHERE group_id=? AND status='owed'").get(s.groupId) as { t: number };
    expect(ledger.t).toBe(420_000);
    // Locked after finalization
    expect(() => updatePricing(s.organizerId, s.groupId, { sharedBps: 5000 })).toThrow(/finalized/);
    reopenAgreement(s.organizerId, s.groupId);
    expect(getGroup(s.groupId)!.status).toBe("voting");
    expect(approvalState(getDb(), s.groupId).approvals).toBe(0);
  });

  it("only representatives vote; non-members can't vote", () => {
    const sel = selectedProposal(getDb(), s.groupId)!;
    const sam = s.parties[1].members[1];
    expect(() => castVote(sam, s.groupId, { proposalId: sel.id, decision: "approve" })).toThrow(/representative/);
    const other = createGroup({ organizerName: "Zed", groupName: "Other", propertyName: "X", totalCents: 1000, currency: "USD", partyCount: 1, maxPartySize: 2, sharedBps: 4000, organizerJoins: true });
    expect(() => castVote(other.userId, s.groupId, { proposalId: sel.id, decision: "approve" })).toThrow();
  });

  it("request changes requires a comment and blocks approval", () => {
    const sel = selectedProposal(getDb(), s.groupId)!;
    expect(() => castVote(s.parties[1].members[0], s.groupId, { proposalId: sel.id, decision: "request_changes" })).toThrow(/changed/);
    castVote(s.parties[1].members[0], s.groupId, { proposalId: sel.id, decision: "request_changes", comment: "Could we swap?" });
    castVote(s.parties[3].members[0], s.groupId, { proposalId: sel.id, decision: "approve" });
    expect(getGroup(s.groupId)!.status).toBe("voting");
  });

  it("material change (pricing) invalidates approvals and marks proposal stale", () => {
    updatePricing(s.organizerId, s.groupId, { sharedBps: 5000 });
    expect(getGroup(s.groupId)!.status).toBe("ready");
    expect(approvalState(getDb(), s.groupId).votes).toHaveLength(0);
    expect(selectedProposal(getDb(), s.groupId)).toBeUndefined();
    runOptimization(s.organizerId, s.groupId);
    const sel = selectedProposal(getDb(), s.groupId)!;
    expect(breakdowns(sel.id).reduce((a, r) => a + r.total_cents, 0)).toBe(420_000);
    const v = getDb().prepare("SELECT version_no FROM proposal_versions WHERE group_id=? AND status='current'").get(s.groupId) as { version_no: number };
    expect(v.version_no).toBe(2);
  });

  it("questionnaire change after publication invalidates approvals", () => {
    const theo = s.parties[3].members[0];
    saveDraft(theo, s.parties[3].id, { idealBudgetCents: 64_000 });
    // Draft alone is not material
    expect(approvalState(getDb(), s.groupId).approvals).toBe(2);
    submitPreferences(theo, s.parties[3].id);
    expect(approvalState(getDb(), s.groupId).votes).toHaveLength(0);
    expect(getGroup(s.groupId)!.status).toBe("ready");
  });

  it("selecting a different proposal clears votes", () => {
    const ver = getDb().prepare("SELECT id FROM allocation_proposals WHERE group_id=? AND is_selected=0 LIMIT 1").get(s.groupId) as { id: string };
    selectProposal(s.organizerId, s.groupId, ver.id);
    expect(approvalState(getDb(), s.groupId).votes).toHaveLength(0);
  });

  it("concurrent votes from two parties both persist (one active vote each)", async () => {
    const sel = selectedProposal(getDb(), s.groupId)!;
    await Promise.all([
      Promise.resolve().then(() => castVote(s.parties[1].members[0], s.groupId, { proposalId: sel.id, decision: "approve" })),
      Promise.resolve().then(() => castVote(s.parties[3].members[0], s.groupId, { proposalId: sel.id, decision: "approve" })),
      Promise.resolve().then(() => castVote(s.parties[3].members[0], s.groupId, { proposalId: sel.id, decision: "approve" })),
    ]);
    const st = approvalState(getDb(), s.groupId);
    expect(st.votes).toHaveLength(4);
    expect(getGroup(s.groupId)!.status).toBe("approved");
  });

  it("a party leaving before finalization invalidates and re-optimizes over the rest", () => {
    removeParty(s.organizerId, s.groupId, s.parties[3].id);
    expect(listParties(s.groupId)).toHaveLength(3);
    runOptimization(s.organizerId, s.groupId);
    const sel = selectedProposal(getDb(), s.groupId)!;
    const rows = breakdowns(sel.id);
    expect(rows).toHaveLength(3);
    expect(rows.reduce((a, r) => a + r.total_cents, 0)).toBe(420_000);
  });

  it("other parties can't read or edit a party's questionnaire", () => {
    const lena = s.parties[2].members[0];
    expect(() => getDraft(lena, s.parties[0].id)).toThrow();
    expect(() => saveDraft(lena, s.parties[0].id, { idealBudgetCents: 1 })).toThrow();
    expect(() => submitPreferences(s.parties[0].members[1], s.parties[0].id)).toThrow(/representative/);
  });

  it("non-organizers can't change pricing or rooms", () => {
    const lena = s.parties[2].members[0];
    expect(() => updatePricing(lena, s.groupId, { sharedBps: 1000 })).toThrow(/organizer/);
    const room = listRooms(getPropertyForGroup(s.groupId).id)[0];
    expect(() =>
      upsertRoom(lena, s.groupId, { id: room.id, name: "Hacked", capacity: 2, bedCount: 1, hasBunk: false, accessible: false, weightMilli: 1, qualityRating: 1, attributes: JSON.parse(room.attributes_json) }),
    ).toThrow(/organizer/);
  });

  it("auction mode adds a market proposal and market weights can be applied", () => {
    updatePricing(s.organizerId, s.groupId, { sharedBps: 4000, method: "hybrid" });
    runOptimization(s.organizerId, s.groupId);
    const props = getDb().prepare("SELECT ap.* FROM allocation_proposals ap JOIN proposal_versions v ON v.id=ap.version_id WHERE v.status='current' AND ap.group_id=? ORDER BY rank").all(s.groupId) as { id: string; strategies_json: string; is_selected: number }[];
    const auction = props.find((p) => JSON.parse(p.strategies_json).includes("auction"))!;
    expect(auction).toBeTruthy();
    expect(breakdowns(auction.id).reduce((a, r) => a + r.total_cents, 0)).toBe(420_000);
    expect(props[0].is_selected).toBe(1); // weighted stays recommended in hybrid
    applyMarketWeights(s.organizerId, s.groupId);
    expect(getGroup(s.groupId)!.status).toBe("ready");
    updatePricing(s.organizerId, s.groupId, { sharedBps: 4000, method: "auction" });
    runOptimization(s.organizerId, s.groupId);
    const sel = selectedProposal(getDb(), s.groupId)! as unknown as { strategies_json: string };
    expect(JSON.parse(sel.strategies_json)).toContain("auction");
  });
});

describe("invitations & membership", () => {
  it("organizer creates a group; participants join independently; cap enforced", () => {
    const g = createGroup({ organizerName: "Olive", groupName: "Trip", propertyName: "House", totalCents: 420_000, currency: "USD", partyCount: 2, maxPartySize: 2, sharedBps: 4000, organizerJoins: false });
    const [p1] = listParties(g.groupId);
    const inv = createInvitation(g.userId, g.groupId, { partyId: p1.id });
    expect(resolveInvitation(inv.token).ok).toBe(true);
    const a = joinViaInvitation(inv.token, { displayName: "Ana" });
    const b = joinViaInvitation(inv.token, { displayName: "Ben" });
    expect(activeMembers(p1.id)).toHaveLength(2);
    expect(() => joinViaInvitation(inv.token, { displayName: "Cat" })).toThrow(/full/);
    expect(() => joinViaInvitation(inv.token, { displayName: "ana" })).toThrow();
    expect(userFromSession(a.sessionToken)!.display_name).toBe("Ana");
    expect(b.partyId).toBe(p1.id);
    // A two-person party is one party with one room
    expect(listParties(g.groupId)).toHaveLength(2);
  });

  it("revoked and expired tokens are rejected", () => {
    const g = createGroup({ organizerName: "Olive", groupName: "Trip", propertyName: "House", totalCents: 420_000, currency: "USD", partyCount: 2, maxPartySize: 2, sharedBps: 4000, organizerJoins: true });
    const inv = createInvitation(g.userId, g.groupId, { partyId: null });
    revokeInvitation(g.userId, g.groupId, inv.id);
    expect(resolveInvitation(inv.token).ok).toBe(false);
    expect(() => joinViaInvitation(inv.token, { displayName: "X" })).toThrow();
    const inv2 = createInvitation(g.userId, g.groupId, { partyId: null, expiresInDays: 1 });
    getDb().prepare("UPDATE invitations SET expires_at='2000-01-01' WHERE id=?").run(inv2.id);
    expect(resolveInvitation(inv2.token).ok).toBe(false);
    expect(resolveInvitation("garbage").ok).toBe(false);
  });

  it("a user cannot join two parties in the same group", () => {
    const g = createGroup({ organizerName: "Olive", groupName: "Trip", propertyName: "House", totalCents: 420_000, currency: "USD", partyCount: 3, maxPartySize: 2, sharedBps: 4000, organizerJoins: false });
    const [p1, p2] = listParties(g.groupId);
    const i1 = createInvitation(g.userId, g.groupId, { partyId: p1.id });
    const i2 = createInvitation(g.userId, g.groupId, { partyId: p2.id });
    const a = joinViaInvitation(i1.token, { displayName: "Ana" });
    expect(() => joinViaInvitation(i2.token, { displayName: "Ana" }, a.userId)).toThrow(/another party/);
  });

  it("full journey: create → invite → questionnaires → optimize → vote → finalize; data persists", () => {
    const g = createGroup({ organizerName: "Olive", groupName: "Trip", propertyName: "House", totalCents: 300_000, currency: "USD", partyCount: 2, maxPartySize: 2, sharedBps: 4000, organizerJoins: true });
    const [p1, p2] = listParties(g.groupId);
    const inv = createInvitation(g.userId, g.groupId, { partyId: p2.id });
    const bob = joinViaInvitation(inv.token, { displayName: "Bob" });
    expect(getGroup(g.groupId)!.status).toBe("collecting");
    const rooms = listRooms(getPropertyForGroup(g.groupId).id).map((r) => r.id);
    saveDraft(g.userId, p1.id, { partyName: "Olive", partySize: 1, idealBudgetCents: 200_000, maxBudgetCents: 250_000, topPriorities: ["privacy"], roomRanking: rooms });
    submitPreferences(g.userId, p1.id);
    expect(getGroup(g.groupId)!.status).toBe("collecting");
    saveDraft(bob.userId, p2.id, { partyName: "Bob", partySize: 1, idealBudgetCents: 100_000, maxBudgetCents: 150_000, topPriorities: ["lowPrice"], roomRanking: [...rooms].reverse() });
    submitPreferences(bob.userId, p2.id);
    expect(getPreferences(p2.id)!.data.partyName).toBe("Bob");
    expect(getGroup(g.groupId)!.status).toBe("ready");
    runOptimization(g.userId, g.groupId);
    openVoting(g.userId, g.groupId);
    const sel = selectedProposal(getDb(), g.groupId)!;
    castVote(g.userId, g.groupId, { proposalId: sel.id, decision: "approve" });
    castVote(bob.userId, g.groupId, { proposalId: sel.id, decision: "approve" });
    finalizeAgreement(g.userId, g.groupId);
    expect(getGroup(g.groupId)!.status).toBe("finalized");
    const rows = breakdowns(sel.id);
    expect(rows.reduce((a, r) => a + r.total_cents, 0)).toBe(300_000);
  });

  it("member leaving hands representative role over", () => {
    const g = createGroup({ organizerName: "Olive", groupName: "Trip", propertyName: "House", totalCents: 300_000, currency: "USD", partyCount: 2, maxPartySize: 2, sharedBps: 4000, organizerJoins: false });
    const [p1] = listParties(g.groupId);
    const inv = createInvitation(g.userId, g.groupId, { partyId: p1.id });
    const a = joinViaInvitation(inv.token, { displayName: "Ana" });
    const b = joinViaInvitation(inv.token, { displayName: "Ben" });
    leaveParty(a.userId, g.groupId);
    expect(listParties(g.groupId)[0].representative_user_id).toBe(b.userId);
  });

  it("rules can't drop below existing membership; cost items change total", () => {
    const g = createGroup({ organizerName: "Olive", groupName: "Trip", propertyName: "House", totalCents: 300_000, currency: "USD", partyCount: 2, maxPartySize: 2, sharedBps: 4000, organizerJoins: true });
    expect(() => updateRules(g.userId, g.groupId, { name: "T", maxParties: 1, maxPartySize: 2, approvalPolicy: "unanimous" })).toThrow();
    setCostItems(g.userId, g.groupId, [{ label: "Base", kind: "base", amountCents: 300_000 }, { label: "Cleaning", kind: "cleaning", amountCents: 25_000 }]);
    const t = getDb().prepare("SELECT SUM(amount_cents) t FROM property_cost_items WHERE property_id=?").get(getPropertyForGroup(g.groupId).id) as { t: number };
    expect(t.t).toBe(325_000);
  });

  it("personal access links sign a user in on another device and can be rotated", () => {
    const g = createGroup({ organizerName: "Olive", groupName: "Trip", propertyName: "House", totalCents: 300_000, currency: "USD", partyCount: 1, maxPartySize: 2, sharedBps: 4000, organizerJoins: true });
    const t1 = createAccessLink(g.userId);
    expect(redeemAccessLink(t1)!.userId).toBe(g.userId);
    createAccessLink(g.userId, { rotate: true });
    expect(redeemAccessLink(t1)).toBeNull();
  });
});
