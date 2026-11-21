/** Recurring financial allocation is line-based: Bundleen absorbs rounding. */
function cents(value: number) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("Invalid monetary amount.");
  return value;
}
function proportion(amount: number, numerator: number, denominator: number) {
  return Number(BigInt(amount) * BigInt(numerator) / BigInt(denominator));
}
export function recurringLineEntitlements(grossCents: number, feeBps: number, hoaBps: number) {
  cents(grossCents);
  if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > 1000 || !Number.isInteger(hoaBps) || hoaBps < 0 || hoaBps > feeBps) throw new Error("Invalid fee allocation.");
  const feeCents = proportion(grossCents, feeBps, 10000);
  const hoaCents = proportion(grossCents, hoaBps, 10000);
  return { grossCents, feeCents, providerCents: grossCents - feeCents, hoaCents };
}
export function recurringLineRefundBalance(line: ReturnType<typeof recurringLineEntitlements>, refundedCents: number) {
  cents(refundedCents);
  if (line.grossCents <= 0 || refundedCents > line.grossCents) throw new Error("Refund exceeds line amount.");
  const providerDebitCents = proportion(line.providerCents, refundedCents, line.grossCents);
  const hoaDebitCents = proportion(line.hoaCents, refundedCents, line.grossCents);
  const remainingGrossCents = line.grossCents - refundedCents;
  const providerRemainingCents = line.providerCents - providerDebitCents;
  const hoaRemainingCents = line.hoaCents - hoaDebitCents;
  // This signed balance can be -1 cent on a nearly-full refund. Do not take
  // an extra cent from the provider/HOA to hide Bundleen's rounding liability.
  const platformNetCents = remainingGrossCents - providerRemainingCents - hoaRemainingCents;
  return { providerDebitCents, hoaDebitCents, remainingGrossCents, providerRemainingCents, hoaRemainingCents, platformNetCents, platformRoundingLiabilityCents: Math.max(0, -platformNetCents) };
}
export function recurringRefundDelta(line: ReturnType<typeof recurringLineEntitlements>, previousRefundCents: number, nextRefundCents: number) {
  if (nextRefundCents < previousRefundCents) throw new Error("Refund totals cannot decrease.");
  const previous = recurringLineRefundBalance(line, previousRefundCents);
  const next = recurringLineRefundBalance(line, nextRefundCents);
  return { grossCents: nextRefundCents - previousRefundCents, providerCents: next.providerDebitCents - previous.providerDebitCents, hoaCents: next.hoaDebitCents - previous.hoaDebitCents };
}
