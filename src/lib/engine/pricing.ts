import { allocateLargestRemainder, splitEqually } from "./money";
import type { Assignment, PricingConfig, RoomInput } from "./types";

/**
 * Pricing model
 *
 *   SharedPool          = T × s                       (split equally per traveler)
 *   PrivatePool         = T × (1 − s)                 (split across OCCUPIED rooms by weight)
 *   SharedCostPerPerson = SharedPool / N
 *   RoomCost(r)         = PrivatePool × w[r] / Σ w[occupied]
 *   PartyCost(p)        = n[p] × SharedCostPerPerson + RoomCost(room(p))
 *
 * Every split is done with largest-remainder apportionment on integer cents, so
 * Σ PartyCost === T exactly, for any inputs.
 */

export interface PartyCharge {
  partyId: string;
  roomId: string;
  size: number;
  sharedCents: number; // the party's total shared contribution (n[p] × per-person, with cent remainders)
  roomCents: number;
  totalCents: number;
  /** Party total split per member (equal, largest remainder). */
  perPersonCents: number[];
  /** Share of whole rental in basis points (display only). */
  shareBps: number;
}

export interface PricingResult {
  totalCents: number;
  sharedPoolCents: number;
  privatePoolCents: number;
  travelers: number;
  /** Nominal per-person shared cost (shared pool / N, floored; remainder cents are distributed deterministically). */
  sharedPerPersonCents: number;
  occupiedWeightMilli: number;
  roomCosts: Record<string, number>;
  charges: PartyCharge[];
}

export interface PricingParty {
  id: string;
  size: number;
}

export function splitPools(config: PricingConfig): { shared: number; priv: number } {
  if (config.sharedBps < 0 || config.sharedBps > 10000) throw new Error("sharedBps must be within 0..10000");
  const [shared, priv] = allocateLargestRemainder(config.totalCents, [config.sharedBps, 10000 - config.sharedBps]);
  return { shared, priv };
}

/** Room costs for a given set of occupied rooms. Unoccupied rooms cost nothing. */
export function roomCostsFor(privatePoolCents: number, occupied: RoomInput[]): Record<string, number> {
  const ordered = [...occupied].sort((a, b) => a.sort - b.sort || a.id.localeCompare(b.id));
  if (ordered.length === 0) return {};
  const weights = ordered.map((r) => r.weightMilli);
  if (weights.reduce((a, b) => a + b, 0) === 0) {
    // All occupied rooms weight 0 → split private pool equally across rooms.
    const eq = splitEqually(privatePoolCents, ordered.length);
    return Object.fromEntries(ordered.map((r, i) => [r.id, eq[i]]));
  }
  const parts = allocateLargestRemainder(privatePoolCents, weights);
  return Object.fromEntries(ordered.map((r, i) => [r.id, parts[i]]));
}

export function priceAssignment(
  config: PricingConfig,
  parties: PricingParty[],
  rooms: RoomInput[],
  assignment: Assignment,
): PricingResult {
  if (parties.length === 0) throw new Error("At least one party is required");
  const roomById = new Map(rooms.map((r) => [r.id, r]));
  const used = new Set<string>();
  for (const p of parties) {
    const rid = assignment[p.id];
    if (!rid || !roomById.has(rid)) throw new Error(`Party ${p.id} has no valid room`);
    if (used.has(rid)) throw new Error(`Room ${rid} assigned to more than one party`);
    if (!Number.isInteger(p.size) || p.size < 1) throw new Error(`Party ${p.id} must have at least one traveler`);
    used.add(rid);
  }

  const { shared, priv } = splitPools(config);
  const orderedParties = [...parties];
  const travelers = orderedParties.reduce((a, p) => a + p.size, 0);

  // One share per traveler, then sum per party (keeps per-person shared cost equal to the cent).
  const perTraveler = splitEqually(shared, travelers);
  let cursor = 0;
  const sharedByParty = new Map<string, number>();
  for (const p of orderedParties) {
    let s = 0;
    for (let i = 0; i < p.size; i++) s += perTraveler[cursor++];
    sharedByParty.set(p.id, s);
  }

  const occupied = rooms.filter((r) => used.has(r.id));
  const roomCosts = roomCostsFor(priv, occupied);

  const charges: PartyCharge[] = orderedParties.map((p) => {
    const roomId = assignment[p.id];
    const sharedCents = sharedByParty.get(p.id)!;
    const roomCents = roomCosts[roomId];
    const totalCents = sharedCents + roomCents;
    return {
      partyId: p.id,
      roomId,
      size: p.size,
      sharedCents,
      roomCents,
      totalCents,
      perPersonCents: splitEqually(totalCents, p.size),
      shareBps: config.totalCents === 0 ? 0 : Math.round((totalCents * 10000) / config.totalCents),
    };
  });

  const sum = charges.reduce((a, c) => a + c.totalCents, 0);
  if (sum !== config.totalCents) {
    // Should be impossible; guard so a regression can never silently mis-bill.
    throw new Error(`Reconciliation failed: charges ${sum} ≠ total ${config.totalCents}`);
  }

  return {
    totalCents: config.totalCents,
    sharedPoolCents: shared,
    privatePoolCents: priv,
    travelers,
    sharedPerPersonCents: Math.floor(shared / travelers),
    occupiedWeightMilli: occupied.reduce((a, r) => a + r.weightMilli, 0),
    roomCosts,
    charges,
  };
}

/**
 * Indicative per-room price for a party of `size`, assuming `occupiedRoomIds` will be occupied
 * and `travelers` people in total. Used for questionnaire previews.
 */
export function previewRoomPrice(
  config: PricingConfig,
  rooms: RoomInput[],
  occupiedRoomIds: string[],
  travelers: number,
  size: number,
): Record<string, number> {
  const { shared, priv } = splitPools(config);
  const t = Math.max(travelers, size, 1);
  const perPerson = shared / t;
  const out: Record<string, number> = {};
  for (const r of rooms) {
    // The room being previewed is always counted as occupied.
    const occ = new Set(occupiedRoomIds);
    occ.add(r.id);
    const costs = roomCostsFor(priv, rooms.filter((x) => occ.has(x.id)));
    out[r.id] = Math.round(perPerson * size) + costs[r.id];
  }
  return out;
}
