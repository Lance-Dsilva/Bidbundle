/** Display-only averages. The integer whole-job total remains the contract price. */
export function calculateQuoteBreakdown(
  amountCents: number,
  homeCount: number | null | undefined,
  totalOccurrences: number | null | undefined,
): { perHomeCents: number | null; perHomeVisitCents: number | null } {
  const validAmount = Number.isSafeInteger(amountCents) && amountCents >= 0;
  const validHomes = typeof homeCount === "number" && Number.isSafeInteger(homeCount) && homeCount > 0;
  const validRounds = typeof totalOccurrences === "number" && Number.isSafeInteger(totalOccurrences) && totalOccurrences > 0;
  const perHomeCents = validAmount && validHomes ? amountCents / homeCount : null;
  const visits = validHomes && validRounds ? homeCount * totalOccurrences : null;
  return {
    perHomeCents,
    perHomeVisitCents: validAmount && visits !== null && Number.isSafeInteger(visits)
      ? amountCents / visits
      : null,
  };
}

type ComparableQuote = {
  id?: string;
  pricingBasis: string;
  currency: string;
  amountCents: number;
};

/** Group totals by currency without FX conversion; never rank legacy unit amounts as totals. */
export function compareBidQuotes(a: ComparableQuote, b: ComparableQuote): number {
  const aTotal = a.pricingBasis === "total";
  const bTotal = b.pricingBasis === "total";
  if (aTotal !== bTotal) return aTotal ? -1 : 1;
  if (aTotal && bTotal) {
    const currencyOrder = a.currency.localeCompare(b.currency);
    if (currencyOrder !== 0) return currencyOrder;
    const amountOrder = a.amountCents - b.amountCents;
    if (amountOrder !== 0) return amountOrder;
  }
  return (a.id ?? "").localeCompare(b.id ?? "");
}
