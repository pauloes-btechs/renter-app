import { priceAssignment, type PricingResult } from "./pricing";
import {
  SCORING_WEIGHTS,
  STRATEGY_LABELS,
  affordScore,
  cheapnessMap,
  describeBlock,
  fitScore,
  matchedPriorities,
  rankPosition,
  satisfaction,
  staticBlocks,
  type StrategyKey,
} from "./scoring";
import type { Assignment, PartyInput, PricingConfig, PriorityKey, RoomInput } from "./types";
import { formatMoney, splitEqually } from "./money";

export interface PartyEvaluation {
  partyId: string;
  roomId: string;
  rankPosition: number; // 0-based
  fit: number;
  afford: number;
  satisfaction: number;
  costCents: number;
  overIdealCents: number;
  overMaxCents: number;
  headroom: number; // (max − cost)/max clamped 0..1
  matched: PriorityKey[];
  envy: { partyId: string; roomId: string; gain: number } | null;
}

export interface AssignmentMetrics {
  minSatisfaction: number;
  meanSatisfaction: number;
  minFit: number;
  meanFit: number;
  minAfford: number;
  meanAfford: number;
  meanHeadroom: number;
  maxEnvy: number;
  envyFreeParties: number;
  firstChoiceCount: number;
}

export interface EvaluatedAssignment {
  key: string;
  assignment: Assignment;
  pricing: PricingResult;
  parties: PartyEvaluation[];
  metrics: AssignmentMetrics;
  scores: Record<StrategyKey, number>;
}

export interface OptimizationInput {
  config: PricingConfig;
  parties: PartyInput[];
  rooms: RoomInput[];
}

export type ProposalStrategy = StrategyKey | "auction";

export interface Proposal {
  rank: number;
  strategies: ProposalStrategy[]; // which strategies chose this assignment (overlap is shown, never faked)
  label: string;
  evaluation: EvaluatedAssignment;
}

export interface Diagnosis {
  conflicts: string[];
  suggestions: string[];
}

export interface OptimizationResult {
  engine: string;
  feasibleCount: number;
  evaluatedCount: number;
  proposals: Proposal[];
  diagnosis: Diagnosis | null;
  rankings: Record<StrategyKey, string[]>; // top keys per strategy (up to 5)
}

const STRATEGIES: StrategyKey[] = ["balanced", "budget", "preference"];
/** Max assignments the exhaustive engine will enumerate before switching to local search. */
export const EXHAUSTIVE_LIMIT = 40_320; // 8!

function orderParties(parties: PartyInput[]) {
  return [...parties].sort((a, b) => a.sort - b.sort || a.id.localeCompare(b.id));
}
function orderRooms(rooms: RoomInput[]) {
  return [...rooms].sort((a, b) => a.sort - b.sort || a.id.localeCompare(b.id));
}

export function assignmentKey(parties: PartyInput[], a: Assignment): string {
  return orderParties(parties)
    .map((p) => `${p.id}>${a[p.id]}`)
    .join("|");
}

/** Evaluate one complete assignment. Returns null if it violates any hard constraint. */
export function evaluateAssignment(
  input: OptimizationInput,
  assignment: Assignment,
  /** Auction mode: partyId → party total to use instead of the weighted price (must sum to the total). */
  priceOverride?: Record<string, number>,
): EvaluatedAssignment | null {
  const parties = orderParties(input.parties);
  const rooms = orderRooms(input.rooms);
  const roomById = new Map(rooms.map((r) => [r.id, r]));
  for (const p of parties) {
    const r = roomById.get(assignment[p.id]);
    if (!r || staticBlocks(p, r).length > 0) return null;
  }
  const pricing = priceAssignment(input.config, parties, rooms, assignment);
  if (priceOverride) {
    const sum = Object.values(priceOverride).reduce((a, b) => a + b, 0);
    if (sum !== input.config.totalCents) throw new Error("Price override does not reconcile to the total");
    for (const c of pricing.charges) {
      c.totalCents = priceOverride[c.partyId];
      c.roomCents = c.totalCents - c.sharedCents;
      c.perPersonCents = splitEqually(c.totalCents, c.size);
      c.shareBps = Math.round((c.totalCents * 10000) / input.config.totalCents);
      pricing.roomCosts[c.roomId] = c.roomCents;
    }
  }
  const cheap = cheapnessMap(pricing);
  const chargeBy = new Map(pricing.charges.map((c) => [c.partyId, c]));

  const satOf = (p: PartyInput, roomId: string, cost: number): { fit: number; afford: number | null; sat: number } => {
    const room = roomById.get(roomId)!;
    const fit = fitScore(p, room, rooms, cheap);
    const afford = affordScore(p, cost, rankPosition(p, room, rooms) === 0);
    return { fit, afford, sat: afford === null ? -1 : satisfaction(fit, afford) };
  };

  const evals: PartyEvaluation[] = [];
  for (const p of parties) {
    const c = chargeBy.get(p.id)!;
    const s = satOf(p, c.roomId, c.totalCents);
    if (s.afford === null) return null; // hard budget violated
    const room = roomById.get(c.roomId)!;
    evals.push({
      partyId: p.id,
      roomId: c.roomId,
      rankPosition: rankPosition(p, room, rooms),
      fit: s.fit,
      afford: s.afford,
      satisfaction: s.sat,
      costCents: c.totalCents,
      overIdealCents: Math.max(0, c.totalCents - p.budget.idealCents),
      overMaxCents: Math.max(0, c.totalCents - p.budget.maxCents),
      headroom: p.budget.maxCents <= 0 ? 0 : Math.min(1, Math.max(0, (p.budget.maxCents - c.totalCents) / p.budget.maxCents)),
      matched: matchedPriorities(p, room, cheap),
      envy: null,
    });
  }

  // Envy: would p prefer q's room at the price p would pay there?
  for (const pe of evals) {
    const p = parties.find((x) => x.id === pe.partyId)!;
    const sharedP = chargeBy.get(p.id)!.sharedCents;
    let best: PartyEvaluation["envy"] = null;
    for (const qe of evals) {
      if (qe.partyId === pe.partyId) continue;
      const room = roomById.get(qe.roomId)!;
      if (staticBlocks(p, room).length > 0) continue;
      const hypothetical = sharedP + pricing.roomCosts[qe.roomId];
      const s = satOf(p, qe.roomId, hypothetical);
      if (s.afford === null) continue;
      const gain = s.sat - pe.satisfaction;
      if (gain > 1e-9 && (!best || gain > best.gain)) best = { partyId: qe.partyId, roomId: qe.roomId, gain };
    }
    pe.envy = best;
  }

  const n = evals.length;
  const mean = (f: (e: PartyEvaluation) => number) => evals.reduce((a, e) => a + f(e), 0) / n;
  const min = (f: (e: PartyEvaluation) => number) => Math.min(...evals.map(f));
  const metrics: AssignmentMetrics = {
    minSatisfaction: min((e) => e.satisfaction),
    meanSatisfaction: mean((e) => e.satisfaction),
    minFit: min((e) => e.fit),
    meanFit: mean((e) => e.fit),
    minAfford: min((e) => e.afford),
    meanAfford: mean((e) => e.afford),
    meanHeadroom: mean((e) => e.headroom),
    maxEnvy: Math.max(0, ...evals.map((e) => e.envy?.gain ?? 0)),
    envyFreeParties: evals.filter((e) => !e.envy || e.envy.gain < 0.02).length,
    firstChoiceCount: evals.filter((e) => e.rankPosition === 0).length,
  };
  const W = SCORING_WEIGHTS.strategies;
  const scores: Record<StrategyKey, number> = {
    balanced:
      W.balanced.minSatisfaction * metrics.minSatisfaction +
      W.balanced.meanSatisfaction * metrics.meanSatisfaction +
      W.balanced.meanAfford * metrics.meanAfford +
      W.balanced.envyFree * (1 - metrics.maxEnvy),
    budget:
      W.budget.minAfford * metrics.minAfford +
      W.budget.meanAfford * metrics.meanAfford +
      W.budget.meanHeadroom * metrics.meanHeadroom +
      W.budget.minSatisfaction * metrics.minSatisfaction +
      W.budget.envyFree * (1 - metrics.maxEnvy),
    preference:
      W.preference.meanFit * metrics.meanFit + W.preference.minFit * metrics.minFit + W.preference.envyFree * (1 - metrics.maxEnvy),
  };
  return { key: assignmentKey(parties, assignment), assignment, pricing, parties: evals, metrics, scores };
}

/** Deterministic comparator: higher score first (compared at 1e-9 resolution), then assignment key. */
export function compareFor(strategy: StrategyKey) {
  return (a: EvaluatedAssignment, b: EvaluatedAssignment) => {
    const sa = Math.round(a.scores[strategy] * 1e9);
    const sb = Math.round(b.scores[strategy] * 1e9);
    if (sa !== sb) return sb - sa;
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  };
}

/** Count of injective party→room maps that pass static constraints (bounded early). */
export function countStaticAssignments(parties: PartyInput[], rooms: RoomInput[], cap = EXHAUSTIVE_LIMIT + 1): number {
  const ps = orderParties(parties);
  const rs = orderRooms(rooms);
  const allowed = ps.map((p) => rs.filter((r) => staticBlocks(p, r).length === 0).map((r) => r.id));
  let count = 0;
  const used = new Set<string>();
  const rec = (i: number) => {
    if (count >= cap) return;
    if (i === ps.length) {
      count++;
      return;
    }
    for (const rid of allowed[i]) {
      if (used.has(rid)) continue;
      used.add(rid);
      rec(i + 1);
      used.delete(rid);
      if (count >= cap) return;
    }
  };
  rec(0);
  return count;
}

export interface AssignmentOptimizer {
  readonly name: string;
  /** Returns every feasible evaluated assignment it considered. */
  search(input: OptimizationInput): { feasible: EvaluatedAssignment[]; evaluated: number };
}

/** Exhaustive enumeration with static-constraint pruning. Exact for small inputs. */
export class ExhaustiveOptimizer implements AssignmentOptimizer {
  readonly name = "exhaustive";
  search(input: OptimizationInput) {
    const ps = orderParties(input.parties);
    const rs = orderRooms(input.rooms);
    const allowed = ps.map((p) => rs.filter((r) => staticBlocks(p, r).length === 0).map((r) => r.id));
    const feasible: EvaluatedAssignment[] = [];
    let evaluated = 0;
    const current: Assignment = {};
    const used = new Set<string>();
    const rec = (i: number) => {
      if (i === ps.length) {
        evaluated++;
        if (evaluated > EXHAUSTIVE_LIMIT) throw new Error("Exhaustive limit exceeded");
        const ev = evaluateAssignment(input, { ...current });
        if (ev) feasible.push(ev);
        return;
      }
      for (const rid of allowed[i]) {
        if (used.has(rid)) continue;
        used.add(rid);
        current[ps[i].id] = rid;
        rec(i + 1);
        delete current[ps[i].id];
        used.delete(rid);
      }
    };
    rec(0);
    return { feasible, evaluated };
  }
}

/**
 * Deterministic local search for inputs too large to enumerate. Starts from a most-constrained-first
 * greedy assignment and applies improving swaps / moves under each strategy. Replaceable with a
 * MIP/CP-SAT solver behind the same interface.
 */
export class LocalSearchOptimizer implements AssignmentOptimizer {
  readonly name = "local-search";
  constructor(private maxPasses = 25) {}
  search(input: OptimizationInput) {
    const ps = orderParties(input.parties);
    const rs = orderRooms(input.rooms);
    const seen = new Map<string, EvaluatedAssignment>();
    let evaluated = 0;
    const evalA = (a: Assignment) => {
      const key = assignmentKey(ps, a);
      if (seen.has(key)) return seen.get(key)!;
      evaluated++;
      const ev = evaluateAssignment(input, a);
      if (ev) seen.set(key, ev);
      return ev;
    };
    const allowed = new Map(ps.map((p) => [p.id, rs.filter((r) => staticBlocks(p, r).length === 0)]));
    const byConstraint = [...ps].sort((a, b) => allowed.get(a.id)!.length - allowed.get(b.id)!.length || a.sort - b.sort);
    const start: Assignment = {};
    const taken = new Set<string>();
    for (const p of byConstraint) {
      const options = allowed
        .get(p.id)!
        .filter((r) => !taken.has(r.id))
        .sort((a, b) => rankPosition(p, a, rs) - rankPosition(p, b, rs) || a.weightMilli - b.weightMilli);
      // Prefer the cheapest compatible room when the party has a hard budget, otherwise their top pick.
      const pick = p.budget.hardMax ? [...options].sort((a, b) => a.weightMilli - b.weightMilli)[0] : options[0];
      if (!pick) return { feasible: [], evaluated };
      start[p.id] = pick.id;
      taken.add(pick.id);
    }
    for (const strategy of STRATEGIES) {
      let cur: Assignment = { ...start };
      let curEv = evalA(cur);
      for (let pass = 0; pass < this.maxPasses; pass++) {
        let improved = false;
        for (let i = 0; i < ps.length; i++) {
          // swaps
          for (let j = i + 1; j < ps.length; j++) {
            const next = { ...cur, [ps[i].id]: cur[ps[j].id], [ps[j].id]: cur[ps[i].id] };
            const ev = evalA(next);
            if (ev && (!curEv || compareFor(strategy)(ev, curEv) < 0)) {
              cur = next;
              curEv = ev;
              improved = true;
            }
          }
          // moves into empty rooms
          const occupied = new Set(Object.values(cur));
          for (const r of rs) {
            if (occupied.has(r.id)) continue;
            const next = { ...cur, [ps[i].id]: r.id };
            const ev = evalA(next);
            if (ev && (!curEv || compareFor(strategy)(ev, curEv) < 0)) {
              occupied.delete(cur[ps[i].id]);
              occupied.add(r.id);
              cur = next;
              curEv = ev;
              improved = true;
            }
          }
        }
        if (!improved) break;
      }
    }
    return { feasible: [...seen.values()], evaluated };
  }
}

export function chooseOptimizer(input: OptimizationInput): AssignmentOptimizer {
  return countStaticAssignments(input.parties, input.rooms) <= EXHAUSTIVE_LIMIT ? new ExhaustiveOptimizer() : new LocalSearchOptimizer();
}

export function optimize(input: OptimizationInput, optimizer: AssignmentOptimizer = chooseOptimizer(input)): OptimizationResult {
  if (input.parties.length === 0) {
    return {
      engine: optimizer.name,
      feasibleCount: 0,
      evaluatedCount: 0,
      proposals: [],
      diagnosis: { conflicts: ["No parties have submitted preferences yet."], suggestions: ["Invite parties and collect questionnaires."] },
      rankings: { balanced: [], budget: [], preference: [] },
    };
  }
  const { feasible, evaluated } = input.parties.length > input.rooms.length ? { feasible: [], evaluated: 0 } : optimizer.search(input);
  const rankings = {} as Record<StrategyKey, string[]>;
  const sorted = {} as Record<StrategyKey, EvaluatedAssignment[]>;
  for (const s of STRATEGIES) {
    sorted[s] = [...feasible].sort(compareFor(s));
    rankings[s] = sorted[s].slice(0, 5).map((e) => e.key);
  }
  if (feasible.length === 0) {
    return { engine: optimizer.name, feasibleCount: 0, evaluatedCount: evaluated, proposals: [], diagnosis: diagnose(input), rankings };
  }

  // Strategy winners; identical assignments are merged so overlap is visible.
  const proposals: Proposal[] = [];
  for (const s of STRATEGIES) {
    const winner = sorted[s][0];
    const existing = proposals.find((p) => p.evaluation.key === winner.key);
    if (existing) existing.strategies.push(s);
    else proposals.push({ rank: 0, strategies: [s], label: STRATEGY_LABELS[s], evaluation: winner });
  }
  // Fill up to three with the next-best balanced alternatives (labelled honestly as alternatives).
  for (const ev of sorted.balanced) {
    if (proposals.length >= 3) break;
    if (proposals.some((p) => p.evaluation.key === ev.key)) continue;
    proposals.push({ rank: 0, strategies: [], label: "Alternative", evaluation: ev });
  }
  proposals.forEach((p, i) => {
    p.rank = i + 1;
    if (p.strategies.length > 0) p.label = p.strategies.map((s) => STRATEGY_LABELS[s]).join(" + ");
    else p.label = `Alternative ${i + 1}`;
  });
  return { engine: optimizer.name, feasibleCount: feasible.length, evaluatedCount: evaluated, proposals, diagnosis: null, rankings };
}

/** Explain why no feasible assignment exists, with actionable suggestions. */
export function diagnose(input: OptimizationInput): Diagnosis {
  const ps = orderParties(input.parties);
  const rs = orderRooms(input.rooms);
  const conflicts: string[] = [];
  const suggestions: string[] = [];
  const cur = input.config;

  if (ps.length > rs.length) {
    conflicts.push(`${ps.length} parties but only ${rs.length} bedrooms — every party needs its own bedroom.`);
    suggestions.push(`Reduce the number of parties to ${rs.length}, or add a bedroom to the property.`);
  }

  // Price each party could pay in each statically compatible room, assuming all rooms are occupied
  // by the current parties (best-case lower bound uses the smallest possible party mix).
  const travelers = ps.reduce((a, p) => a + p.size, 0);
  const allowed = new Map<string, string[]>();
  for (const p of ps) {
    const ok: string[] = [];
    const blocked: string[] = [];
    for (const r of rs) {
      const blocks = staticBlocks(p, r);
      if (blocks.length) {
        blocked.push(blocks.map((b) => describeBlock(b, r.name)).join("; "));
        continue;
      }
      // Lowest price this party could face in r: occupy r plus the (k−1) lowest-weight other rooms.
      const others = rs.filter((x) => x.id !== r.id).sort((a, b) => a.weightMilli - b.weightMilli || a.sort - b.sort);
      const occ = [r, ...others.slice(0, Math.max(0, Math.min(ps.length, rs.length) - 1))];
      const shared = Math.round(((cur.totalCents * cur.sharedBps) / 10000 / travelers) * p.size);
      const privPool = cur.totalCents - Math.round((cur.totalCents * cur.sharedBps) / 10000);
      const wsum = occ.reduce((a, x) => a + x.weightMilli, 0) || 1;
      const price = shared + Math.round((privPool * r.weightMilli) / wsum);
      if (p.budget.hardMax && price > p.budget.maxCents) {
        blocked.push(`${r.name} would cost at least ${formatMoney(price)} (hard max ${formatMoney(p.budget.maxCents)})`);
        continue;
      }
      ok.push(r.id);
    }
    allowed.set(p.id, ok);
    if (ok.length === 0) {
      conflicts.push(`${p.name} has no workable bedroom: ${blocked.join("; ")}.`);
      const cheapest = rs
        .filter((r) => staticBlocks(p, r).length === 0)
        .map((r) => r)
        .sort((a, b) => a.weightMilli - b.weightMilli)[0];
      if (cheapest && p.budget.hardMax) {
        suggestions.push(`${p.name}: consider raising the hard maximum or marking it flexible — the lowest-priced compatible room is ${cheapest.name}.`);
      } else {
        suggestions.push(`${p.name}: review sleeping requirements or refused rooms, or adjust room attributes by group agreement.`);
      }
    }
  }

  // Hall's condition: any subset of parties whose combined workable rooms are fewer than the subset.
  if (conflicts.length === 0 && ps.length <= 12) {
    let found = false;
    for (let size = 2; size <= ps.length && !found; size++) {
      for (const subset of combinations(ps, size)) {
        const union = new Set(subset.flatMap((p) => allowed.get(p.id)!));
        if (union.size < subset.length) {
          const names = subset.map((p) => p.name).join(", ");
          const roomNames = [...union].map((id) => rs.find((r) => r.id === id)!.name).join(", ") || "no rooms";
          conflicts.push(`${names} can only use ${roomNames} — ${subset.length} parties competing for ${union.size} room${union.size === 1 ? "" : "s"}.`);
          suggestions.push(`One of ${names} could relax a refused room or sleeping requirement, or make their maximum budget flexible.`);
          found = true;
          break;
        }
      }
    }
  }
  if (conflicts.length === 0) {
    conflicts.push("Every party fits somewhere on its own, but no combination keeps all parties within their hard budgets at the same time.");
    suggestions.push("Ask the party closest to its limit to make its maximum flexible, or agree as a group to adjust room weights.");
  }
  suggestions.push("Changing the shared-cost percentage shifts cost between larger and smaller parties and can unlock options.");
  return { conflicts, suggestions };
}

function* combinations<T>(arr: T[], k: number, start = 0, acc: T[] = []): Generator<T[]> {
  if (acc.length === k) {
    yield [...acc];
    return;
  }
  for (let i = start; i < arr.length; i++) {
    acc.push(arr[i]);
    yield* combinations(arr, k, i + 1, acc);
    acc.pop();
  }
}
