import type Database from "better-sqlite3";
import { z } from "zod";
import { getDb, tx } from "../../db/client";
import { toPartyInput } from "../../domain/questionnaire";
import { evaluateAssignment, explainProposal, formatMoney, optimize, runAuction, type AuctionResult, type OptimizationResult, type Proposal } from "../../engine";
import type { PartyInput, PricingConfig, PricingMethod, RoomInput } from "../../engine/types";
import { newId, stableHash } from "../crypto";
import { AppError, conflict, forbid, invalid, notFound } from "../errors";
import {
  activeMembers,
  bumpVersion,
  getParty,
  getPreferences,
  getPricing,
  getPropertyForGroup,
  listParties,
  listRooms,
  logActivity,
  roomRowToInput,
  totalCents,
} from "../repo";
import { materialChange, requireGroup, requireOrganizer } from "./groups";

type DB = Database.Database;

export interface EngineInputs {
  config: PricingConfig;
  parties: PartyInput[];
  rooms: RoomInput[];
  currency: string;
  method: PricingMethod;
  missing: { id: string; name: string; reason: string }[];
  hash: string;
}

export function buildInputs(d: DB, groupId: string): EngineInputs {
  const prop = getPropertyForGroup(groupId, d);
  const rooms = listRooms(prop.id, d).map(roomRowToInput);
  const roomIds = rooms.map((r) => r.id);
  const pricing = getPricing(groupId, d);
  const method = pricing.method ?? "weighted";
  const config: PricingConfig = { totalCents: totalCents(prop.id, d), sharedBps: pricing.shared_bps };
  const parties: PartyInput[] = [];
  const missing: EngineInputs["missing"] = [];
  for (const p of listParties(groupId, d)) {
    const members = activeMembers(p.id, d);
    if (members.length === 0) {
      missing.push({ id: p.id, name: p.name, reason: "No one has joined yet" });
      continue;
    }
    const pref = getPreferences(p.id, d);
    if (!pref) {
      missing.push({ id: p.id, name: p.name, reason: "Questionnaire not submitted" });
      continue;
    }
    const input = toPartyInput(p.id, p.sort, pref.data, roomIds);
    if (method !== "weighted" && Object.keys(input.bids ?? {}).length === 0) {
      missing.push({ id: p.id, name: p.name, reason: "Auction bids not submitted" });
      continue;
    }
    if (method === "weighted") delete input.bids; // bids don't affect weighted results
    parties.push(input);
  }
  const hash = stableHash({ config, rooms, parties, currency: prop.currency, method });
  return { config, parties, rooms, currency: prop.currency, method, missing, hash };
}

export function currentVersion(d: DB, groupId: string) {
  return d.prepare("SELECT * FROM proposal_versions WHERE group_id=? AND status='current'").get(groupId) as
    | { id: string; version_no: number; inputs_hash: string; feasible_count: number; diagnosis_json: string | null; engine: string; created_at: string }
    | undefined;
}

/** Run the deterministic engine and persist a new ProposalVersion (idempotent for unchanged inputs). */
export function runOptimization(actorId: string, groupId: string): { versionId: string; result: OptimizationResult | null; reused: boolean } {
  return tx((d) => {
    const g = requireOrganizer(d, groupId, actorId);
    if (g.status === "finalized") throw new AppError("locked", "This agreement is finalized. Reopen it to recalculate.");
    const inputs = buildInputs(d, groupId);
    if (inputs.missing.length > 0)
      throw invalid(`Waiting on ${inputs.missing.map((m) => `${m.name} (${m.reason.toLowerCase()})`).join(", ")}.`);
    if (inputs.parties.length === 0) throw invalid("No parties have submitted preferences yet.");
    const cur = currentVersion(d, groupId);
    if (cur && cur.inputs_hash === inputs.hash) return { versionId: cur.id, result: null, reused: true };

    const result = optimize({ config: inputs.config, parties: inputs.parties, rooms: inputs.rooms });
    let auction: AuctionResult | null = null;
    if (inputs.method !== "weighted") {
      auction = runAuction(inputs.config, inputs.parties, inputs.rooms);
      const ev = auction.feasible && auction.assignment ? evaluateAssignment(inputs, auction.assignment, auction.prices) : null;
      if (auction.feasible && !ev) {
        auction.feasible = false;
        auction.conflicts.push("The auction outcome breaks a hard constraint for at least one party.");
      }
      if (ev) {
        const existing = result.proposals.find((p) => p.evaluation.key === ev.key);
        const sameprices = existing && existing.evaluation.pricing.charges.every((c) => c.totalCents === auction!.prices[c.partyId]);
        if (existing && sameprices) existing.strategies.push("auction");
        else {
          const ap: Proposal = { rank: 0, strategies: ["auction"], label: "Market auction", evaluation: ev };
          if (inputs.method === "auction") result.proposals.unshift(ap);
          else result.proposals.push(ap);
        }
        result.proposals.forEach((p, i) => (p.rank = i + 1));
      }
    }
    const now = new Date().toISOString();
    if (cur) d.prepare("UPDATE proposal_versions SET status='superseded' WHERE id=?").run(cur.id);
    d.prepare("UPDATE proposal_versions SET status='superseded' WHERE group_id=? AND status='stale'").run(groupId);
    d.prepare(
      `UPDATE votes SET invalidated_at=?, invalidated_reason='superseded by a new proposal' WHERE invalidated_at IS NULL AND proposal_id IN
       (SELECT id FROM allocation_proposals WHERE group_id=?)`,
    ).run(now, groupId);
    const versionNo = ((d.prepare("SELECT COALESCE(MAX(version_no),0) v FROM proposal_versions WHERE group_id=?").get(groupId) as { v: number }).v ?? 0) + 1;
    const versionId = newId("ver");
    d.prepare(
      `INSERT INTO proposal_versions (id, group_id, version_no, inputs_hash, inputs_snapshot_json, engine, feasible_count, diagnosis_json, created_by, auction_json)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      versionId, groupId, versionNo, inputs.hash,
      JSON.stringify({ config: inputs.config, parties: inputs.parties, rooms: inputs.rooms, currency: inputs.currency, method: inputs.method }),
      result.engine, result.feasibleCount, result.diagnosis ? JSON.stringify(result.diagnosis) : null, actorId,
      auction ? JSON.stringify(auction) : null,
    );
    for (const p of result.proposals) {
      const pid = newId("prop");
      const ex = explainProposal(p, result.proposals, inputs.parties, inputs.rooms, inputs.config, inputs.currency);
      if (p.strategies.includes("auction") && auction) annotateAuction(ex, auction, inputs);
      d.prepare(
        `INSERT INTO allocation_proposals (id, version_id, group_id, rank, label, strategies_json, scores_json, metrics_json, explanation_json, is_selected)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
      ).run(pid, versionId, groupId, p.rank, p.label, JSON.stringify(p.strategies), JSON.stringify(p.evaluation.scores), JSON.stringify(p.evaluation.metrics), JSON.stringify(ex), p.rank === 1 ? 1 : 0);
      for (const c of p.evaluation.pricing.charges) {
        const pe = p.evaluation.parties.find((x) => x.partyId === c.partyId)!;
        d.prepare("INSERT INTO room_assignments (id, proposal_id, party_id, room_id) VALUES (?,?,?,?)").run(newId("ra"), pid, c.partyId, c.roomId);
        d.prepare(
          `INSERT INTO cost_breakdowns (id, proposal_id, party_id, party_size, shared_cents, room_cents, total_cents, per_person_json, share_bps,
            rank_position, satisfaction, fit, afford) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        ).run(newId("cb"), pid, c.partyId, c.size, c.sharedCents, c.roomCents, c.totalCents, JSON.stringify(c.perPersonCents), c.shareBps, pe.rankPosition, pe.satisfaction, pe.fit, pe.afford);
      }
    }
    const status = result.proposals.length > 0 ? "proposed" : "ready";
    d.prepare("UPDATE groups SET status=? WHERE id=?").run(status, groupId);
    logActivity(
      d, groupId, actorId, "proposal.generated",
      result.proposals.length > 0
        ? `Allocation v${versionNo} generated — ${result.proposals.length} proposal${result.proposals.length === 1 ? "" : "s"} from ${result.feasibleCount} feasible arrangement${result.feasibleCount === 1 ? "" : "s"}`
        : `Allocation v${versionNo}: no feasible arrangement — see conflicts`,
    );
    bumpVersion(d, groupId);
    return { versionId, result, reused: false };
  });
}

/** Replace weight-based price facts with auction facts for the market proposal. Bids stay private to each party. */
function annotateAuction(ex: ReturnType<typeof explainProposal>, a: AuctionResult, inputs: EngineInputs) {
  const m = (c: number) => formatMoney(c, inputs.currency);
  const roomName = (id: string) => inputs.rooms.find((r) => r.id === id)?.name ?? id;
  for (const pe of ex.parties) {
    const party = inputs.parties.find((p) => p.id === pe.partyId)!;
    const rid = a.assignment![pe.partyId];
    const st = a.rooms.find((r) => r.roomId === rid)!;
    pe.facts = [
      `Clearing price for ${roomName(rid)}: ${m(a.prices[pe.partyId])} (party total, ${st.bidCount} bid${st.bidCount === 1 ? "" : "s"} on this room)`,
      st.premiumCents != null
        ? `${st.premiumCents >= 0 ? "Market premium" : "Market discount"} of ${m(Math.abs(st.premiumCents))} vs the weighted model`
        : "",
      ...pe.facts.filter((f) => f.includes("choice in their room ranking")),
    ].filter(Boolean);
    pe.privateFacts = [
      `Your bid: ${m(party.bids?.[rid] ?? 0)} · you keep ${m(a.surplus[pe.partyId])} of surplus`,
      ...pe.privateFacts.filter((f) => !f.startsWith("Score detail")),
    ];
    pe.judgments = [
      a.envyFree ? "Envy-free: at these prices you would not rather have any other room you bid on" : "Small rounding envy (≤1¢) may exist",
      ...pe.judgments.filter((j) => j.startsWith("Matches")),
    ];
  }
  ex.facts = [
    `Rooms went to the arrangement with the highest combined bids (${inputs.parties.length} parties).`,
    `Prices are the envy-free vector that maximizes the smallest surplus, shifted to sum exactly to ${m(inputs.config.totalCents)}.`,
    ...ex.facts.filter((f) => f.startsWith("Charges reconcile")),
  ];
  ex.judgments = [
    "Price discovery: rooms in higher demand clear above their weighted price; under-demanded rooms clear below.",
    ...ex.judgments.filter((j) => !j.startsWith("Protects")),
  ];
}

/** Organizer adopts the auction's implied weights as the new baseline room weights. */
export function applyMarketWeights(actorId: string, groupId: string) {
  return tx((d) => {
    requireOrganizer(d, groupId, actorId);
    const v = d.prepare("SELECT auction_json FROM proposal_versions WHERE group_id=? AND auction_json IS NOT NULL ORDER BY version_no DESC LIMIT 1").get(groupId) as { auction_json: string } | undefined;
    if (!v) throw invalid("Run an auction first.");
    const a = JSON.parse(v.auction_json) as AuctionResult;
    if (!a.feasible || Object.keys(a.marketWeights).length === 0) throw invalid("The latest auction did not clear, so there are no market weights to apply.");
    const prop = getPropertyForGroup(groupId, d);
    for (const [rid, w] of Object.entries(a.marketWeights))
      d.prepare("UPDATE rooms SET weight_milli=? WHERE id=? AND property_id=?").run(Math.max(0, w), rid, prop.id);
    logActivity(d, groupId, actorId, "rooms.market_weights", "Room weights updated from auction clearing prices");
    materialChange(d, groupId, actorId, "room weights updated from market prices");
  });
}

export function selectedProposal(d: DB, groupId: string) {
  return d
    .prepare(
      `SELECT ap.* FROM allocation_proposals ap JOIN proposal_versions v ON v.id = ap.version_id
       WHERE ap.group_id=? AND v.status='current' AND ap.is_selected=1`,
    )
    .get(groupId) as { id: string; version_id: string; rank: number; label: string } | undefined;
}

export function selectProposal(actorId: string, groupId: string, proposalId: string) {
  return tx((d) => {
    const g = requireOrganizer(d, groupId, actorId);
    if (!["proposed", "voting", "approved"].includes(g.status)) throw invalid("There's no active proposal to choose from.");
    const ver = currentVersion(d, groupId);
    const p = d.prepare("SELECT * FROM allocation_proposals WHERE id=? AND version_id=?").get(proposalId, ver?.id ?? "") as { id: string; label: string } | undefined;
    if (!p) throw notFound("Proposal not found in the current version.");
    const sel = selectedProposal(d, groupId);
    if (sel?.id === proposalId) return;
    d.prepare("UPDATE allocation_proposals SET is_selected = CASE WHEN id=? THEN 1 ELSE 0 END WHERE version_id=?").run(proposalId, ver!.id);
    const n = d
      .prepare("UPDATE votes SET invalidated_at=?, invalidated_reason='a different proposal was selected' WHERE invalidated_at IS NULL AND proposal_id IN (SELECT id FROM allocation_proposals WHERE version_id=?)")
      .run(new Date().toISOString(), ver!.id).changes;
    if (g.status === "approved") d.prepare("UPDATE groups SET status='voting' WHERE id=?").run(groupId);
    logActivity(d, groupId, actorId, "proposal.selected", `"${p.label}" is now the group's preferred allocation${n ? " — previous approvals cleared" : ""}`);
    bumpVersion(d, groupId);
  });
}

export function openVoting(actorId: string, groupId: string) {
  return tx((d) => {
    const g = requireOrganizer(d, groupId, actorId);
    if (g.status !== "proposed") throw invalid("Voting can only start once a proposal is ready.");
    if (!selectedProposal(d, groupId)) throw invalid("Select a proposal first.");
    d.prepare("UPDATE groups SET status='voting' WHERE id=?").run(groupId);
    logActivity(d, groupId, actorId, "voting.opened", "Voting opened — each party can approve or request changes");
    bumpVersion(d, groupId);
  });
}

export function approvalState(d: DB, groupId: string) {
  const g = requireGroup(d, groupId);
  const sel = selectedProposal(d, groupId);
  const parties = listParties(groupId, d).filter((p) => p.status === "active");
  const votes = sel
    ? (d.prepare("SELECT v.*, u.display_name FROM votes v JOIN users u ON u.id=v.user_id WHERE v.proposal_id=? AND v.invalidated_at IS NULL").all(sel.id) as {
        id: string; party_id: string; user_id: string; decision: "approve" | "request_changes"; comment: string; created_at: string; display_name: string;
      }[])
    : [];
  const approvals = votes.filter((v) => v.decision === "approve").length;
  const needed = g.approval_policy === "unanimous" ? parties.length : Math.floor(parties.length / 2) + 1;
  return { proposalId: sel?.id ?? null, parties, votes, approvals, needed, met: !!sel && parties.length > 0 && approvals >= needed && (g.approval_policy === "majority" || votes.every((v) => v.decision === "approve")) };
}

export function syncApproval(d: DB, groupId: string) {
  const g = requireGroup(d, groupId);
  if (!["voting", "approved"].includes(g.status)) return;
  const st = approvalState(d, groupId);
  const next = st.met ? "approved" : "voting";
  if (next !== g.status) {
    d.prepare("UPDATE groups SET status=? WHERE id=?").run(next, groupId);
    if (next === "approved") logActivity(d, groupId, null, "proposal.approved", "All required parties approved — ready to finalize");
  }
}

export const voteSchema = z.object({
  proposalId: z.string(),
  decision: z.enum(["approve", "request_changes"]),
  comment: z.string().trim().max(1000).default(""),
});

/** Party representatives vote on the selected proposal. Concurrency-safe via IMMEDIATE tx + unique index. */
export function castVote(actorId: string, groupId: string, raw: z.input<typeof voteSchema>) {
  const input = voteSchema.parse(raw);
  if (input.decision === "request_changes" && !input.comment) throw invalid("Tell the group what you'd like changed.");
  return tx((d) => {
    const g = requireGroup(d, groupId);
    if (!["voting", "approved"].includes(g.status)) throw invalid("Voting isn't open right now.");
    const m = d.prepare("SELECT * FROM party_memberships WHERE group_id=? AND user_id=? AND left_at IS NULL").get(groupId, actorId) as { party_id: string } | undefined;
    if (!m) throw forbid("Only travelers in this group can vote.");
    const party = getParty(m.party_id, d)!;
    if (party.representative_user_id !== actorId) throw forbid("Your party's representative casts its vote. You can still add comments.");
    const sel = selectedProposal(d, groupId);
    if (!sel || sel.id !== input.proposalId) throw conflict("This proposal is no longer the one under vote. Refresh to see the latest.");
    const now = new Date().toISOString();
    d.prepare("UPDATE votes SET invalidated_at=?, invalidated_reason='replaced' WHERE proposal_id=? AND party_id=? AND invalidated_at IS NULL").run(now, sel.id, party.id);
    d.prepare("INSERT INTO votes (id, proposal_id, party_id, user_id, decision, comment) VALUES (?,?,?,?,?,?)").run(newId("vote"), sel.id, party.id, actorId, input.decision, input.comment);
    if (input.comment) {
      d.prepare("INSERT INTO comments (id, group_id, user_id, party_id, proposal_id, body) VALUES (?,?,?,?,?,?)").run(newId("cmt"), groupId, actorId, party.id, sel.id, input.comment);
    }
    logActivity(d, groupId, actorId, "vote.cast", `${party.name} ${input.decision === "approve" ? "approved" : "requested changes"}`);
    syncApproval(d, groupId);
    bumpVersion(d, groupId);
  });
}

export function addComment(actorId: string, groupId: string, body: string) {
  const text = body.trim();
  if (!text) throw invalid("Comment can't be empty.");
  if (text.length > 1000) throw invalid("Comments are limited to 1,000 characters.");
  return tx((d) => {
    const g = requireGroup(d, groupId);
    const m = d.prepare("SELECT party_id FROM party_memberships WHERE group_id=? AND user_id=? AND left_at IS NULL").get(groupId, actorId) as { party_id: string } | undefined;
    if (!m && g.organizer_user_id !== actorId) throw forbid();
    const sel = selectedProposal(d, groupId);
    d.prepare("INSERT INTO comments (id, group_id, user_id, party_id, proposal_id, body) VALUES (?,?,?,?,?,?)").run(newId("cmt"), groupId, actorId, m?.party_id ?? null, sel?.id ?? null, text);
    bumpVersion(d, groupId);
  });
}

export function finalizeAgreement(actorId: string, groupId: string) {
  return tx((d) => {
    const g = requireOrganizer(d, groupId, actorId);
    if (g.status !== "approved") throw invalid("Every required party must approve before finalizing.");
    const st = approvalState(d, groupId);
    if (!st.met || !st.proposalId) throw invalid("Approval threshold not met.");
    const ver = currentVersion(d, groupId)!;
    if (buildInputs(d, groupId).hash !== ver.inputs_hash) throw conflict("Inputs changed since this proposal was generated. Re-run the allocation.");
    const prop = getPropertyForGroup(groupId, d);
    const breakdowns = d.prepare("SELECT * FROM cost_breakdowns WHERE proposal_id=?").all(st.proposalId) as { party_id: string; total_cents: number }[];
    const snapshotId = newId("agr");
    const snapshot = { proposalId: st.proposalId, versionNo: ver.version_no, inputsHash: ver.inputs_hash, finalizedAt: new Date().toISOString() };
    d.prepare("INSERT INTO agreements (id, group_id, proposal_id, snapshot_json, finalized_by) VALUES (?,?,?,?,?)").run(snapshotId, groupId, st.proposalId, JSON.stringify(snapshot), actorId);
    for (const b of breakdowns)
      d.prepare("INSERT INTO ledger_entries (id, group_id, agreement_id, party_id, amount_cents, currency) VALUES (?,?,?,?,?,?)").run(newId("led"), groupId, snapshotId, b.party_id, b.total_cents, prop.currency);
    d.prepare("UPDATE groups SET status='finalized' WHERE id=?").run(groupId);
    logActivity(d, groupId, actorId, "agreement.finalized", "Agreement finalized 🎉");
    bumpVersion(d, groupId);
    return snapshotId;
  });
}

export function reopenAgreement(actorId: string, groupId: string) {
  return tx((d) => {
    const g = requireOrganizer(d, groupId, actorId);
    if (g.status !== "finalized") throw invalid("Only a finalized agreement can be reopened.");
    const now = new Date().toISOString();
    d.prepare("UPDATE agreements SET revoked_at=? WHERE group_id=? AND revoked_at IS NULL").run(now, groupId);
    d.prepare("UPDATE ledger_entries SET status='void' WHERE group_id=? AND status='owed'").run(groupId);
    d.prepare("UPDATE votes SET invalidated_at=?, invalidated_reason='agreement reopened' WHERE invalidated_at IS NULL AND proposal_id IN (SELECT id FROM allocation_proposals WHERE group_id=?)").run(now, groupId);
    d.prepare("UPDATE groups SET status='voting' WHERE id=?").run(groupId);
    logActivity(d, groupId, actorId, "agreement.reopened", "Agreement reopened — approvals reset");
    bumpVersion(d, groupId);
  });
}

/** Called after approval-policy changes. */
export function refreshApproval(groupId: string) {
  return tx((d) => {
    syncApproval(d, groupId);
    bumpVersion(d, groupId);
  });
}

export function getDbForViews() {
  return getDb();
}
