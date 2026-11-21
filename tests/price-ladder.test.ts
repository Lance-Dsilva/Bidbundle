import { describe, expect, it } from "vitest";
import { ladderUnlockDedupeKey, priceLadderProgress, resolveLadderAward, validatePriceLadder } from "../src/lib/price-ladder";
const tiers = [{ minHomes: 1, perHomeCents: 12000 }, { minHomes: 10, perHomeCents: 10000 }, { minHomes: 20, perHomeCents: 8000 }];
describe("provider-backed price ladder", () => {
  it("quotes the base price before anyone joins", () => expect(priceLadderProgress(tiers, 0).current.perHomeCents).toBe(12000));
  it("crosses thresholds exactly, never rounds homes up", () => {
    expect(priceLadderProgress(tiers, 9).homesToNext).toBe(1);
    expect(priceLadderProgress(tiers, 10).current.perHomeCents).toBe(10000);
    expect(priceLadderProgress(tiers, 20).next).toBeNull();
  });
  it.each([[], [{ minHomes: 10, perHomeCents: 100 }], [{ minHomes: 1, perHomeCents: -1 }], [{ minHomes: 1, perHomeCents: 1.1 }], [{ minHomes: 1, perHomeCents: 100 }, { minHomes: 2, perHomeCents: 101 }], [{ minHomes: 1, perHomeCents: 100 }, { minHomes: 1, perHomeCents: 90 }], [{ minHomes: 1, perHomeCents: 100 }, { minHomes: 2, perHomeCents: 100 }]].map((bad) => ({ bad })))("rejects invalid tiers $bad", ({ bad }) => expect(() => validatePriceLadder(bad)).toThrow());
  it("freezes the reached full-term price without multiplying by visits", () => expect(resolveLadderAward(tiers, Array(10).fill(12000))).toEqual({ perHomeCents: 10000, amountCents: 100000, lockedHomeCount: 10 }));
  it("honors the lower promise even after neighbors leave", () => expect(resolveLadderAward(tiers, [12000, 10000, 8000])).toEqual({ perHomeCents: 8000, amountCents: 24000, lockedHomeCount: 3 }));
  it("rejects empty enrollment and overflow", () => {
    expect(() => resolveLadderAward(tiers, [])).toThrow();
    expect(() => resolveLadderAward([{ minHomes: 1, perHomeCents: 100000000 }], [100000000,100000000])).toThrow();
  });
  it("deduplicates by immutable commitment, threshold and recipient", () => {
    expect(ladderUnlockDedupeKey("a", 10, "u")).toBe(ladderUnlockDedupeKey("a", 10, "u"));
    expect(ladderUnlockDedupeKey("a", 10, "u")).not.toBe(ladderUnlockDedupeKey("a", 20, "u"));
  });
});
