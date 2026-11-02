import { describe, expect, it } from "vitest";
import { optimize, LocalSearchOptimizer, ExhaustiveOptimizer, evaluateAssignment, type PartyInput, type RoomInput } from "@/lib/engine";
import { demoConfig, demoParties, demoRooms } from "../helpers";

const input = () => ({ config: demoConfig(), parties: demoParties(), rooms: demoRooms() });

describe("optimize — demo scenario", () => {
  it("recommends the fixture allocation with exact amounts", () => {
    const r = optimize(input());
    const best = r.proposals[0];
    expect(best.strategies).toContain("balanced");
    expect(best.evaluation.assignment).toEqual({ A: "master", B: "view", C: "comfort", D: "bunk" });
    const by = Object.fromEntries(best.evaluation.pricing.charges.map((c) => [c.partyId, c.totalCents]));
    expect(by).toEqual({ A: 140_977, B: 123_395, C: 92_465, D: 63_163 });
  });
  it("is deterministic for identical inputs", () => {
    const a = optimize(input());
    const b = optimize(input());
    expect(a.proposals.map((p) => p.evaluation.key)).toEqual(b.proposals.map((p) => p.evaluation.key));
    expect(a.rankings).toEqual(b.rankings);
  });
  it("is independent of input ordering", () => {
    const i = input();
    const r1 = optimize(i);
    const r2 = optimize({ ...i, parties: [...i.parties].reverse(), rooms: [...i.rooms].reverse() });
    expect(r2.proposals[0].evaluation.key).toBe(r1.proposals[0].evaluation.key);
  });
  it("never proposes hard-constraint violations", () => {
    const r = optimize(input());
    for (const p of r.proposals) {
      const D = p.evaluation.parties.find((x) => x.partyId === "D")!;
      const C = p.evaluation.parties.find((x) => x.partyId === "C")!;
      expect(D.costCents).toBeLessThanOrEqual(70_000);
      expect(C.costCents).toBeLessThanOrEqual(100_000);
      expect(p.evaluation.assignment.A).not.toBe("bunk"); // refused
    }
  });
  it("produces distinct proposals and merges overlapping strategy winners", () => {
    const r = optimize(input());
    const keys = r.proposals.map((p) => p.evaluation.key);
    expect(new Set(keys).size).toBe(keys.length);
    const allStrategies = r.proposals.flatMap((p) => p.strategies);
    expect(new Set(allStrategies).size).toBe(allStrategies.length);
    expect(allStrategies.sort()).toEqual(["balanced", "budget", "preference"]);
  });
  it("does not give a bigger budget a better room by default", () => {
    // Swap budgets: D gets a huge budget but still wants the cheapest room.
    const i = input();
    const D = i.parties.find((p) => p.id === "D")!;
    D.budget = { idealCents: 300_000, maxCents: 400_000, hardMax: true, premiumFlex: 5 };
    const r = optimize(i);
    expect(r.proposals[0].evaluation.assignment.D).toBe("bunk");
  });
});

describe("optimize — edge cases", () => {
  const solo = (over: Partial<PartyInput> = {}): PartyInput => ({
    ...demoParties()[2],
    ...over,
  });

  it("one party with one guest pays the full rental", () => {
    const r = optimize({ config: demoConfig(), parties: [solo({ id: "X", budget: { idealCents: 500_000, maxCents: 500_000, hardMax: true, premiumFlex: 0 } })], rooms: demoRooms() });
    expect(r.proposals[0].evaluation.pricing.charges[0].totalCents).toBe(420_000);
  });

  it("four parties with eight guests", () => {
    const i = input();
    i.parties.forEach((p) => {
      p.size = 2;
      p.budget = { ...p.budget, maxCents: 200_000, idealCents: 150_000, hardMax: true };
    });
    const r = optimize(i);
    expect(r.proposals.length).toBeGreaterThan(0);
    expect(r.proposals[0].evaluation.pricing.sharedPerPersonCents).toBe(21_000);
  });

  it("reports impossible budgets with conflicts and suggestions", () => {
    const i = input();
    i.parties.find((p) => p.id === "D")!.budget = { idealCents: 30_000, maxCents: 40_000, hardMax: true, premiumFlex: 0 };
    const r = optimize(i);
    expect(r.proposals).toHaveLength(0);
    expect(r.diagnosis!.conflicts.join(" ")).toMatch(/Theo/);
    expect(r.diagnosis!.suggestions.length).toBeGreaterThan(0);
  });

  it("respects room capacity and separate-bed requirements", () => {
    const i = input();
    const B = i.parties.find((p) => p.id === "B")!;
    B.requirements.separateBeds = true;
    B.requirements.noBunk = false;
    B.budget = { ...B.budget, hardMax: true };
    const r = optimize(i);
    for (const p of r.proposals) expect(p.evaluation.assignment.B).toBe("bunk");
  });

  it("detects competition for too few compatible rooms", () => {
    const i = input();
    i.parties.forEach((p) => (p.requirements.separateBeds = true));
    i.parties.forEach((p) => (p.requirements.noBunk = false));
    i.parties.forEach((p) => (p.size = 2));
    const r = optimize(i);
    expect(r.proposals).toHaveLength(0);
    expect(r.diagnosis!.conflicts.join(" ")).toMatch(/no workable bedroom|competing/);
  });

  it("more parties than rooms is infeasible with an explanation", () => {
    const i = input();
    i.parties.push({ ...i.parties[3], id: "E", name: "Extra", sort: 9 });
    const r = optimize(i);
    expect(r.proposals).toHaveLength(0);
    expect(r.diagnosis!.conflicts[0]).toMatch(/only 4 bedrooms/);
  });

  it("handles several equally ranked options deterministically", () => {
    const rooms: RoomInput[] = demoRooms().map((r) => ({ ...r, weightMilli: 1000, attributes: { ...demoRooms()[1].attributes } }));
    const parties = demoParties().map((p) => ({ ...p, roomRanking: [], refusedRooms: [], requirements: { separateBeds: false, noBunk: false, accessible: false }, budget: { idealCents: 200_000, maxCents: 200_000, hardMax: true, premiumFlex: 0 } }));
    const a = optimize({ config: demoConfig(), parties, rooms });
    const b = optimize({ config: demoConfig(), parties: [...parties].reverse(), rooms });
    expect(a.proposals[0].evaluation.key).toBe(b.proposals[0].evaluation.key);
  });

  it("conflicting preferences: two parties wanting the same room — least-satisfied party protected", () => {
    const i = input();
    const C = i.parties.find((p) => p.id === "C")!;
    C.roomRanking = ["view", "comfort", "bunk", "master"];
    const r = optimize(i);
    const best = r.proposals[0].evaluation;
    expect(Object.values(best.assignment).sort()).toEqual(["bunk", "comfort", "master", "view"]);
    expect(best.metrics.minSatisfaction).toBeGreaterThan(0.5);
  });

  it("local search handles large inputs without factorial blow-up", () => {
    const rooms: RoomInput[] = Array.from({ length: 12 }, (_, k) => ({
      id: `r${k}`, name: `Room ${k}`, capacity: 2, bedCount: 1, hasBunk: false, accessible: false,
      weightMilli: 600 + k * 70, attributes: demoRooms()[k % 4].attributes, sort: k,
    }));
    const parties: PartyInput[] = Array.from({ length: 11 }, (_, k) => ({
      ...demoParties()[k % 4], id: `p${k}`, name: `P${k}`, sort: k,
      roomRanking: rooms.map((r) => r.id).sort((a, b) => ((a.charCodeAt(1) * (k + 3)) % 7) - ((b.charCodeAt(1) * (k + 3)) % 7)),
      refusedRooms: [], budget: { idealCents: 50_000, maxCents: 120_000, hardMax: false, premiumFlex: 2 },
    }));
    const t = Date.now();
    const r = optimize({ config: demoConfig(), parties, rooms });
    expect(r.engine).toBe("local-search");
    expect(r.proposals.length).toBeGreaterThan(0);
    expect(Date.now() - t).toBeLessThan(15_000);
    expect(r.proposals[0].evaluation.pricing.charges.reduce((a, c) => a + c.totalCents, 0)).toBe(420_000);
  });

  it("local search agrees with exhaustive on the demo", () => {
    const ex = new ExhaustiveOptimizer().search(input());
    const ls = new LocalSearchOptimizer().search(input());
    const bestEx = optimize(input(), new ExhaustiveOptimizer()).proposals[0].evaluation.key;
    const bestLs = optimize(input(), new LocalSearchOptimizer()).proposals[0].evaluation.key;
    expect(ex.feasible.length).toBeGreaterThan(0);
    expect(ls.feasible.length).toBeGreaterThan(0);
    expect(bestLs).toBe(bestEx);
  });

  it("evaluateAssignment rejects refused rooms", () => {
    expect(evaluateAssignment(input(), { A: "bunk", B: "view", C: "comfort", D: "master" })).toBeNull();
  });
});
