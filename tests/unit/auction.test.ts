import { describe, expect, it } from "vitest";
import { runAuction, evaluateAssignment, type PartyInput } from "@/lib/engine";
import { demoConfig, demoParties, demoRooms } from "../helpers";

const withBids = (bids: Record<string, Record<string, number>>): PartyInput[] =>
  demoParties().map((p) => ({ ...p, bids: bids[p.id] ?? p.bids }));

describe("runAuction", () => {
  it("allocates to the highest-value arrangement with envy-free prices that sum to the rent", () => {
    const r = runAuction(demoConfig(), demoParties(), demoRooms());
    expect(r.feasible).toBe(true);
    expect(r.assignment).toEqual({ A: "master", B: "view", C: "comfort", D: "bunk" });
    expect(Object.values(r.prices).reduce((a, b) => a + b, 0)).toBe(420_000);
    expect(r.envyFree).toBe(true);
    expect(r.individuallyRational).toBe(true);
    Object.values(r.prices).forEach((v) => expect(Number.isInteger(v)).toBe(true));
  });

  it("is deterministic", () => {
    expect(runAuction(demoConfig(), demoParties(), demoRooms())).toEqual(runAuction(demoConfig(), demoParties(), demoRooms()));
  });

  it("contested room clears higher when demand rises", () => {
    const base = runAuction(demoConfig(), demoParties(), demoRooms());
    const hot = runAuction(
      demoConfig(),
      withBids({ C: { comfort: 100_000, view: 99_500, bunk: 70_000 }, B: { view: 140_000, comfort: 110_000, master: 135_000, bunk: 80_000 } }),
      demoRooms(),
    );
    const viewBase = base.rooms.find((x) => x.roomId === "view")!.clearingCents!;
    const viewHot = hot.rooms.find((x) => x.roomId === "view")!.clearingCents!;
    expect(viewHot).toBeGreaterThanOrEqual(viewBase);
    expect(hot.envyFree).toBe(true);
  });

  it("reports when bids do not cover the rent", () => {
    const low = withBids({ A: { master: 100_000 }, B: { view: 80_000 }, C: { comfort: 60_000 }, D: { bunk: 40_000 } });
    const r = runAuction(demoConfig(), low, demoRooms());
    expect(r.feasible).toBe(false);
    expect(r.conflicts[0]).toMatch(/short of/);
  });

  it("requires a bid on a compatible room", () => {
    const r = runAuction(demoConfig(), withBids({ A: { bunk: 200_000 } }), demoRooms()); // A refuses bunk
    expect(r.feasible).toBe(false);
    expect(r.conflicts.join()).toMatch(/Maya & Jordan/);
  });

  it("market weights reflect clearing prices", () => {
    const r = runAuction(demoConfig(), demoParties(), demoRooms());
    expect(r.marketWeights.master).toBeGreaterThan(r.marketWeights.bunk);
  });

  it("price override evaluation reconciles", () => {
    const r = runAuction(demoConfig(), demoParties(), demoRooms());
    const ev = evaluateAssignment({ config: demoConfig(), parties: demoParties(), rooms: demoRooms() }, r.assignment!, r.prices)!;
    expect(ev.pricing.charges.reduce((a, c) => a + c.totalCents, 0)).toBe(420_000);
  });

  it("random bids always yield envy-free, exact prices", () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let t = 0; t < 200; t++) {
      const ps = demoParties().map((p) => ({
        ...p, refusedRooms: [], requirements: { separateBeds: false, noBunk: false, accessible: false },
        budget: { ...p.budget, hardMax: false },
        bids: Object.fromEntries(demoRooms().map((r) => [r.id, 60_000 + Math.floor(rnd() * 120_000)])),
      }));
      const r = runAuction(demoConfig(), ps, demoRooms());
      if (r.welfareCents < 420_000) continue;
      expect(r.envyFree).toBe(true);
      expect(Object.values(r.prices).reduce((a, b) => a + b, 0)).toBe(420_000);
    }
  });
});
