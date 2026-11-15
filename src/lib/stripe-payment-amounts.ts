const BASIS_POINTS_PER_WHOLE = BigInt(10_000);

export function calculateStripePaymentAmounts(
  amountCents: number,
  platformFeeBps: number,
  hoaShareBps = 0,
): {
  platformFeeCents: number;
  hoaShareCents: number;
  providerAmountCents: number;
  bundleenAmountCents: number;
} {
  if (!Number.isSafeInteger(amountCents) || amountCents < 0) {
    throw new RangeError("Expected a nonnegative integer amount in cents");
  }
  if (!Number.isInteger(platformFeeBps) || platformFeeBps < 0 || platformFeeBps > 10_000) {
    throw new RangeError("Platform fee must be between 0 and 10,000 basis points");
  }
  if (!Number.isInteger(hoaShareBps) || hoaShareBps < 0 || hoaShareBps > platformFeeBps) {
    throw new RangeError("HOA share must fit within the platform fee");
  }

  const gross = BigInt(amountCents);
  // Round the fee down so the provider always receives at least its contractual
  // percentage. Calculate the HOA share from gross, then fund it from the fee.
  const platformFeeCents = Number(gross * BigInt(platformFeeBps) / BASIS_POINTS_PER_WHOLE);
  const hoaShareCents = Number(gross * BigInt(hoaShareBps) / BASIS_POINTS_PER_WHOLE);

  return {
    platformFeeCents,
    hoaShareCents,
    providerAmountCents: amountCents - platformFeeCents,
    bundleenAmountCents: platformFeeCents - hoaShareCents,
  };
}
