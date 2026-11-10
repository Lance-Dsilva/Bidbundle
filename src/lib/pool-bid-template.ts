import { z } from "zod";

export const POOL_TIERS = ["standard", "large", "pool_spa"] as const;
export type PoolTier = typeof POOL_TIERS[number];
export const POOL_TIER_LABELS: Record<PoolTier, string> = {
  standard: "Standard pool", large: "Large pool", pool_spa: "Pool + spa",
};
export const POOL_ROUTE_DAYS = ["flexible", "mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const cents = z.number().int().min(1).max(50_000_000);

export const poolTemplateSchema = z.object({
  version: z.literal(1),
  serviceMonths: z.number().int().min(1).max(24),
  visitsPerMonth: z.number().int().min(1).max(8),
  tiers: z.array(z.enum(POOL_TIERS)).min(1).max(3)
    .refine((tiers) => new Set(tiers).size === tiers.length, "Choose each pool tier once."),
  hideProviderNamesUntilAward: z.boolean(),
}).strict().refine((template) => template.serviceMonths * template.visitsPerMonth <= 104, {
  message: "Choose a service term with no more than 104 visits.", path: ["serviceMonths"],
});
export type PoolTemplate = z.infer<typeof poolTemplateSchema>;

export const poolQuoteSchema = z.object({
  monthlyCents: z.object({ standard: cents.optional(), large: cents.optional(), pool_spa: cents.optional() }).strict(),
  chemicalsIncluded: z.boolean(),
  equipmentRepairsExcluded: z.literal(true),
  earliestStartDate: z.string().datetime({ offset: true }),
  routeDay: z.enum(POOL_ROUTE_DAYS),
  cancellationNoticeDays: z.number().int().min(0).max(90),
}).strict();
export type PoolQuote = z.infer<typeof poolQuoteSchema>;
export type PoolTierCounts = Partial<Record<PoolTier, number>>;
export type PoolAgreementSnapshot = {
  version: 1;
  template: PoolTemplate;
  quote: PoolQuote;
  tierCounts: PoolTierCounts;
  homes: Array<{ unitId: string | null; userId: string | null; tier: PoolTier; monthlyCents: number; termCents: number }>;
  amountCents: number;
};

export function parsePoolAgreementSnapshot(value: unknown): PoolAgreementSnapshot | null {
  const parsed = z.object({
    version: z.literal(1), template: poolTemplateSchema, quote: poolQuoteSchema,
    tierCounts: z.object({ standard: z.number().int().nonnegative().optional(), large: z.number().int().nonnegative().optional(), pool_spa: z.number().int().nonnegative().optional() }).strict(),
    homes: z.array(z.object({ unitId: z.string().nullable(), userId: z.string().nullable(), tier: z.enum(POOL_TIERS), monthlyCents: cents, termCents: cents }).strict()).min(1).max(10_000),
    amountCents: cents,
  }).strict().safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Unknown/legacy rows are never upgraded into a different pricing contract. */
export function parsePoolTemplate(value: unknown): PoolTemplate | null {
  const parsed = poolTemplateSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
export function parsePoolQuote(value: unknown): PoolQuote | null {
  const parsed = poolQuoteSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
export function isPoolTier(value: unknown): value is PoolTier {
  return typeof value === "string" && POOL_TIERS.includes(value as PoolTier);
}
export function poolTierCounts(participations: ReadonlyArray<{ poolTier?: string | null; response?: string }>): PoolTierCounts {
  const counts: PoolTierCounts = {};
  for (const row of participations) {
    if (row.response !== undefined && row.response !== "joined") continue;
    if (isPoolTier(row.poolTier)) counts[row.poolTier] = (counts[row.poolTier] ?? 0) + 1;
  }
  return counts;
}

/** Monthly prices remain inputs; only the finite, all-homes term total is the bid amount. */
export function calculatePoolTotal(template: PoolTemplate, quote: PoolQuote, counts: PoolTierCounts): number {
  if (!poolTemplateSchema.safeParse(template).success || !poolQuoteSchema.safeParse(quote).success ||
      Object.keys(counts).some((tier) => !POOL_TIERS.includes(tier as PoolTier))) {
    throw new Error("The pool service term, quote or tier counts are invalid.");
  }
  const configured = new Set(template.tiers);
  if (Object.keys(quote.monthlyCents).length !== configured.size ||
      Object.keys(quote.monthlyCents).some((tier) => !configured.has(tier as PoolTier))) {
    throw new Error("Quote every applicable pool tier, and no other tiers.");
  }
  let monthly = 0;
  let homes = 0;
  for (const tier of POOL_TIERS) {
    const count = counts[tier] ?? 0;
    if (!Number.isSafeInteger(count) || count < 0 || (count > 0 && !configured.has(tier))) {
      throw new Error("The locked pool tier counts are invalid.");
    }
    if (!configured.has(tier)) continue;
    const rate = quote.monthlyCents[tier];
    if (rate === undefined || !Number.isSafeInteger(rate) || rate < 1 || rate > 50_000_000) {
      throw new Error("Enter a positive monthly price in cents for every applicable tier.");
    }
    homes += count;
    monthly += rate * count;
  }
  const total = monthly * template.serviceMonths;
  if (homes === 0 || !Number.isSafeInteger(total) || total < 1 || total > 50_000_000) {
    throw new Error("The whole-job total must be between $0.01 and $500,000 for at least one locked home.");
  }
  return total;
}

/**
 * Each service month is an anchored calendar-month window. Month-end starts
 * clamp to the last day without drifting (Jan 31 → Feb 28 → Mar 31). Visits
 * are spaced inside that window, not priced by an assumed number of weeks.
 * These are planned dates; the existing provider day planner confirms times.
 */
function poolCalendarBoundary(start: Date, offset: number): Date {
  const month = start.getUTCMonth() + offset;
  const lastDay = new Date(Date.UTC(start.getUTCFullYear(), month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(start.getUTCFullYear(), month, Math.min(start.getUTCDate(), lastDay),
    start.getUTCHours(), start.getUTCMinutes(), start.getUTCSeconds(), start.getUTCMilliseconds()));
}

/** Exclusive end of the explicitly quoted calendar-month service term. */
export function computePoolTermEnd(start: Date, template: PoolTemplate): Date {
  if (!Number.isFinite(start.getTime()) || !poolTemplateSchema.safeParse(template).success) {
    throw new Error("A valid pool service start and term are required.");
  }
  return poolCalendarBoundary(start, template.serviceMonths);
}

export function computePoolOccurrenceDates(start: Date, template: PoolTemplate): Date[] {
  computePoolTermEnd(start, template);
  const dates: Date[] = [];
  for (let month = 0; month < template.serviceMonths; month += 1) {
    const from = poolCalendarBoundary(start, month);
    const to = poolCalendarBoundary(start, month + 1);
    const days = Math.round((to.getTime() - from.getTime()) / 86_400_000);
    for (let visit = 0; visit < template.visitsPerMonth; visit += 1) {
      dates.push(new Date(from.getTime() + Math.floor(days * visit / template.visitsPerMonth) * 86_400_000));
    }
  }
  return dates;
}
