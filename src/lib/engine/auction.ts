import { allocateLargestRemainder, formatMoney } from "./money";
import { priceAssignment } from "./pricing";
import { staticBlocks } from "./scoring";
import type { Assignment, PartyInput, PricingConfig, RoomInput } from "./types";

/**
 * Sealed-bid room auction for price discovery.
 *
 * 1. Every party submits, per room it would accept, the most it would pay (party total for the stay).
 * 2. Allocation maximizes the sum of winning bids (each room goes where it is valued most),
 *    subject to the same hard constraints as the weighted model. Exhaustive for small inputs,
 *    deterministic tie-break by assignment key.
 * 3. Prices are envy-free: for party p in room r and any room r' p bid on,
 *        bid_p(r) − P(r) ≥ bid_p(r') − P(r')
 *    These are difference constraints, solved with Bellman-Ford. Among envy-free price vectors we
 *    pick the one that maximizes the smallest surplus (bid − price), shifted so prices sum exactly to
 *    the rental total, then round with largest remainder.
 * 4. A welfare-maximizing assignment always admits envy-free prices (no negative cycles), so the only
 *    failure modes are bids that don't cover the rent, or a clearing price above a bid / hard budget.
 */

export interface AuctionRoomStats {
  roomId: string;
  bidCount: number;
  highestCents: number | null;
  secondCents: number | null;
  clearingCents: number | null;
  weightedCents: number | null;
  winnerPartyId: string | null;
  /** clearing − weighted price for the same occupant (positive = market premium). */
  premiumCents: number | null;
}

export interface AuctionResult {
  feasible: boolean;
  assignment: Assignment | null;
  key: string | null;
  welfareCents: number;
  prices: Record<string, number>; // partyId → party total
  surplus: Record<string, number>; // partyId → bid − price
  envyFree: boolean;
  individuallyRational: boolean;
  rooms: AuctionRoomStats[];
  /** Suggested room weights (thousandths) implied by clearing prices. */
  marketWeights: Record<string, number>;
  conflicts: string[];
  suggestions: string[];
  evaluated: number;
}

const LIMIT = 40_320;

function orderParties(ps: PartyInput[]) {
  return [...ps].sort((a, b) => a.sort - b.sort || a.id.localeCompare(b.id));
}
function orderRooms(rs: RoomInput[]) {
  return [...rs].sort((a, b) => a.sort - b.sort || a.id.localeCompare(b.id));
}

export function canBid(p: PartyInput, r: RoomInput) {
  const b = p.bids?.[r.id];
  return typeof b === "number" && b > 0 && staticBlocks(p, r).length === 0;
}

export function runAuction(config: PricingConfig, partiesIn: PartyInput[], roomsIn: RoomInput[]): AuctionResult {
  const parties = orderParties(partiesIn);
  const rooms = orderRooms(roomsIn);
  const T = config.totalCents;
  const empty: AuctionResult = {
    feasible: false, assignment: null, key: null, welfareCents: 0, prices: {}, surplus: {}, envyFree: false,
    individuallyRational: false, rooms: [], marketWeights: {}, conflicts: [], suggestions: [], evaluated: 0,
  };
  const stats = (assignment: Assignment | null, prices: Record<string, number>): AuctionRoomStats[] => {
    let weighted: Record<string, number> = {};
    if (assignment) {
      const wp = priceAssignment(config, parties, rooms, assignment);
      weighted = Object.fromEntries(wp.charges.map((c) => [c.partyId, c.totalCents]));
    }
    return rooms.map((r) => {
      const bids = parties.filter((p) => canBid(p, r)).map((p) => p.bids![r.id]).sort((a, b) => b - a);
      const winner = assignment ? Object.keys(assignment).find((pid) => assignment[pid] === r.id) ?? null : null;
      const clearing = winner ? prices[winner] : null;
      const w = winner ? weighted[winner] : null;
      return {
        roomId: r.id, bidCount: bids.length, highestCents: bids[0] ?? null, secondCents: bids[1] ?? null,
        clearingCents: clearing, weightedCents: w, winnerPartyId: winner, premiumCents: clearing != null && w != null ? clearing - w : null,
      };
    });
  };

  // Every party must be able to bid on at least one room.
  for (const p of parties) {
    if (!rooms.some((r) => canBid(p, r))) {
      empty.conflicts.push(`${p.name} has no valid bid on a compatible room.`);
      empty.suggestions.push(`${p.name}: enter a bid for at least one room you can stay in.`);
    }
  }
  if (parties.length > rooms.length) empty.conflicts.push(`${parties.length} parties but only ${rooms.length} bedrooms.`);
  if (empty.conflicts.length) return { ...empty, rooms: stats(null, {}) };

  // 1. Welfare-maximizing assignment.
  const allowed = parties.map((p) => rooms.filter((r) => canBid(p, r)).map((r) => r.id));
  let best: { a: Assignment; w: number; key: string } | null = null;
  let evaluated = 0;
  const cur: Assignment = {};
  const used = new Set<string>();
  const rec = (i: number, w: number) => {
    if (evaluated > LIMIT) return;
    if (i === parties.length) {
      evaluated++;
      const key = parties.map((p) => `${p.id}>${cur[p.id]}`).join("|");
      if (!best || w > best.w || (w === best.w && key < best.key)) best = { a: { ...cur }, w, key };
      return;
    }
    const p = parties[i];
    for (const rid of allowed[i]) {
      if (used.has(rid)) continue;
      used.add(rid);
      cur[p.id] = rid;
      rec(i + 1, w + p.bids![rid]);
      delete cur[p.id];
      used.delete(rid);
    }
  };
  rec(0, 0);
  if (evaluated > LIMIT) {
    return { ...empty, conflicts: ["Too many combinations for the exhaustive auction; use the weighted model or a solver-backed engine."], evaluated };
  }
  if (!best) {
    return {
      ...empty, evaluated, rooms: stats(null, {}),
      conflicts: ["No arrangement gives every party a room it bid on."],
      suggestions: ["Parties competing for the same few rooms should bid on more rooms."],
    };
  }
  const { a: assignment, w: welfare, key } = best as { a: Assignment; w: number; key: string };
  if (welfare < T) {
    return {
      ...empty, assignment, key, welfareCents: welfare, evaluated, rooms: stats(assignment, {}),
      conflicts: [`The best arrangement's bids total ${formatMoney(welfare)}, which is ${formatMoney(T - welfare)} short of the ${formatMoney(T)} rental.`],
      suggestions: ["Bids must collectively cover the rent. Parties can raise bids on rooms they'd accept, or the group can use the weighted model."],
    };
  }

  // 2. Envy-free prices via difference constraints over occupied rooms.
  const occ = parties.map((p) => assignment[p.id]);
  const idx = new Map(occ.map((r, i) => [r, i]));
  const k = occ.length;
  // Constraint P[i] − P[j] ≤ c  ⇔ edge j → i weight c.
  const edges: { from: number; to: number; w: number }[] = [];
  for (const p of parties) {
    const i = idx.get(assignment[p.id])!;
    for (const r2 of occ) {
      if (r2 === assignment[p.id]) continue;
      const bid2 = p.bids?.[r2];
      const room2 = rooms.find((r) => r.id === r2)!;
      if (typeof bid2 !== "number" || bid2 <= 0 || staticBlocks(p, room2).length) continue;
      edges.push({ from: idx.get(r2)!, to: i, w: p.bids![assignment[p.id]] - bid2 });
    }
  }
  // Maximin-surplus envy-free prices: the componentwise-largest EF vector with P[i] ≤ bid of occupant(i)
  // (Bellman-Ford from a source with edge weight = occupant's bid), then lowered uniformly so Σ P = T.
  // Lowering uniformly keeps every difference constraint, and the uniform amount is the same for all,
  // so this maximizes the minimum surplus (bid − price) among envy-free price vectors.
  const occupantBid = occ.map((rid) => {
    const p = parties.find((x) => assignment[x.id] === rid)!;
    return p.bids![rid];
  });
  const dist = [...occupantBid];
  for (let it = 0; it <= k; it++) {
    let changed = false;
    for (const e of edges) if (dist[e.from] + e.w < dist[e.to]) { dist[e.to] = dist[e.from] + e.w; changed = true; }
    if (!changed) break;
    if (it === k) throw new Error("Negative cycle: assignment is not welfare-maximizing");
  }
  const lowerBy = (dist.reduce((a, b) => a + b, 0) - T) / k;
  const mid = dist.map((v) => v - lowerBy);

  // 3. Round to cents (largest remainder keeps the exact total). Prices are shifted to be ≥ 0 for rounding.
  const minP = Math.min(...mid);
  const offset = minP < 0 ? Math.ceil(-minP) : 0;
  const scaled = mid.map((v) => v + offset);
  const SCALE = 1000; // milli-cents → integer weights for exact apportionment
  const weights = scaled.map((v) => Math.max(0, Math.round(v * SCALE)));
  const rounded = allocateLargestRemainder(T + offset * k, weights.some((w) => w > 0) ? weights : weights.map(() => 1)).map((v) => v - offset);

  const prices: Record<string, number> = {};
  const surplus: Record<string, number> = {};
  parties.forEach((p) => {
    const i = idx.get(assignment[p.id])!;
    prices[p.id] = rounded[i];
    surplus[p.id] = p.bids![assignment[p.id]] - rounded[i];
  });

  // Verify envy-freeness (allowing 1¢ rounding slack).
  let envyFree = true;
  for (const p of parties) {
    for (const q of parties) {
      if (p.id === q.id) continue;
      const r2 = assignment[q.id];
      const room2 = rooms.find((r) => r.id === r2)!;
      const b2 = p.bids?.[r2];
      if (typeof b2 !== "number" || b2 <= 0 || staticBlocks(p, room2).length) continue;
      if (b2 - prices[q.id] > surplus[p.id] + 1) envyFree = false;
    }
  }
  const individuallyRational = parties.every((p) => surplus[p.id] >= 0);

  // Market-implied weights: private component of each clearing price, normalized to the occupied rooms' current mean weight.
  const weighted = priceAssignment(config, parties, rooms, assignment);
  const implied = parties.map((p) => {
    const c = weighted.charges.find((x) => x.partyId === p.id)!;
    return { roomId: assignment[p.id], v: Math.max(0, prices[p.id] - c.sharedCents) };
  });
  const meanW = implied.reduce((a, x) => a + rooms.find((r) => r.id === x.roomId)!.weightMilli, 0) / implied.length;
  const meanV = implied.reduce((a, x) => a + x.v, 0) / implied.length || 1;
  const marketWeights = Object.fromEntries(implied.map((x) => [x.roomId, Math.round((x.v / meanV) * meanW)]));

  const conflicts: string[] = [];
  const suggestions: string[] = [];
  for (const p of parties) {
    if (p.budget.hardMax && prices[p.id] > p.budget.maxCents) {
      conflicts.push(`${p.name}'s clearing price ${formatMoney(prices[p.id])} is above their hard maximum ${formatMoney(p.budget.maxCents)}.`);
      suggestions.push(`${p.name} should lower bids on rooms they can't afford, or other parties can bid more for contested rooms.`);
    }
  }
  return {
    feasible: conflicts.length === 0, assignment, key, welfareCents: welfare, prices, surplus, envyFree, individuallyRational,
    rooms: stats(assignment, prices), marketWeights, conflicts, suggestions, evaluated,
  };
}
