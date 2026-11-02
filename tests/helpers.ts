import { DEMO_PARTIES, DEMO_ROOMS } from "@/lib/demo/fixture";
import { toPartyInput } from "@/lib/domain/questionnaire";
import type { PartyInput, RoomInput } from "@/lib/engine";

export function demoRooms(): RoomInput[] {
  return DEMO_ROOMS.map((r, i) => ({
    id: r.key, name: r.name, capacity: r.capacity, bedCount: r.bedCount, hasBunk: r.hasBunk, accessible: r.accessible,
    weightMilli: r.weightMilli, attributes: r.attributes, sort: i,
  }));
}
export function demoParties(): PartyInput[] {
  const ids = DEMO_ROOMS.map((r) => r.key);
  return DEMO_PARTIES.map((p, i) => toPartyInput(["A", "B", "C", "D"][i], i, { ...p.answers }, ids));
}
export const demoConfig = () => ({ totalCents: 420_000, sharedBps: 4000 });
