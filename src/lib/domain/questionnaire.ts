import { z } from "zod";
import { PRIORITY_KEYS, type PartyInput, type PriorityKey } from "../engine/types";

const priorityShape = Object.fromEntries(PRIORITY_KEYS.map((k) => [k, z.number().int().min(0).max(5)])) as Record<
  PriorityKey,
  z.ZodNumber
>;

/** Questionnaire answers. Budgets are integer cents for the WHOLE PARTY for the whole stay. */
export const questionnaireSchema = z.object({
  step: z.number().int().min(0).max(4).default(0),
  partyName: z.string().trim().min(1).max(60),
  partySize: z.number().int().min(1).max(12),
  sharingBed: z.boolean(),
  separateBeds: z.boolean(),
  noBunk: z.boolean(),
  accessible: z.boolean(),
  otherRequirements: z.string().max(500).default(""),
  idealBudgetCents: z.number().int().min(0).max(100_000_000),
  maxBudgetCents: z.number().int().min(0).max(100_000_000),
  hardMax: z.boolean(),
  premiumFlex: z.number().int().min(0).max(5),
  priorities: z.object(priorityShape),
  topPriorities: z.array(z.enum(PRIORITY_KEYS)).max(3),
  roomRanking: z.array(z.string()).max(50),
  refusedRooms: z.array(z.string()).max(50),
  premiumForFirstChoice: z.boolean(),
  /** Auction bids: roomId → party total in cents. */
  bids: z.record(z.string(), z.number().int().min(0).max(100_000_000)).default({}),
});
export type QuestionnaireData = z.infer<typeof questionnaireSchema>;

/** Drafts may be partial / invalid while the user is typing. */
export const draftSchema = questionnaireSchema.partial().extend({
  priorities: questionnaireSchema.shape.priorities.partial().optional(),
  bids: z.record(z.string(), z.number().int().min(0).max(100_000_000)).optional(),
});
export type QuestionnaireDraft = z.infer<typeof draftSchema>;

export const finalQuestionnaireSchema = questionnaireSchema
  .refine((q) => q.idealBudgetCents <= q.maxBudgetCents, { message: "Ideal budget must be at or below the maximum budget", path: ["idealBudgetCents"] })
  .refine((q) => new Set(q.topPriorities).size === q.topPriorities.length, { message: "Top priorities must be distinct", path: ["topPriorities"] });

export function defaultQuestionnaire(partyName: string, roomIds: string[], size = 1): QuestionnaireData {
  return {
    step: 0,
    partyName,
    partySize: size,
    sharingBed: size > 1,
    separateBeds: false,
    noBunk: false,
    accessible: false,
    otherRequirements: "",
    idealBudgetCents: 0,
    maxBudgetCents: 0,
    hardMax: true,
    premiumFlex: 2,
    priorities: { lowPrice: 3, privacy: 3, privateBath: 2, view: 2, bedComfort: 3, roomSize: 2, relaxation: 1, quality: 3 },
    topPriorities: [],
    roomRanking: [...roomIds],
    refusedRooms: [],
    premiumForFirstChoice: false,
    bids: {},
  };
}

export function mergeDraft(base: QuestionnaireData, draft: QuestionnaireDraft): QuestionnaireData {
  return {
    ...base,
    ...draft,
    priorities: { ...base.priorities, ...(draft.priorities ?? {}) },
    bids: draft.bids ? { ...draft.bids } : { ...(base.bids ?? {}) },
  } as QuestionnaireData;
}

export function toPartyInput(id: string, sort: number, q: QuestionnaireData, roomIds: string[]): PartyInput {
  // Keep only rooms that still exist; append any new rooms at the end of the ranking.
  const ranking = q.roomRanking.filter((r) => roomIds.includes(r));
  for (const r of roomIds) if (!ranking.includes(r)) ranking.push(r);
  return {
    id,
    sort,
    name: q.partyName,
    size: q.partySize,
    requirements: { separateBeds: q.separateBeds, noBunk: q.noBunk, accessible: q.accessible },
    budget: { idealCents: Math.min(q.idealBudgetCents, q.maxBudgetCents), maxCents: q.maxBudgetCents, hardMax: q.hardMax, premiumFlex: q.premiumFlex },
    priorities: q.priorities,
    topPriorities: q.topPriorities,
    roomRanking: ranking,
    refusedRooms: q.refusedRooms.filter((r) => roomIds.includes(r)),
    premiumForFirstChoice: q.premiumForFirstChoice,
    bids: Object.fromEntries(Object.entries(q.bids ?? {}).filter(([r, v]) => roomIds.includes(r) && v > 0)),
  };
}

/** Field-level differences between two questionnaires (for resolving party-member disagreements). */
export function diffQuestionnaires(a: QuestionnaireData, b: QuestionnaireData): string[] {
  const out: string[] = [];
  const keys: (keyof QuestionnaireData)[] = [
    "partySize", "sharingBed", "separateBeds", "noBunk", "accessible", "idealBudgetCents", "maxBudgetCents", "hardMax",
    "premiumFlex", "premiumForFirstChoice",
  ];
  for (const k of keys) if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) out.push(k);
  if (JSON.stringify(a.priorities) !== JSON.stringify(b.priorities)) out.push("priorities");
  if (JSON.stringify(a.topPriorities) !== JSON.stringify(b.topPriorities)) out.push("topPriorities");
  if (JSON.stringify(a.roomRanking) !== JSON.stringify(b.roomRanking)) out.push("roomRanking");
  if (JSON.stringify(a.bids ?? {}) !== JSON.stringify(b.bids ?? {})) out.push("bids");
  if (JSON.stringify([...a.refusedRooms].sort()) !== JSON.stringify([...b.refusedRooms].sort())) out.push("refusedRooms");
  return out;
}

export const FIELD_LABELS: Record<string, string> = {
  partySize: "Party size",
  sharingBed: "Sharing a bed",
  separateBeds: "Separate sleeping surfaces",
  noBunk: "No bunk beds",
  accessible: "Accessibility",
  idealBudgetCents: "Ideal budget",
  maxBudgetCents: "Maximum budget",
  hardMax: "Hard budget limit",
  premiumFlex: "Premium flexibility",
  premiumForFirstChoice: "Premium for first choice",
  priorities: "Priority sliders",
  topPriorities: "Top three priorities",
  roomRanking: "Room ranking",
  refusedRooms: "Refused rooms",
  bids: "Auction bids",
};
