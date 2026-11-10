import { describe, expect, it } from "vitest";
import {
  calculatePoolTotal, computePoolOccurrenceDates, computePoolTermEnd, parsePoolAgreementSnapshot,
  parsePoolQuote, parsePoolTemplate, poolTierCounts, poolTemplateSchema, poolQuoteSchema,
  type PoolTemplate, type PoolQuote,
} from "@/lib/pool-bid-template";
import { hoaRequestCreateSchema, bidSubmitSchema, participationResponseSchema } from "@/lib/validation/hoa";

const template: PoolTemplate = { version: 1, serviceMonths: 3, visitsPerMonth: 4, tiers: ["standard", "large", "pool_spa"], hideProviderNamesUntilAward: true };
const quote: PoolQuote = {
  monthlyCents: { standard: 10001, large: 15003, pool_spa: 20007 }, chemicalsIncluded: true,
  equipmentRepairsExcluded: true, earliestStartDate: "2027-01-31T12:00:00.000Z", routeDay: "mon", cancellationNoticeDays: 30,
};

describe("finite pool tier contract", () => {
  it("adds exact monthly rates across locked tier counts and multiplies by explicit months", () => {
    expect(calculatePoolTotal(template, quote, { standard: 2, large: 1, pool_spa: 1 })).toBe(165036);
    // Visits/month never change the monthly price or silently convert it to a visit charge.
    expect(calculatePoolTotal({ ...template, visitsPerMonth: 1 }, quote, { standard: 2, large: 1, pool_spa: 1 })).toBe(165036);
  });
  it("requires a quote for every configured tier even when no current home selected it", () => {
    expect(() => calculatePoolTotal(template, { ...quote, monthlyCents: { standard: 10000 } }, { standard: 1 })).toThrow(/every applicable/);
    expect(calculatePoolTotal(template, quote, { standard: 1 })).toBe(30003);
  });
  it.each([0, -1, 1.5, NaN, Infinity, 50_000_001])("rejects invalid monthly integer cents %s", (rate) => {
    expect(() => calculatePoolTotal(template, { ...quote, monthlyCents: { ...quote.monthlyCents, standard: rate } }, { standard: 1 })).toThrow();
  });
  it("rejects empty audiences, foreign tiers, fractional counts, and overflow totals", () => {
    expect(() => calculatePoolTotal(template, quote, {})).toThrow();
    expect(() => calculatePoolTotal(template, quote, { standard: 1.5 })).toThrow();
    expect(() => calculatePoolTotal(template, quote, { standard: 1, invented: 3 } as never)).toThrow();
    expect(() => calculatePoolTotal(template, quote, { standard: 10000 })).toThrow();
    expect(() => calculatePoolTotal({ ...template, tiers: ["standard"] }, { ...quote, monthlyCents: { standard: 10001 } }, { large: 1 })).toThrow();
  });
  it("counts joined classifications only and never infers missing pool sizes", () => {
    expect(poolTierCounts([{ poolTier: "standard", response: "joined" }, { poolTier: "large", response: "declined" },
      { poolTier: "pool_spa", response: "joined" }, { poolTier: "unknown", response: "joined" }, { poolTier: null }])).toEqual({ standard: 1, pool_spa: 1 });
  });
  it("does not reinterpret legacy or malformed rows as a pool template/quote", () => {
    expect(parsePoolTemplate(null)).toBeNull(); expect(parsePoolTemplate({ version: 2 })).toBeNull();
    expect(parsePoolQuote({ amountCents: 20 })).toBeNull(); expect(parsePoolAgreementSnapshot({ ...template })).toBeNull();
    expect(poolTemplateSchema.safeParse({ ...template, tiers: ["standard", "standard"] }).success).toBe(false);
    expect(poolTemplateSchema.safeParse({ ...template, serviceMonths: 24, visitsPerMonth: 8 }).success).toBe(false);
    expect(poolQuoteSchema.safeParse({ ...quote, equipmentRepairsExcluded: false }).success).toBe(false);
  });
});

describe("calendar service planning without week/month price conversion", () => {
  it("clamps month-end anchors without drifting after February", () => {
    const scope = { ...template, visitsPerMonth: 1 };
    expect(computePoolOccurrenceDates(new Date(quote.earliestStartDate), scope).map((date) => date.toISOString())).toEqual([
      "2027-01-31T12:00:00.000Z", "2027-02-28T12:00:00.000Z", "2027-03-31T12:00:00.000Z",
    ]);
    expect(computePoolTermEnd(new Date(quote.earliestStartDate), scope).toISOString()).toBe("2027-04-30T12:00:00.000Z");
  });
  it("plans exactly the requested visits inside each month, including leap years", () => {
    const dates = computePoolOccurrenceDates(new Date("2028-01-31T09:30:00Z"), template);
    expect(dates).toHaveLength(12);
    expect(dates[4].toISOString()).toBe("2028-02-29T09:30:00.000Z");
    expect(dates[8].toISOString()).toBe("2028-03-31T09:30:00.000Z");
    expect(dates.every((date, index) => index === 0 || date > dates[index - 1])).toBe(true);
    expect(dates[11] < computePoolTermEnd(dates[0], template)).toBe(true);
  });
  it("has an exclusive full-month end even for one monthly visit", () => {
    const one = { ...template, serviceMonths: 1, visitsPerMonth: 1 };
    const start = new Date("2027-02-15T10:00:00Z");
    expect(computePoolOccurrenceDates(start, one)).toEqual([start]);
    expect(computePoolTermEnd(start, one).toISOString()).toBe("2027-03-15T10:00:00.000Z");
    expect(() => computePoolOccurrenceDates(new Date("invalid"), template)).toThrow();
  });
});

describe("request and bid API validation", () => {
  const request = { title: "Pool care", category: "pool_cleaning", description: "Monthly pool service", kind: "optional_group", poolTemplate: template };
  it("accepts the canonicalized pool alias and keeps legacy requests valid", () => {
    expect(hoaRequestCreateSchema.parse(request).category).toBe("pool_care");
    expect(hoaRequestCreateSchema.safeParse({ ...request, category: "cleaning", poolTemplate: undefined }).success).toBe(true);
  });
  it("restricts resident-selected tiers to optional pool-care requests", () => {
    expect(hoaRequestCreateSchema.safeParse({ ...request, category: "cleaning" }).success).toBe(false);
    expect(hoaRequestCreateSchema.safeParse({ ...request, kind: "compulsory_recurring", recurrenceLabel: "Monthly" }).success).toBe(false);
    expect(participationResponseSchema.safeParse({ response: "joined", poolTier: "invented" }).success).toBe(false);
  });
  it("accepts structured pool rates without a caller-authored total and requires validity", () => {
    const body = { pricingBasis: "total", scope: "Clean every participating pool", poolQuote: quote, validUntil: "2027-01-30T12:00:00Z" };
    expect(bidSubmitSchema.safeParse(body).success).toBe(true);
    expect(bidSubmitSchema.safeParse({ ...body, validUntil: null }).success).toBe(false);
    expect(bidSubmitSchema.safeParse({ ...body, expectedBidVersion: 2 }).success).toBe(true);
    expect(bidSubmitSchema.safeParse({ ...body, expectedBidVersion: 0 }).success).toBe(false);
    expect(bidSubmitSchema.safeParse({ pricingBasis: "total", scope: "Legacy" }).success).toBe(false);
    expect(bidSubmitSchema.safeParse({ pricingBasis: "total", scope: "Legacy", amountCents: 0 }).success).toBe(true);
  });
});
