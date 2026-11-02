import { ATTRIBUTE_KEYS, type AttributeKey, type PartyInput, type PriorityKey, type RoomInput } from "./types";
import type { PricingResult } from "./pricing";

/**
 * Scoring model (all component scores are normalized to 0..1 PER PARTY, never per person,
 * so a two-person party carries exactly the same weight as a solo traveler).
 *
 *   rankScore(p,r)  = 1 − position(r in p's ranking) / (R − 1)
 *   attrScore(p,r)  = Σ_a w_a · level(r,a) / Σ_a w_a        (w_a = stated 0–5 importance × top-3 boost)
 *   fit(p,r)        = 0.55 · rankScore + 0.45 · attrScore
 *   afford(p,c)     = 1 if c ≤ ideal; linear decline to (1 − k) at max; infeasible above a HARD max
 *   satisfaction    = 0.65 · fit + 0.35 · afford
 *   envy(p)         = max over other parties q of [ satisfaction(p in q's room at p's price there) − satisfaction(p) ]⁺
 */
export const SCORING_WEIGHTS = {
  fit: { rank: 0.55, attributes: 0.45 },
  satisfaction: { fit: 0.65, afford: 0.35 },
  topPriorityBoost: [1.6, 1.35, 1.15],
  /** Satisfaction lost when paying exactly the max budget (before flex/premium adjustments). */
  stretchPenalty: 0.6,
  strategies: {
    balanced: { minSatisfaction: 0.4, meanSatisfaction: 0.3, meanAfford: 0.15, envyFree: 0.15 },
    budget: { minAfford: 0.3, meanAfford: 0.2, meanHeadroom: 0.2, minSatisfaction: 0.2, envyFree: 0.1 },
    preference: { meanFit: 0.55, minFit: 0.3, envyFree: 0.15 },
  },
} as const;

export type StrategyKey = keyof typeof SCORING_WEIGHTS.strategies;
export const STRATEGY_LABELS: Record<StrategyKey | "auction", string> = {
  auction: "Market auction",
  balanced: "Recommended · Balanced",
  budget: "Budget-conscious",
  preference: "Preference-first",
};
export const STRATEGY_DESCRIPTIONS: Record<StrategyKey | "auction", string> = {
  auction: "Rooms go to the highest-value bids; envy-free clearing prices are discovered from what parties said they'd pay.",
  balanced: "Protects the least-satisfied party first, then maximizes overall satisfaction and affordability.",
  budget: "Keeps every party as far under their budgets as possible, accepting weaker room matches.",
  preference: "Gives parties the rooms they ranked highest, with less weight on price.",
};

export type StaticBlock =
  | { kind: "capacity"; capacity: number; size: number }
  | { kind: "separateBeds"; beds: number; size: number }
  | { kind: "bunk" }
  | { kind: "accessible" }
  | { kind: "refused" };

/** Hard constraints that do not depend on price. */
export function staticBlocks(party: PartyInput, room: RoomInput): StaticBlock[] {
  const out: StaticBlock[] = [];
  if (room.capacity < party.size) out.push({ kind: "capacity", capacity: room.capacity, size: party.size });
  if (party.requirements.separateBeds && party.size > 1 && room.bedCount < party.size)
    out.push({ kind: "separateBeds", beds: room.bedCount, size: party.size });
  if (party.requirements.noBunk && room.hasBunk) out.push({ kind: "bunk" });
  if (party.requirements.accessible && !room.accessible) out.push({ kind: "accessible" });
  if (party.refusedRooms.includes(room.id)) out.push({ kind: "refused" });
  return out;
}

export function describeBlock(b: StaticBlock, roomName: string): string {
  switch (b.kind) {
    case "capacity":
      return `${roomName} sleeps ${b.capacity}, party has ${b.size}`;
    case "separateBeds":
      return `${roomName} has ${b.beds} sleeping surface${b.beds === 1 ? "" : "s"}; party needs ${b.size} separate beds`;
    case "bunk":
      return `${roomName} uses bunks, which the party cannot use`;
    case "accessible":
      return `${roomName} is not marked accessible`;
    case "refused":
      return `the party refused ${roomName}`;
  }
}

export function rankPosition(party: PartyInput, room: RoomInput, rooms: RoomInput[]): number {
  const idx = party.roomRanking.indexOf(room.id);
  if (idx >= 0) return idx;
  // Unranked rooms go after ranked ones, in room order.
  const unranked = rooms
    .filter((r) => !party.roomRanking.includes(r.id))
    .sort((a, b) => a.sort - b.sort || a.id.localeCompare(b.id));
  return party.roomRanking.filter((id) => rooms.some((r) => r.id === id)).length + unranked.findIndex((r) => r.id === room.id);
}

export function rankScore(party: PartyInput, room: RoomInput, rooms: RoomInput[]): number {
  if (rooms.length <= 1) return 1;
  return 1 - rankPosition(party, room, rooms) / (rooms.length - 1);
}

export function priorityWeights(party: PartyInput): Record<PriorityKey, number> {
  const w = { ...party.priorities } as Record<PriorityKey, number>;
  party.topPriorities.slice(0, 3).forEach((k, i) => {
    // A ranked top priority counts even if its slider was left low.
    w[k] = Math.max(w[k] ?? 0, 3) * SCORING_WEIGHTS.topPriorityBoost[i];
  });
  return w;
}

/** cheapness: 0..1 per room, 1 = cheapest occupied room. */
export function attributeScore(party: PartyInput, room: RoomInput, cheapness: Record<string, number>): number {
  const w = priorityWeights(party);
  let num = 0;
  let den = 0;
  for (const a of ATTRIBUTE_KEYS) {
    num += (w[a] ?? 0) * clamp01(room.attributes[a as AttributeKey] ?? 0);
    den += w[a] ?? 0;
  }
  num += (w.lowPrice ?? 0) * (cheapness[room.id] ?? 0.5);
  den += w.lowPrice ?? 0;
  return den === 0 ? 0.5 : num / den;
}

export function fitScore(party: PartyInput, room: RoomInput, rooms: RoomInput[], cheapness: Record<string, number>): number {
  return (
    SCORING_WEIGHTS.fit.rank * rankScore(party, room, rooms) +
    SCORING_WEIGHTS.fit.attributes * attributeScore(party, room, cheapness)
  );
}

/** Returns null when the cost breaks a HARD maximum. */
export function affordScore(party: PartyInput, costCents: number, isFirstChoice: boolean): number | null {
  const { idealCents, maxCents, hardMax, premiumFlex } = party.budget;
  const ideal = Math.min(idealCents, maxCents);
  let k = SCORING_WEIGHTS.stretchPenalty - 0.06 * clamp(premiumFlex, 0, 5);
  if (isFirstChoice && party.premiumForFirstChoice) k *= 0.5;
  if (costCents <= ideal) return 1;
  if (costCents <= maxCents) return 1 - (k * (costCents - ideal)) / Math.max(1, maxCents - ideal);
  if (hardMax) return null;
  return Math.max(0, 1 - k - (2 * (costCents - maxCents)) / Math.max(1, maxCents));
}

export function satisfaction(fit: number, afford: number): number {
  return SCORING_WEIGHTS.satisfaction.fit * fit + SCORING_WEIGHTS.satisfaction.afford * afford;
}

export function cheapnessMap(pricing: PricingResult): Record<string, number> {
  const entries = Object.entries(pricing.roomCosts);
  if (entries.length === 0) return {};
  const vals = entries.map(([, v]) => v);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  return Object.fromEntries(entries.map(([id, v]) => [id, max === min ? 1 : 1 - (v - min) / (max - min)]));
}

export function matchedPriorities(party: PartyInput, room: RoomInput, cheapness: Record<string, number>): PriorityKey[] {
  const w = priorityWeights(party);
  const keys = (Object.keys(w) as PriorityKey[])
    .filter((k) => (w[k] ?? 0) >= 3)
    .filter((k) => (k === "lowPrice" ? (cheapness[room.id] ?? 0) >= 0.6 : (room.attributes[k as AttributeKey] ?? 0) >= 0.6));
  return keys.sort((a, b) => (w[b] ?? 0) - (w[a] ?? 0));
}

export function clamp01(x: number) {
  return clamp(x, 0, 1);
}
export function clamp(x: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, x));
}
