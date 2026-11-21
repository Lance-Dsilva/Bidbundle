import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startStripeTestCardSetup, verifyStripeTestCardSetup } from "@/lib/server/stripe-test-card";

const mocks = vi.hoisted(() => ({
  save: vi.fn(), offer: vi.fn(), customer: vi.fn(), update: vi.fn(), createCustomer: vi.fn(), createIntent: vi.fn(), retrieveIntent: vi.fn(),
}));
vi.mock("stripe", () => ({
  default: class {
    customers = { create: mocks.createCustomer };
    setupIntents = { create: mocks.createIntent, retrieve: mocks.retrieveIntent };
  },
}));
vi.mock("@/lib/server/visit-billing-consent", () => ({ getVisitBillingOffer: mocks.offer, saveVerifiedStripeTestCard: mocks.save }));
vi.mock("@/lib/server/db", () => ({
  db: { user: { findUniqueOrThrow: mocks.customer, updateMany: mocks.update } },
}));

describe("Stripe sandbox card setup", () => {
  const accepted = { termsToken: "accepted_terms", acceptedAt: "2026-11-15T21:00:00.000Z" };
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("STRIPE_TEST_CARD_SETUP", "1");
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_fixture");
    mocks.offer.mockResolvedValue(accepted);
    mocks.customer.mockResolvedValue({ stripeTestCustomerId: "cus_fixture" });
    mocks.createIntent.mockResolvedValue({ livemode: false, customer: "cus_fixture", client_secret: "fixture_secret" });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("creates a card-only SetupIntent bound to the payer and accepted agreement with a retry key", async () => {
    await expect(startStripeTestCardSetup("payer", "agreement", "attempt")).resolves.toEqual({ clientSecret: "fixture_secret" });
    await startStripeTestCardSetup("payer", "agreement", "attempt");
    expect(mocks.offer).toHaveBeenCalledWith("payer", "agreement");
    expect(mocks.createIntent).toHaveBeenCalledWith({
      customer: "cus_fixture", allowed_payment_method_types: ["card"], usage: "off_session",
      metadata: { bundleenAgreementId: "agreement", bundleenTermsToken: "accepted_terms", bundleenConsentAt: accepted.acceptedAt },
    }, { idempotencyKey: expect.any(String) });
    expect(mocks.createIntent.mock.calls[0][1]).toEqual(mocks.createIntent.mock.calls[1][1]);
  });

  it("uses the customer persisted by a concurrent request", async () => {
    mocks.customer.mockResolvedValueOnce({ stripeTestCustomerId: null });
    mocks.createCustomer.mockResolvedValue({ id: "cus_other", livemode: false });
    mocks.update.mockResolvedValue({ count: 0 });
    await startStripeTestCardSetup("payer", "agreement", "attempt");
    expect(mocks.createIntent.mock.calls[0][0].customer).toBe("cus_fixture");
  });

  it("rejects missing consent and live credentials before creating Stripe objects", async () => {
    mocks.offer.mockResolvedValue({ ...accepted, acceptedAt: null });
    await expect(startStripeTestCardSetup("payer", "agreement", "attempt")).rejects.toMatchObject({ status: 409 });
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_live_fixture");
    await expect(startStripeTestCardSetup("payer", "agreement", "attempt")).rejects.toMatchObject({ status: 503 });
    expect(mocks.createCustomer).not.toHaveBeenCalled();
    expect(mocks.createIntent).not.toHaveBeenCalled();
  });

  it("withholds the client secret after consent or residency changes", async () => {
    mocks.offer.mockResolvedValueOnce(accepted).mockResolvedValueOnce({ ...accepted, acceptedAt: null });
    await expect(startStripeTestCardSetup("payer", "agreement", "attempt")).rejects.toMatchObject({ status: 409 });
  });

  it("verifies a successful setup only for the same customer, agreement and consent", async () => {
    const intent = {
      livemode: false, customer: "cus_fixture", status: "succeeded",
      metadata: { bundleenAgreementId: "agreement", bundleenTermsToken: accepted.termsToken, bundleenConsentAt: accepted.acceptedAt },
      payment_method: { id: "pm_fixture", livemode: false, customer: "cus_fixture", card: { brand: "visa", last4: "4242" } },
    };
    mocks.retrieveIntent.mockResolvedValueOnce(intent)
      .mockResolvedValueOnce({ ...intent, customer: "cus_other" })
      .mockResolvedValueOnce({ ...intent, metadata: { ...intent.metadata, bundleenConsentAt: "old" } });
    await expect(verifyStripeTestCardSetup("payer", "agreement", "seti_fixture")).resolves.toEqual({ brand: "visa", last4: "4242" });
    expect(mocks.save).toHaveBeenCalledWith("payer", "agreement", accepted, {
      customerId: "cus_fixture", paymentMethodId: "pm_fixture", setupIntentId: "seti_fixture", brand: "visa", last4: "4242",
    });
    await expect(verifyStripeTestCardSetup("payer", "agreement", "seti_other")).rejects.toMatchObject({ status: 404 });
    await expect(verifyStripeTestCardSetup("payer", "agreement", "seti_stale")).rejects.toMatchObject({ status: 404 });
  });
});
