import { describe, expect, it } from "vitest";
import { calculateQuoteBreakdown, compareBidQuotes } from "@/lib/bid-pricing";

describe("whole-job quote arithmetic", () => {
  it("divides the whole job across homes and then each home's service rounds", () => {
    expect(calculateQuoteBreakdown(120000, 4, 3)).toEqual({ perHomeCents: 30000, perHomeVisitCents: 10000 });
  });
  it("retains fractional cents as approximate helpers without reconstructing the total", () => {
    const result = calculateQuoteBreakdown(10001, 3, 4);
    expect(result.perHomeCents).toBeCloseTo(10001 / 3, 9);
    expect(result.perHomeVisitCents).toBeCloseTo(10001 / 12, 9);
    expect(result.perHomeVisitCents).not.toBe(Math.round(10001 / 3) / 4);
  });
  it("keeps zero-price totals valid", () => { expect(calculateQuoteBreakdown(0, 3, 4)).toEqual({ perHomeCents: 0, perHomeVisitCents: 0 }); });
  it.each([null, undefined, 0, -1, 1.5, Infinity, Number.NaN])("does not invent a home count for %s", (homes) => {
    expect(calculateQuoteBreakdown(10001, homes, 3)).toEqual({ perHomeCents: null, perHomeVisitCents: null });
  });
  it.each([null, undefined, 0, -1, 1.5, Infinity, Number.NaN])("can show per-home cost but never invents visit rounds for %s", (visits) => {
    expect(calculateQuoteBreakdown(10000, 4, visits)).toEqual({ perHomeCents: 2500, perHomeVisitCents: null });
  });
  it.each([-1, 1.5, Infinity, Number.NaN])("refuses an invalid canonical total %s", (total) => {
    expect(calculateQuoteBreakdown(total, 3, 4)).toEqual({ perHomeCents: null, perHomeVisitCents: null });
  });
});

describe("comparable quote ordering", () => {
  const quote = (id: string, amountCents: number, currency = "usd", pricingBasis: "total" | "per_home" | "per_visit" = "total") => ({ id, amountCents, currency, pricingBasis });
  it("does not present a cheaper legacy unit amount as the lowest whole-job quote", () => {
    const rows = [quote("legacy-a", 1, "usd", "per_visit"), quote("total-b", 20000), quote("total-a", 10000), quote("legacy-b", 0, "usd", "per_home")];
    expect(rows.sort(compareBidQuotes).map((row) => row.id)).toEqual(["total-a", "total-b", "legacy-a", "legacy-b"]);
  });
  it("groups currencies before comparing totals without converting them", () => {
    const rows = [quote("usd-1", 1, "usd"), quote("eur-2", 20000, "eur"), quote("usd-2", 500, "usd"), quote("eur-1", 10000, "eur")];
    expect(rows.sort(compareBidQuotes).map((row) => row.id)).toEqual(["eur-1", "eur-2", "usd-1", "usd-2"]);
  });
  it("does not compare legacy amounts across ambiguous unit bases", () => {
    expect([quote("z", 1, "usd", "per_home"), quote("a", 999999, "usd", "per_visit")].sort(compareBidQuotes).map((row) => row.id)).toEqual(["a", "z"]);
  });
});
