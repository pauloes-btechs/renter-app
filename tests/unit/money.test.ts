import { describe, expect, it } from "vitest";
import { allocateLargestRemainder, splitEqually, formatMoney } from "@/lib/engine";

describe("allocateLargestRemainder", () => {
  it("sums exactly to the total for awkward splits", () => {
    for (const total of [1, 99, 100, 101, 420_000, 333_333, 999_999_99]) {
      for (const w of [[1, 1, 1], [1450, 1150, 1100, 600], [7, 3], [1, 2, 3, 4, 5, 6, 7]]) {
        const parts = allocateLargestRemainder(total, w);
        expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
        parts.forEach((p) => expect(Number.isInteger(p)).toBe(true));
      }
    }
  });
  it("gives leftover cents to largest remainders, ties by index", () => {
    expect(allocateLargestRemainder(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocateLargestRemainder(252_000, [1450, 1150, 1100, 600])).toEqual([84_977, 67_395, 64_465, 35_163]);
  });
  it("rejects invalid input", () => {
    expect(() => allocateLargestRemainder(1.5, [1])).toThrow();
    expect(() => allocateLargestRemainder(100, [0, 0])).toThrow();
    expect(() => allocateLargestRemainder(100, [])).toThrow();
  });
  it("splitEqually is deterministic", () => {
    expect(splitEqually(1001, 2)).toEqual([501, 500]);
  });
  it("formats money", () => {
    expect(formatMoney(140_977)).toBe("$1,409.77");
  });
});
