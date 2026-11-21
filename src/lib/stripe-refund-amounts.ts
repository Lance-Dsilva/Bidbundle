/** Cumulative rounding makes the last partial refund reverse the exact remainder. */
export function incrementalProviderReversal(gross: number, provider: number, refundedBefore: number, refund: number): number {
  if (![gross, provider, refundedBefore, refund].every(Number.isSafeInteger) || gross < 1 || provider < 0 || provider > gross ||
      refundedBefore < 0 || refund < 1 || refundedBefore + refund > gross) throw new RangeError("Invalid refund allocation");
  const g = BigInt(gross), p = BigInt(provider), before = BigInt(refundedBefore);
  return Number(p * (before + BigInt(refund)) / g - p * before / g);
}
