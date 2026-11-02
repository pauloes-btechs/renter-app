"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { AppError } from "@/lib/server/errors";
import { clearSessionCookie, getViewer, isDemoEnabled, setSessionCookie } from "@/lib/server/session";
import { createAccessLink } from "@/lib/server/services/auth";
import {
  createGroup, deleteRoom, setCostItems, startCollecting, updatePricing, updatePropertyDetails, updateRules, upsertRoom, type RoomEdit,
} from "@/lib/server/services/groups";
import { addPartySlot, createInvitation, joinViaInvitation, leaveParty, removeParty, revokeInvitation, setRepresentative } from "@/lib/server/services/parties";
import { saveDraft, shareDraft, submitPreferences } from "@/lib/server/services/questionnaire";
import {
  addComment, applyMarketWeights, castVote, finalizeAgreement, openVoting, reopenAgreement, runOptimization, selectProposal,
} from "@/lib/server/services/allocation";
import { seedDemo } from "@/lib/demo/seed";

export type ActionResult<T = unknown> = { ok: true; data?: T; redirect?: string } | { ok: false; error: string };

async function run<T>(fn: (userId: string) => T | Promise<T>, opts: { auth?: boolean } = { auth: true }): Promise<ActionResult<T>> {
  try {
    let uid = "";
    if (opts.auth !== false) {
      const v = await getViewer();
      if (!v) return { ok: false, error: "Your session has expired. Open your personal link again." };
      uid = v.id;
    }
    const data = await fn(uid);
    revalidatePath("/", "layout");
    return { ok: true, data };
  } catch (e) {
    if (e instanceof AppError) return { ok: false, error: e.message };
    if (e instanceof ZodError) return { ok: false, error: e.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ") };
    console.error(e);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

export async function createGroupAction(input: Parameters<typeof createGroup>[0]): Promise<ActionResult<{ groupId: string }>> {
  const viewer = await getViewer();
  const r = await run(() => createGroup(input, viewer?.id ?? null), { auth: false });
  if (!r.ok) return r;
  const out = r.data!;
  if (out.sessionToken) await setSessionCookie(out.sessionToken);
  return { ok: true, data: { groupId: out.groupId }, redirect: `/group/${out.groupId}/property` };
}

export async function updatePropertyAction(groupId: string, input: Parameters<typeof updatePropertyDetails>[2]) {
  return run((u) => updatePropertyDetails(u, groupId, input));
}
export async function setCostItemsAction(groupId: string, items: Parameters<typeof setCostItems>[2]) {
  return run((u) => setCostItems(u, groupId, items));
}
export async function updatePricingAction(groupId: string, input: Parameters<typeof updatePricing>[2]) {
  return run((u) => updatePricing(u, groupId, input));
}
export async function upsertRoomAction(groupId: string, room: RoomEdit) {
  return run((u) => upsertRoom(u, groupId, room));
}
export async function deleteRoomAction(groupId: string, roomId: string) {
  return run((u) => deleteRoom(u, groupId, roomId));
}
export async function updateRulesAction(groupId: string, input: Parameters<typeof updateRules>[2]) {
  return run((u) => updateRules(u, groupId, input));
}
export async function startCollectingAction(groupId: string) {
  const r = await run((u) => startCollecting(u, groupId));
  return r.ok ? { ...r, redirect: `/group/${groupId}/invites` } : r;
}

export async function addPartySlotAction(groupId: string) {
  return run((u) => addPartySlot(u, groupId));
}
export async function removePartyAction(groupId: string, partyId: string) {
  return run((u) => removeParty(u, groupId, partyId));
}
export async function createInvitationAction(groupId: string, partyId: string | null, label = "") {
  return run((u) => createInvitation(u, groupId, { partyId, label }).id);
}
export async function revokeInvitationAction(groupId: string, invitationId: string) {
  return run((u) => revokeInvitation(u, groupId, invitationId));
}
export async function setRepresentativeAction(partyId: string, userId: string) {
  return run((u) => setRepresentative(u, partyId, userId));
}
export async function leavePartyAction(groupId: string) {
  const r = await run((u) => leaveParty(u, groupId));
  return r.ok ? { ...r, redirect: "/trips" } : r;
}

export async function joinAction(token: string, input: { displayName: string; partyId?: string }): Promise<ActionResult> {
  const viewer = await getViewer();
  const r = await run(() => joinViaInvitation(token, input, viewer?.id ?? null), { auth: false });
  if (!r.ok) return r;
  const out = r.data!;
  if (out.sessionToken) await setSessionCookie(out.sessionToken);
  return { ok: true, redirect: `/onboarding/${out.partyId}` };
}

export async function saveDraftAction(partyId: string, draft: unknown) {
  return run((u) => {
    saveDraft(u, partyId, draft);
    return { savedAt: new Date().toISOString() };
  });
}
export async function shareDraftAction(partyId: string) {
  return run((u) => shareDraft(u, partyId));
}
export async function submitPreferencesAction(partyId: string) {
  const r = await run((u) => submitPreferences(u, partyId));
  return r.ok ? { ok: true as const, redirect: `/party/${partyId}?submitted=1` } : r;
}

export async function runOptimizationAction(groupId: string) {
  const r = await run((u) => {
    const out = runOptimization(u, groupId);
    return { reused: out.reused, proposals: out.result?.proposals.length ?? null };
  });
  return r.ok ? { ...r, redirect: `/results/${groupId}` } : r;
}
export async function selectProposalAction(groupId: string, proposalId: string) {
  return run((u) => selectProposal(u, groupId, proposalId));
}
export async function openVotingAction(groupId: string) {
  return run((u) => openVoting(u, groupId));
}
export async function castVoteAction(groupId: string, input: { proposalId: string; decision: "approve" | "request_changes"; comment?: string }) {
  return run((u) => castVote(u, groupId, input));
}
export async function addCommentAction(groupId: string, body: string) {
  return run((u) => addComment(u, groupId, body));
}
export async function finalizeAction(groupId: string) {
  const r = await run((u) => finalizeAgreement(u, groupId));
  return r.ok ? { ...r, redirect: `/results/${groupId}/agreement` } : r;
}
export async function reopenAction(groupId: string) {
  return run((u) => reopenAgreement(u, groupId));
}
export async function applyMarketWeightsAction(groupId: string) {
  return run((u) => applyMarketWeights(u, groupId));
}

export async function rotateAccessLinkAction(): Promise<ActionResult<{ token: string }>> {
  return run((u) => ({ token: createAccessLink(u, { rotate: true }) }));
}

export async function signOutAction(): Promise<ActionResult> {
  await clearSessionCookie();
  return { ok: true, redirect: "/" };
}

export async function resetDemoAction(): Promise<ActionResult> {
  if (!isDemoEnabled()) return { ok: false, error: "Demo mode is disabled." };
  const r = await run(() => seedDemo().groupId, { auth: false });
  if (!r.ok) return r;
  await clearSessionCookie();
  return { ok: true, redirect: "/demo?reset=1" };
}

export async function inspectListingAction(groupId: string, url: string, details: Parameters<typeof updatePropertyDetails>[2]) {
  const { analyzeListingUrl } = await import("@/lib/ingestion");
  const a = analyzeListingUrl(url);
  if (!a.valid) return { ok: false as const, error: a.message };
  const r = await run((u) => updatePropertyDetails(u, groupId, { ...details, listingUrl: url }));
  return r.ok ? { ok: true as const, data: a.message } : r;
}
