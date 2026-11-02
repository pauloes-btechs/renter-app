import { describe, expect, it } from "vitest";
import { priceAssignment, previewRoomPrice } from "@/lib/engine";
import { demoConfig, demoRooms } from "../helpers";

const parties = [
  { id: "A", size: 2 },
  { id: "B", size: 2 },
  { id: "C", size: 1 },
  { id: "D", size: 1 },
];
const baseline = { A: "master", B: "view", C: "comfort", D: "bunk" };

describe("priceAssignment", () => {
  it("matches the demo fixture to the cent", () => {
    const r = priceAssignment(demoConfig(), parties, demoRooms(), baseline);
    const by = Object.fromEntries(r.charges.map((c) => [c.partyId, c.totalCents]));
    expect(by).toEqual({ A: 140_977, B: 123_395, C: 92_465, D: 63_163 });
    expect(r.sharedPerPersonCents).toBe(28_000);
    expect(r.sharedPoolCents).toBe(168_000);
    expect(r.privatePoolCents).toBe(252_000);
    expect(r.charges.reduce((a, c) => a + c.totalCents, 0)).toBe(420_000);
  });

  it("charges a two-person party for exactly one room", () => {
    const r = priceAssignment(demoConfig(), parties, demoRooms(), baseline);
    const a = r.charges.find((c) => c.partyId === "A")!;
    expect(a.sharedCents).toBe(56_000);
    expect(a.roomCents).toBe(84_977);
    expect(a.perPersonCents).toEqual([70_489, 70_488]);
    expect(a.perPersonCents.reduce((x, y) => x + y)).toBe(a.totalCents);
  });

  it("recalculates per-person shared cost when occupancy changes (4 parties, 8 guests)", () => {
    const eight = parties.map((p) => ({ ...p, size: 2 }));
    const r = priceAssignment(demoConfig(), eight, demoRooms(), baseline);
    expect(r.sharedPerPersonCents).toBe(21_000);
    expect(r.charges.reduce((a, c) => a + c.totalCents, 0)).toBe(420_000);
  });

  it("does not charge unoccupied rooms; private pool spread over occupied only", () => {
    const r = priceAssignment(demoConfig(), [{ id: "A", size: 2 }, { id: "D", size: 1 }], demoRooms(), { A: "master", D: "bunk" });
    expect(Object.keys(r.roomCosts).sort()).toEqual(["bunk", "master"]);
    expect(r.occupiedWeightMilli).toBe(2050);
    expect(r.charges.reduce((a, c) => a + c.totalCents, 0)).toBe(420_000);
  });

  it("single solo party pays everything", () => {
    const r = priceAssignment(demoConfig(), [{ id: "A", size: 1 }], demoRooms(), { A: "view" });
    expect(r.charges[0].totalCents).toBe(420_000);
  });

  it("room premiums follow weights", () => {
    const r = priceAssignment(demoConfig(), parties, demoRooms(), baseline);
    expect(r.roomCosts.master).toBeGreaterThan(r.roomCosts.view);
    expect(r.roomCosts.view).toBeGreaterThan(r.roomCosts.comfort);
    expect(r.roomCosts.comfort).toBeGreaterThan(r.roomCosts.bunk);
  });

  it("supports editable shared percentage and odd totals", () => {
    for (const sharedBps of [0, 2500, 4000, 7333, 10000]) {
      for (const totalCents of [420_000, 100_001, 7]) {
        const r = priceAssignment({ totalCents, sharedBps }, parties, demoRooms(), baseline);
        expect(r.charges.reduce((a, c) => a + c.totalCents, 0)).toBe(totalCents);
      }
    }
  });

  it("rejects double-booking and invalid party sizes", () => {
    expect(() => priceAssignment(demoConfig(), parties, demoRooms(), { A: "master", B: "master", C: "comfort", D: "bunk" })).toThrow();
    expect(() => priceAssignment(demoConfig(), [{ id: "A", size: 0 }], demoRooms(), { A: "master" })).toThrow();
  });

  it("preview prices match the real model when all rooms are occupied", () => {
    const pv = previewRoomPrice(demoConfig(), demoRooms(), ["master", "view", "comfort", "bunk"], 6, 2);
    expect(pv.master).toBe(140_977);
  });
});
