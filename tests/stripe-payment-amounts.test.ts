import { describe, expect, it } from "vitest";
import { calculateStripePaymentAmounts } from "@/lib/stripe-payment-amounts";

describe("Stripe payment split", () => {
  it("funds the HOA share from the fee without reducing the provider payout", () => {
    expect(calculateStripePaymentAmounts(10_000, 1000, 500)).toEqual({
      platformFeeCents: 1000,
      hoaShareCents: 500,
      providerAmountCents: 9000,
      bundleenAmountCents: 500,
    });
    expect(calculateStripePaymentAmounts(10_000, 1000).providerAmountCents).toBe(9000);
  });

  it("preserves every cent while rounding fractional fees in the provider's favor", () => {
    expect(calculateStripePaymentAmounts(129, 1000, 500)).toEqual({
      platformFeeCents: 12,
      hoaShareCents: 6,
      providerAmountCents: 117,
      bundleenAmountCents: 6,
    });
    expect(calculateStripePaymentAmounts(1, 1000, 500).providerAmountCents).toBe(1);
  });

  it("keeps arithmetic exact even at the safe integer limits", () => {
    const total = Number.MAX_SAFE_INTEGER;
    expect(calculateStripePaymentAmounts(total, 10_000, 10_000)).toEqual({
      platformFeeCents: total,
      hoaShareCents: total,
      providerAmountCents: 0,
      bundleenAmountCents: 0,
    });
  });

  it.each([
    [-1, 1000, 500],
    [3.5, 1000, 500],
    [Number.MAX_SAFE_INTEGER + 1, 1000, 500],
    [100, -1, 0],
    [100, 10_001, 0],
    [100, 1000.5, 0],
    [100, 1000, 1001],
    [100, 1000, 500.5],
    [100, 1000, -1],
  ])("rejects invalid split inputs (%d, %d, %d)", (amount, fee, hoa) => {
    expect(() => calculateStripePaymentAmounts(amount, fee, hoa)).toThrow(RangeError);
  });
});
