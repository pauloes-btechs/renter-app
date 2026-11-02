import { getDb, tx } from "../../db/client";
import {
  defaultQuestionnaire,
  draftSchema,
  finalQuestionnaireSchema,
  mergeDraft,
  type QuestionnaireData,
  type QuestionnaireDraft,
} from "../../domain/questionnaire";
import { newId } from "../crypto";
import { forbid, invalid, notFound } from "../errors";
import {
  activeMembers,
  bumpVersion,
  getGroup,
  getParty,
  getPreferences,
  getPropertyForGroup,
  listRooms,
  logActivity,
  membershipFor,
} from "../repo";
import { assertNotFinalized, materialChange, recomputeStatus } from "./groups";

function requirePartyMember(actorId: string, partyId: string) {
  const d = getDb();
  const party = getParty(partyId, d);
  if (!party || party.status === "left") throw notFound("Party not found.");
  const m = membershipFor(party.group_id, actorId, d);
  if (!m || m.party_id !== partyId) throw forbid("Only members of this party can see or edit its questionnaire.");
  return { party, membership: m, group: getGroup(party.group_id, d)! };
}

/** The actor's own draft (created from the party's submitted answers, or defaults). */
export function getDraft(actorId: string, partyId: string): QuestionnaireData {
  const { party } = requirePartyMember(actorId, partyId);
  const d = getDb();
  const row = d.prepare("SELECT data_json FROM questionnaires WHERE party_id=? AND user_id=?").get(partyId, actorId) as { data_json: string } | undefined;
  const roomIds = listRooms(getPropertyForGroup(party.group_id, d).id, d).map((r) => r.id);
  const base = getPreferences(partyId, d)?.data ?? defaultQuestionnaire(party.name.startsWith("Party ") ? "" : party.name, roomIds, Math.max(1, activeMembers(partyId, d).length));
  if (!row) return { ...base, roomRanking: normalizeRanking(base.roomRanking, roomIds) };
  const merged = mergeDraft(base, JSON.parse(row.data_json) as QuestionnaireDraft);
  return { ...merged, roomRanking: normalizeRanking(merged.roomRanking, roomIds), refusedRooms: merged.refusedRooms.filter((r) => roomIds.includes(r)) };
}

function normalizeRanking(ranking: string[], roomIds: string[]) {
  const out = ranking.filter((r) => roomIds.includes(r));
  for (const r of roomIds) if (!out.includes(r)) out.push(r);
  return out;
}

/** Autosave. Never a material change — only submitting finalizes. */
export function saveDraft(actorId: string, partyId: string, raw: unknown) {
  const draft = draftSchema.parse(raw);
  const { group } = requirePartyMember(actorId, partyId);
  assertNotFinalized(group);
  return tx((d) => {
    const current = getDraft(actorId, partyId);
    const merged = mergeDraft(current, draft);
    d.prepare(
      `INSERT INTO questionnaires (id, party_id, user_id, data_json, updated_at) VALUES (?,?,?,?,?)
       ON CONFLICT(party_id, user_id) DO UPDATE SET data_json=excluded.data_json, updated_at=excluded.updated_at`,
    ).run(newId("qst"), partyId, actorId, JSON.stringify(merged), new Date().toISOString());
    bumpVersion(d, group.id);
    return merged;
  });
}

/** A non-representative member shares their input with the representative. */
export function shareDraft(actorId: string, partyId: string) {
  const { group, party } = requirePartyMember(actorId, partyId);
  return tx((d) => {
    const data = getDraft(actorId, partyId);
    d.prepare(
      `INSERT INTO questionnaires (id, party_id, user_id, data_json, updated_at, shared_at) VALUES (?,?,?,?,?,?)
       ON CONFLICT(party_id, user_id) DO UPDATE SET data_json=excluded.data_json, shared_at=excluded.shared_at, updated_at=excluded.updated_at`,
    ).run(newId("qst"), partyId, actorId, JSON.stringify(data), new Date().toISOString(), new Date().toISOString());
    logActivity(d, group.id, actorId, "preferences.shared", `A member of ${party.name} shared their preferences with the representative`);
    bumpVersion(d, group.id);
  });
}

/** Representative finalizes the party's answers from their own draft. */
export function submitPreferences(actorId: string, partyId: string) {
  const { party, group } = requirePartyMember(actorId, partyId);
  assertNotFinalized(group);
  const members = activeMembers(partyId);
  const isRep = party.representative_user_id === actorId || members.length === 1;
  if (!isRep) throw forbid("Only the party representative can submit the party's final answers. Share your input with them instead.");
  const data = getDraft(actorId, partyId);
  const parsed = finalQuestionnaireSchema.safeParse({ ...data, step: 4 });
  if (!parsed.success) throw invalid(parsed.error.issues.map((i) => i.message).join(" "));
  const q = parsed.data;
  if (q.maxBudgetCents <= 0) throw invalid("Please enter your party's maximum budget.");
  if (q.partySize < members.length) throw invalid(`Your party already has ${members.length} members — party size can't be smaller.`);
  if (q.partySize > group.max_party_size) throw invalid(`This group allows at most ${group.max_party_size} travelers per party.`);
  if (q.topPriorities.length === 0) throw invalid("Pick at least one top priority.");
  return tx((d) => {
    const prev = getPreferences(partyId, d);
    const unchanged = prev && JSON.stringify({ ...prev.data, step: 4 }) === JSON.stringify({ ...q, step: 4 });
    if (prev) {
      d.prepare("UPDATE party_preferences SET data_json=?, finalized_by=?, finalized_at=?, version=version+1 WHERE party_id=?").run(
        JSON.stringify(q), actorId, new Date().toISOString(), partyId,
      );
    } else {
      d.prepare("INSERT INTO party_preferences (id, party_id, data_json, finalized_by) VALUES (?,?,?,?)").run(newId("pref"), partyId, JSON.stringify(q), actorId);
    }
    d.prepare("UPDATE parties SET name=? WHERE id=?").run(q.partyName, partyId);
    d.prepare("UPDATE questionnaires SET data_json=? WHERE party_id=? AND user_id=?").run(JSON.stringify(q), partyId, actorId);
    logActivity(d, group.id, actorId, "preferences.submitted", `${q.partyName} ${prev ? "updated" : "submitted"} their preferences`);
    if (unchanged) {
      recomputeStatus(d, group.id);
      bumpVersion(d, group.id);
    } else {
      materialChange(d, group.id, actorId, `${q.partyName} ${prev ? "changed" : "submitted"} preferences`);
    }
    return q;
  });
}
