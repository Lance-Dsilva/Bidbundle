import Stripe from "stripe";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ attempts: vi.fn(), provider: vi.fn(), read: vi.fn(), update: vi.fn(), updateMany: vi.fn(), consent: vi.fn(), visit: vi.fn(), create: vi.fn(), retrieve: vi.fn(), confirm: vi.fn(), raw: vi.fn() }));
vi.mock("stripe", () => ({ default: class { static errors = { StripeCardError: class extends Error {} }; paymentIntents = { create: m.create, retrieve: m.retrieve, confirm: m.confirm }; } }));
vi.mock("@/lib/server/db", () => {
  const tx = { stripeTestPaymentAttempt: { findMany: m.attempts }, user: { findUnique: m.provider }, $queryRaw: m.raw, stripeTestPayment: { findUnique: m.read, findUniqueOrThrow: m.read, update: m.update, updateMany: m.updateMany }, visitBillingConsent: { findUnique: m.consent }, serviceVisit: { findUnique: m.visit } };
  return { db: { ...tx, $transaction: (fn: (t: typeof tx) => unknown) => fn(tx) } };
});
import { chargeStripeTestVisit } from "@/lib/server/stripe-test-payments";
const payment = { providerUserId: "provider", providerAccountId: "acct_fixture", visitId: "visit", requestId: "request", agreementId: "agreement", unitId: "unit", residentUserId: "payer", amountCents: 1000, currency: "usd", customerId: "cus_fixture", paymentMethodId: "pm_fixture", termsToken: "terms", stripePaymentIntentId: "pi_fixture", status: "pending" };
const intent = { id: "pi_fixture", livemode: false, status: "requires_confirmation", amount: 1000, currency: "usd", customer: "cus_fixture", payment_method: "pm_fixture", metadata: { bundleenVisitId: "visit" }, latest_charge: null };
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("STRIPE_TEST_PAYMENTS", "1"); vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_fixture");
  m.attempts.mockResolvedValue([]);
  m.provider.mockResolvedValue({ role: "provider", providerProfile: { accountStatus: "active", stripeTestAccountId: "acct_fixture", stripeTestPayoutStatus: "active" } });
  m.read.mockResolvedValue(payment); m.retrieve.mockResolvedValue(intent);
  m.confirm.mockResolvedValue({ ...intent, status: "succeeded", latest_charge: "ch_fixture" });
  m.consent.mockResolvedValue({ termsToken: "terms", testCard: { customerId: "cus_fixture", paymentMethodId: "pm_fixture" } });
  m.visit.mockResolvedValue({ status: "completed", occurrence: { agreement: { status: "active", request: { status: "in_progress" } } } });
});
afterEach(() => vi.unstubAllEnvs());
it("confirms only the persisted intent and snapshots success", async () => {
  await chargeStripeTestVisit("visit");
  expect(m.create).not.toHaveBeenCalled();
  expect(m.confirm).toHaveBeenCalledWith("pi_fixture", { off_session: true }, { idempotencyKey: "charge_visit_visit" });
  expect(m.update).toHaveBeenCalledWith({ where: { visitId: "visit" }, data: { status: "succeeded", stripeChargeId: "ch_fixture", failureCode: null } });
});
it("recovers remote success after a lost confirmation response without confirming again", async () => {
  m.confirm.mockRejectedValueOnce(new Error("connection lost"));
  await expect(chargeStripeTestVisit("visit")).rejects.toThrow("connection lost");
  m.retrieve.mockResolvedValue({ ...intent, status: "succeeded", latest_charge: "ch_fixture" });
  await chargeStripeTestVisit("visit");
  expect(m.confirm).toHaveBeenCalledTimes(1); expect(m.create).not.toHaveBeenCalled();
});
it("rejects mismatched amount and revoked consent before confirmation", async () => {
  m.retrieve.mockResolvedValueOnce({ ...intent, amount: 1001 });
  await expect(chargeStripeTestVisit("visit")).rejects.toMatchObject({ status: 409 });
  m.consent.mockResolvedValue(null);
  await expect(chargeStripeTestVisit("visit")).rejects.toMatchObject({ status: 409 });
  expect(m.confirm).not.toHaveBeenCalled();
});
it("does not confirm canceled service or a payment requiring resident action", async () => {
  m.visit.mockResolvedValue({ status: "completed", occurrence: { agreement: { status: "cancelled", request: { status: "cancelled" } } } });
  await expect(chargeStripeTestVisit("visit")).rejects.toMatchObject({ status: 409 });
  m.retrieve.mockResolvedValue({ ...intent, status: "requires_action" });
  await chargeStripeTestVisit("visit");
  expect(m.confirm).not.toHaveBeenCalled();
  expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: "requires_action", failureCode: null } }));
});
it("never creates an intent with confirmation enabled and persists identity first", async () => {
  m.read.mockResolvedValueOnce({ ...payment, stripePaymentIntentId: null }); m.create.mockResolvedValue(intent);
  await chargeStripeTestVisit("visit");
  expect(m.create.mock.calls[0][0]).not.toHaveProperty("confirm");
  expect(m.updateMany.mock.calls[0][0].data.stripePaymentIntentId).toBe("pi_fixture");
  expect(m.updateMany.mock.invocationCallOrder[0]).toBeLessThan(m.confirm.mock.invocationCallOrder[0]);
});
it("live credentials fail closed without creating or confirming intents", async () => {
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_live_fixture");
  await expect(chargeStripeTestVisit("visit")).rejects.toMatchObject({ status: 503 });
  expect(m.create).not.toHaveBeenCalled(); expect(m.confirm).not.toHaveBeenCalled();
});

it("rechecks provider suspension and payout account changes before confirmation", async () => {
  m.provider.mockResolvedValue({ role: "provider", providerProfile: { accountStatus: "suspended", stripeTestAccountId: "acct_fixture", stripeTestPayoutStatus: "active" } });
  await expect(chargeStripeTestVisit("visit")).rejects.toMatchObject({ status: 409 });
  m.provider.mockResolvedValue({ role: "provider", providerProfile: { accountStatus: "active", stripeTestAccountId: "acct_replaced", stripeTestPayoutStatus: "active" } });
  await expect(chargeStripeTestVisit("visit")).rejects.toMatchObject({ status: 409 });
  expect(m.confirm).not.toHaveBeenCalled();
});

it("retries a verified replacement card on the same intent using its durable attempt key", async () => {
  m.attempts.mockResolvedValue([{ id: "attempt", customerId: "cus_fixture", paymentMethodId: "pm_replacement" }]);
  m.retrieve.mockResolvedValue({ ...intent, status: "requires_payment_method", payment_method: null });
  m.confirm.mockResolvedValue({ ...intent, payment_method: "pm_replacement", status: "succeeded", latest_charge: "ch_fixture" });
  m.consent.mockResolvedValue(null); // Original payment identity, not today's occupant, authorizes recovery.
  await chargeStripeTestVisit("visit");
  expect(m.create).not.toHaveBeenCalled();
  expect(m.confirm).toHaveBeenCalledWith("pi_fixture", { off_session: true, payment_method: "pm_replacement" }, { idempotencyKey: "recover_visit_visit_attempt" });
  expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "succeeded", lastRecoveryAttemptId: "attempt" }) }));
});
it("does not automatically retry a declined recovery attempt", async () => {
  m.read.mockResolvedValue({ ...payment, lastRecoveryAttemptId: "attempt" });
  m.attempts.mockResolvedValue([{ id: "attempt", paymentMethodId: "pm_replacement" }]);
  m.retrieve.mockResolvedValue({ ...intent, status: "requires_payment_method", payment_method: null });
  await chargeStripeTestVisit("visit");
  expect(m.confirm).not.toHaveBeenCalled();
  expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: "failed", failureCode: null } }));
});
it("recovers replacement-card remote success without another confirmation", async () => {
  m.attempts.mockResolvedValue([{ id: "attempt", paymentMethodId: "pm_replacement" }]);
  m.retrieve.mockResolvedValue({ ...intent, status: "succeeded", payment_method: "pm_replacement", latest_charge: "ch_fixture" });
  await chargeStripeTestVisit("visit");
  expect(m.create).not.toHaveBeenCalled(); expect(m.confirm).not.toHaveBeenCalled();
});

it("persists a card decline from the same intent rather than rolling it back", async () => {
  const declined = Object.setPrototypeOf(new Error("declined"), Stripe.errors.StripeCardError.prototype);
  m.confirm.mockRejectedValue(declined);
  m.retrieve.mockResolvedValueOnce(intent).mockResolvedValueOnce({ ...intent, status: "requires_payment_method", payment_method: null, last_payment_error: { code: "card_declined" } });
  await chargeStripeTestVisit("visit");
  expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "failed", failureCode: "card_declined" }) }));
  expect(m.create).not.toHaveBeenCalled();
});
