import { getDb } from "../db/client";
import type { AuctionResult, AssignmentMetrics, Diagnosis } from "../engine";
import type { ProposalExplanation } from "../engine/explain";
import type { AttributeKey } from "../engine/types";
import { forbid, notFound } from "./errors";
import {
  activeMembers,
  getGroup,
  getPreferences,
  getPricing,
  getPropertyForGroup,
  getStayForGroup,
  listAmenities,
  listCostItems,
  listParties,
  listRooms,
  STATUS_LABELS,
  type GroupStatus,
} from "./repo";
import { approvalState, buildInputs, currentVersion } from "./services/allocation";

export type GroupView = ReturnType<typeof getGroupView>;
export type ProposalView = GroupView["proposals"][number];
export type RoomView = GroupView["rooms"][number];

/** Everything a page needs about a group, already filtered for what THIS viewer may see. */
export function getGroupView(groupId: string, viewerId: string) {
  const d = getDb();
  const g = getGroup(groupId, d);
  if (!g) throw notFound("Group not found.");
  const isOrganizer = g.organizer_user_id === viewerId;
  const myMembership = d.prepare("SELECT * FROM party_memberships WHERE group_id=? AND user_id=? AND left_at IS NULL").get(groupId, viewerId) as
    | { party_id: string; role: string }
    | undefined;
  if (!isOrganizer && !myMembership) throw forbid("You're not part of this group.");

  const prop = getPropertyForGroup(groupId, d);
  const stay = getStayForGroup(groupId, d);
  const roomRows = listRooms(prop.id, d);
  const amenities = listAmenities(roomRows.map((r) => r.id), d);
  const rooms = roomRows.map((r) => ({
    id: r.id,
    name: r.name,
    shortName: r.short_name,
    sort: r.sort,
    bedConfig: r.bed_config,
    capacity: r.capacity,
    bedCount: r.bed_count,
    hasBunk: !!r.has_bunk,
    accessible: !!r.accessible,
    weightMilli: r.weight_milli,
    qualityRating: r.quality_rating,
    description: r.description,
    imageKey: r.image_key as "master" | "view" | "comfort" | "bunk" | "generic",
    photo: r.photo_data,
    attributes: JSON.parse(r.attributes_json) as Record<AttributeKey, number>,
    amenities: amenities.filter((a) => a.room_id === r.id).map((a) => ({ label: a.label, icon: a.icon })),
  }));
  const costItems = listCostItems(prop.id, d);
  const totalCents = costItems.reduce((a, c) => a + c.amount_cents, 0);
  const pricing = getPricing(groupId, d);

  const parties = listParties(groupId, d).map((p) => {
    const members = activeMembers(p.id, d);
    const pref = getPreferences(p.id, d);
    const mine = myMembership?.party_id === p.id;
    return {
      id: p.id,
      slot: p.slot_label,
      name: p.name,
      status: p.status,
      representativeId: p.representative_user_id,
      members: members.map((m) => ({ id: m.user_id, name: m.display_name, role: p.representative_user_id === m.user_id ? "representative" : "member" })),
      submitted: !!pref,
      submittedAt: pref?.finalized_at ?? null,
      size: pref?.data.partySize ?? Math.max(1, members.length),
      hasBids: !!pref && Object.values(pref.data.bids ?? {}).some((v) => v > 0),
      isMine: mine,
      /** Budget & preference details are private to the party itself. */
      prefs: mine ? pref?.data ?? null : null,
      draftStarted: !!(d.prepare("SELECT 1 FROM questionnaires WHERE party_id=?").get(p.id)),
    };
  });
  const myParty = parties.find((p) => p.isMine) ?? null;
  const travelers = parties.reduce((a, p) => a + (p.members.length ? p.size : 0), 0);

  const cur = currentVersion(d, groupId);
  const lastVersion = d.prepare("SELECT * FROM proposal_versions WHERE group_id=? ORDER BY version_no DESC LIMIT 1").get(groupId) as
    | { id: string; version_no: number; status: string; stale_reason: string | null; created_at: string; inputs_hash: string; engine: string; feasible_count: number; diagnosis_json: string | null; auction_json: string | null }
    | undefined;
  const shownVersion = lastVersion;
  const inputs = buildInputs(d, groupId);
  const myBudget = myParty?.prefs ? { ideal: myParty.prefs.idealBudgetCents, max: myParty.prefs.maxBudgetCents, hard: myParty.prefs.hardMax } : null;

  const proposalRows = shownVersion
    ? (d.prepare("SELECT * FROM allocation_proposals WHERE version_id=? ORDER BY rank").all(shownVersion.id) as {
        id: string; rank: number; label: string; strategies_json: string; scores_json: string; metrics_json: string; explanation_json: string; is_selected: number;
      }[])
    : [];
  const snapshotParties = shownVersion
    ? (JSON.parse((d.prepare("SELECT inputs_snapshot_json FROM proposal_versions WHERE id=?").get(shownVersion.id) as { inputs_snapshot_json: string }).inputs_snapshot_json).parties as {
        id: string; budget: { idealCents: number; maxCents: number; hardMax: boolean };
      }[])
    : [];

  const proposals = proposalRows.map((p) => {
    const rows = d
      .prepare("SELECT cb.*, ra.room_id FROM cost_breakdowns cb JOIN room_assignments ra ON ra.proposal_id=cb.proposal_id AND ra.party_id=cb.party_id WHERE cb.proposal_id=?")
      .all(p.id) as {
      party_id: string; room_id: string; party_size: number; shared_cents: number; room_cents: number; total_cents: number; per_person_json: string;
      share_bps: number; rank_position: number; satisfaction: number; fit: number; afford: number;
    }[];
    const ex = JSON.parse(p.explanation_json) as ProposalExplanation;
    const explanation = {
      ...ex,
      parties: ex.parties.map((pe) => (pe.partyId === myParty?.id ? pe : { ...pe, privateFacts: [] })),
    };
    const assignments = rows
      .map((r) => {
        const b = snapshotParties.find((x) => x.id === r.party_id)?.budget;
        const mine = r.party_id === myParty?.id;
        return {
          partyId: r.party_id,
          roomId: r.room_id,
          size: r.party_size,
          sharedCents: r.shared_cents,
          roomCents: r.room_cents,
          totalCents: r.total_cents,
          perPersonCents: JSON.parse(r.per_person_json) as number[],
          shareBps: r.share_bps,
          rankPosition: r.rank_position,
          satisfaction: r.satisfaction,
          /** Organizer and the party itself see whether it's within the max budget; only the party sees utilization. */
          withinBudget: mine || isOrganizer ? (b ? r.total_cents <= b.maxCents : null) : null,
          budgetUseBps: mine && b && b.maxCents > 0 ? Math.round((r.total_cents * 10000) / b.maxCents) : null,
          underIdealCents: mine && b ? b.idealCents - r.total_cents : null,
        };
      })
      .sort((a, b) => parties.findIndex((x) => x.id === a.partyId) - parties.findIndex((x) => x.id === b.partyId));
    return {
      id: p.id,
      rank: p.rank,
      label: p.label,
      strategies: JSON.parse(p.strategies_json) as string[],
      scores: JSON.parse(p.scores_json) as Record<string, number>,
      metrics: JSON.parse(p.metrics_json) as AssignmentMetrics,
      isSelected: !!p.is_selected,
      explanation,
      assignments,
      totalCents: rows.reduce((a, r) => a + r.total_cents, 0),
    };
  });

  const approval = cur ? approvalState(d, groupId) : null;
  const votes = approval?.votes.map((v) => ({ partyId: v.party_id, decision: v.decision, comment: v.comment, by: v.display_name, at: v.created_at })) ?? [];

  const comments = (d
    .prepare("SELECT c.*, u.display_name FROM comments c JOIN users u ON u.id=c.user_id WHERE c.group_id=? ORDER BY c.created_at DESC LIMIT 50")
    .all(groupId) as { id: string; party_id: string | null; proposal_id: string | null; body: string; created_at: string; display_name: string }[]).map((c) => ({
    id: c.id, partyId: c.party_id, proposalId: c.proposal_id, body: c.body, at: c.created_at, by: c.display_name,
  }));
  const activity = (d
    .prepare("SELECT a.*, u.display_name FROM activity_events a LEFT JOIN users u ON u.id=a.user_id WHERE a.group_id=? ORDER BY a.created_at DESC, a.rowid DESC LIMIT 40")
    .all(groupId) as { id: string; type: string; message: string; created_at: string; display_name: string | null }[]).map((a) => ({ id: a.id, type: a.type, message: a.message, at: a.created_at, by: a.display_name }));
  const versions = (d.prepare("SELECT version_no, status, stale_reason, created_at, feasible_count FROM proposal_versions WHERE group_id=? ORDER BY version_no DESC").all(groupId) as {
    version_no: number; status: string; stale_reason: string | null; created_at: string; feasible_count: number;
  }[]).map((v) => ({ no: v.version_no, status: v.status, staleReason: v.stale_reason, at: v.created_at, feasible: v.feasible_count }));

  const agreementRow = d.prepare("SELECT * FROM agreements WHERE group_id=? AND revoked_at IS NULL ORDER BY finalized_at DESC LIMIT 1").get(groupId) as
    | { id: string; proposal_id: string; finalized_at: string; snapshot_json: string }
    | undefined;
  const ledger = agreementRow
    ? (d.prepare("SELECT party_id, amount_cents, currency, status FROM ledger_entries WHERE agreement_id=?").all(agreementRow.id) as { party_id: string; amount_cents: number; currency: string; status: string }[])
    : [];

  let auction: null | {
    feasible: boolean; envyFree: boolean; conflicts: string[]; suggestions: string[]; marketWeights: Record<string, number>;
    rooms: { roomId: string; bidCount: number; clearingCents: number | null; weightedCents: number | null; premiumCents: number | null; winnerPartyId: string | null; highestCents: number | null; secondCents: number | null }[];
    mySurplusCents: number | null; myBidCents: number | null;
  } = null;
  if (shownVersion?.auction_json) {
    const a = JSON.parse(shownVersion.auction_json) as AuctionResult;
    auction = {
      feasible: a.feasible,
      envyFree: a.envyFree,
      conflicts: isOrganizer ? a.conflicts : a.conflicts.filter((c) => !c.includes("$") || (myParty && c.startsWith(myParty.name))),
      suggestions: a.suggestions,
      marketWeights: a.marketWeights,
      // Raw bid levels are private; only the organizer sees the top-two bid spread (no party names attached).
      rooms: a.rooms.map((r) => ({ ...r, highestCents: isOrganizer ? r.highestCents : null, secondCents: isOrganizer ? r.secondCents : null })),
      mySurplusCents: myParty ? a.surplus[myParty.id] ?? null : null,
      myBidCents: myParty && a.assignment ? (myParty.prefs?.bids?.[a.assignment[myParty.id]] ?? null) : null,
    };
  }

  const status = g.status as GroupStatus;
  return {
    group: { id: g.id, name: g.name, status, statusLabel: STATUS_LABELS[status], maxParties: g.max_parties, maxPartySize: g.max_party_size, approvalPolicy: g.approval_policy, isDemo: !!g.is_demo, version: g.version },
    isOrganizer,
    viewerId: viewerId,
    organizerName: (d.prepare("SELECT display_name FROM users WHERE id=?").get(g.organizer_user_id) as { display_name: string }).display_name,
    property: {
      id: prop.id, name: prop.name, location: prop.location, description: prop.description, currency: prop.currency, listingUrl: prop.listing_url,
      sourceKind: prop.source_kind, sharedAmenities: JSON.parse(prop.shared_amenities_json) as string[], checkIn: stay.check_in, checkOut: stay.check_out,
    },
    costItems: costItems.map((c) => ({ label: c.label, kind: c.kind, amountCents: c.amount_cents })),
    totalCents,
    pricing: { sharedBps: pricing.shared_bps, method: pricing.method },
    rooms,
    parties,
    myParty,
    myBudget,
    travelers,
    missing: inputs.missing,
    version: shownVersion
      ? {
          id: shownVersion.id, no: shownVersion.version_no, status: shownVersion.status, staleReason: shownVersion.stale_reason, at: shownVersion.created_at,
          engine: shownVersion.engine, feasible: shownVersion.feasible_count,
          diagnosis: shownVersion.diagnosis_json ? (JSON.parse(shownVersion.diagnosis_json) as Diagnosis) : null,
          inputsChanged: shownVersion.inputs_hash !== inputs.hash,
        }
      : null,
    proposals,
    selected: proposals.find((p) => p.isSelected) ?? null,
    approval: approval ? { votes, approvals: approval.approvals, needed: approval.needed, met: approval.met } : null,
    comments,
    activity,
    versions,
    agreement: agreementRow ? { id: agreementRow.id, proposalId: agreementRow.proposal_id, finalizedAt: agreementRow.finalized_at, ledger } : null,
    auction,
  };
}

export function listMyGroups(userId: string) {
  const d = getDb();
  return d
    .prepare(
      `SELECT DISTINCT g.id, g.name, g.status, g.created_at FROM groups g
       LEFT JOIN party_memberships m ON m.group_id=g.id AND m.left_at IS NULL
       WHERE g.organizer_user_id=? OR m.user_id=? ORDER BY g.created_at DESC`,
    )
    .all(userId, userId) as { id: string; name: string; status: GroupStatus; created_at: string }[];
}
