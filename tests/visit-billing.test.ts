import { describe, expect, it } from "vitest";
import { allocateVisitCents } from "@/lib/visit-billing";

describe("visit billing allocation", () => {
  it("preserves the whole-job total and differs by at most one cent per household", () => {
    const visits = Array.from({ length: 3 }, (_, home) =>
      Array.from({ length: 2 }, (_, round) => allocateVisitCents(10001, 3, 2, home, round)),
    );

    expect(visits).toEqual([[1667, 1667], [1667, 1667], [1667, 1666]]);
    expect(visits.flat().reduce((sum, amount) => sum + amount, 0)).toBe(10001);
  });

  it("keeps distinct pool tier term prices across their respective visits", () => {
    expect([0, 1, 2].map((round) => allocateVisitCents(45001, 1, 3, 0, round)))
      .toEqual([15001, 15000, 15000]);
    expect([0, 1, 2].map((round) => allocateVisitCents(51000, 1, 3, 0, round)))
      .toEqual([17000, 17000, 17000]);
  });

  it("rejects a fractional amount or an out-of-range visit index", () => {
    expect(() => allocateVisitCents(10.5, 2, 3, 0, 0)).toThrow(RangeError);
    expect(() => allocateVisitCents(100, 2, 3, 0, 3)).toThrow(RangeError);
  });
});
