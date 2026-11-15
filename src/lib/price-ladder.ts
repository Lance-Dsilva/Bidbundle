/** Provider-committed prices in cents per home for the complete service term. */
export type PriceLadderTier = { minHomes: number; perHomeCents: number };
export const MAX_PRICE_LADDER_TIERS = 20;
export const MAX_LADDER_HOMES = 10_000;
export const MAX_LADDER_CENTS = 100_000_000;

export function validatePriceLadder(value: unknown): PriceLadderTier[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_PRICE_LADDER_TIERS) {
    throw new Error("Enter between 1 and 20 price tiers.");
  }
  const tiers: PriceLadderTier[] = value.map((tier: unknown) => {
    if (!tier || typeof tier !== "object" || Array.isArray(tier)) throw new Error("Each tier needs a home count and price.");
    const row = tier as Record<string, unknown>;
    if (Object.keys(row).some((key) => key !== "minHomes" && key !== "perHomeCents")) throw new Error("Unexpected price tier field.");
    if (typeof row.minHomes !== "number" || !Number.isSafeInteger(row.minHomes) || row.minHomes < 1 || row.minHomes > MAX_LADDER_HOMES) throw new Error("Home thresholds must be whole numbers between 1 and 10,000.");
    if (typeof row.perHomeCents !== "number" || !Number.isSafeInteger(row.perHomeCents) || row.perHomeCents < 0 || row.perHomeCents > MAX_LADDER_CENTS) throw new Error("Prices must be whole cents within the supported range.");
    return { minHomes: row.minHomes, perHomeCents: row.perHomeCents };
  });
  if (tiers[0].minHomes !== 1) throw new Error("Start at 1 home to guarantee a maximum price for every enrollment.");
  for (let i = 1; i < tiers.length; i++) {
    if (tiers[i].minHomes <= tiers[i - 1].minHomes) throw new Error("Home thresholds must strictly increase.");
    if (tiers[i].perHomeCents >= tiers[i - 1].perHomeCents) throw new Error("Each additional tier must lower the per-home price.");
  }
  return tiers;
}

export function priceLadderProgress(value: unknown, joinedHomes: number) {
  const tiers = validatePriceLadder(value);
  if (!Number.isSafeInteger(joinedHomes) || joinedHomes < 0 || joinedHomes > MAX_LADDER_HOMES) throw new Error("Invalid joined home count.");
  // With no enrollments, show the provider's base commitment, not a discount.
  const currentIndex = tiers.reduce((index, tier, i) => tier.minHomes <= Math.max(1, joinedHomes) ? i : index, 0);
  const current = tiers[currentIndex];
  const next = tiers[currentIndex + 1] ?? null;
  return { tiers, joinedHomes, currentIndex, current, next, homesToNext: next ? next.minHomes - joinedHomes : null };
}

/** Caps survive opt-outs: fewer homes cannot raise any remaining resident's promise. */
export function resolveLadderAward(value: unknown, enrollmentCapsCents: readonly number[]) {
  if (!enrollmentCapsCents.length) throw new Error("At least one enrolled home is required.");
  const progress = priceLadderProgress(value, enrollmentCapsCents.length);
  if (enrollmentCapsCents.some((cap) => !Number.isSafeInteger(cap) || cap < 0 || cap > MAX_LADDER_CENTS)) throw new Error("Invalid enrollment price commitment.");
  const perHomeCents = Math.min(progress.current.perHomeCents, ...enrollmentCapsCents);
  const amountCents = perHomeCents * enrollmentCapsCents.length;
  if (!Number.isSafeInteger(amountCents) || amountCents > MAX_LADDER_CENTS) throw new Error("The whole-job total exceeds the supported limit.");
  return { perHomeCents, amountCents, lockedHomeCount: enrollmentCapsCents.length };
}

/** Stable transactional outbox key; crossing the same tier again cannot resend it. */
export function ladderUnlockDedupeKey(commitmentId: string, minHomes: number, recipientId: string) {
  return `price-ladder:${encodeURIComponent(commitmentId)}:tier:${minHomes}:${encodeURIComponent(recipientId)}`;
}
