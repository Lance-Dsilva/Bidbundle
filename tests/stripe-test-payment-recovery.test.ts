import { afterEach, beforeEach, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  payment: vi.fn(), current: vi.fn(), attempts: vi.fn(), attempt: vi.fn(), latestAttempt: vi.fn(), createAttempt: vi.fn(),
  raw: vi.fn(), retrieve: vi.fn(), createSetup: vi.fn(), retrieveSetup: vi.fn(), charge: vi.fn(), notify: vi.fn(),
}));
vi.mock("stripe", () => ({ default: class {
  paymentIntents = { retrieve: m.retrieve };
  setupIntents = { create: m.createSetup, retrieve: m.retrieveSetup };
} }));
vi.mock("@/lib/server/stripe-test-payments", () => ({ chargeStripeTestVisit: m.charge }));
vi.mock("@/lib/server/stripe-test-payment-notifications", () => ({ notifyStripeTestPaymentProblem: m.notify }));
vi.mock("@/lib/server/db", () => {
  const tx = {
    $queryRaw: m.raw,
    stripeTestPayment: { findUnique: m.payment, findUniqueOrThrow: m.current },
    stripeTestPaymentAttempt: { findMany: m.attempts, findUnique: m.attempt, findFirst: m.latestAttempt, create: m.createAttempt },
  };
  return { db: { ...tx, $transaction: async (fn: (value: typeof tx) => unknown) => fn(tx) } };
});
import { getStripeTestPaymentRecovery, startStripeTestPaymentRecovery, retryStripeTestPayment } from "@/lib/server/stripe-test-payment-recovery";

const payment = { visitId: "visit", residentUserId: "payer", stripePaymentIntentId: "pi_owned", amountCents: 1000, currency: "usd", customerId: "cus_owned", paymentMethodId: "pm_original", termsToken: "accepted-terms" };
const intent = { id: "pi_owned", livemode: false, amount: 1000, currency: "usd", customer: "cus_owned", payment_method: "pm_original", metadata: { bundleenVisitId: "visit" }, status: "requires_payment_method", client_secret: "pi_owned_secret_fixture" };
const method = { id: "pm_replacement", livemode: false, customer: "cus_owned", card: { brand: "visa", last4: "4242" } };
const setup = { id: "seti_owned", livemode: false, customer: "cus_owned", status: "succeeded", client_secret: "seti_owned_secret_fixture", payment_method: method,
  metadata: { bundleenVisitId: "visit", bundleenRecoveryAttemptId: "attempt", bundleenTermsToken: "accepted-terms" } };

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("STRIPE_TEST_PAYMENTS", "1"); vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_fixture");
  m.payment.mockResolvedValue({ ...payment }); m.current.mockResolvedValue({ ...payment });
  m.attempts.mockResolvedValue([]); m.attempt.mockResolvedValue(null); m.latestAttempt.mockResolvedValue(null);
  m.retrieve.mockResolvedValue({ ...intent }); m.createSetup.mockResolvedValue({ ...setup });
  m.retrieveSetup.mockResolvedValue({ ...setup });
});
afterEach(() => vi.unstubAllEnvs());

it.each(["get", "start", "retry"])("%s denies another resident before any Stripe read or write", async action => {
  const operation = action === "get" ? getStripeTestPaymentRecovery("other-resident", "visit") :
    action === "start" ? startStripeTestPaymentRecovery("other-resident", "visit", "attempt") :
      retryStripeTestPayment("other-resident", "visit", "attempt", "seti_owned");
  await expect(operation).rejects.toMatchObject({ status: 404 });
  expect(m.retrieve).not.toHaveBeenCalled(); expect(m.createSetup).not.toHaveBeenCalled();
  expect(m.retrieveSetup).not.toHaveBeenCalled(); expect(m.createAttempt).not.toHaveBeenCalled(); expect(m.charge).not.toHaveBeenCalled();
});

it.each(["succeeded", "processing", "requires_payment_method", "canceled"])("does not expose a client secret for %s", async status => {
  m.retrieve.mockResolvedValue({ ...intent, status });
  await expect(getStripeTestPaymentRecovery("payer", "visit")).resolves.toEqual({ amountCents: 1000, currency: "usd", status });
});

it("exposes only the owned existing intent's action secret and rechecks ownership after Stripe", async () => {
  m.retrieve.mockResolvedValue({ ...intent, status: "requires_action" });
  await expect(getStripeTestPaymentRecovery("payer", "visit")).resolves.toEqual({ amountCents: 1000, currency: "usd", status: "requires_action", clientSecret: intent.client_secret });
  m.payment.mockResolvedValueOnce(payment).mockResolvedValueOnce({ ...payment, residentUserId: "someone-else" });
  await expect(getStripeTestPaymentRecovery("payer", "visit")).rejects.toMatchObject({ status: 404 });
});

it.each([
  { livemode: true }, { id: "pi_other" }, { amount: 1001 }, { currency: "eur" },
  { customer: "cus_other" }, { metadata: { bundleenVisitId: "other" } }, { payment_method: "pm_unbound" },
])("rejects mismatched remote payment identity %j", async change => {
  m.retrieve.mockResolvedValue({ ...intent, ...change });
  await expect(getStripeTestPaymentRecovery("payer", "visit")).rejects.toMatchObject({ status: 409 });
});

it("recognizes a replacement card only when an attempt for this visit binds it", async () => {
  m.attempts.mockResolvedValue([{ paymentMethodId: method.id }]);
  m.retrieve.mockResolvedValue({ ...intent, payment_method: method.id, status: "requires_action" });
  await expect(getStripeTestPaymentRecovery("payer", "visit")).resolves.toMatchObject({ status: "requires_action" });
  expect(m.attempts).toHaveBeenCalledWith({ where: { visitId: "visit" }, select: { paymentMethodId: true } });
});

it("starts off-session card setup scoped to the original customer, visit, terms and attempt", async () => {
  await expect(startStripeTestPaymentRecovery("payer", "visit", "attempt")).resolves.toEqual({ clientSecret: setup.client_secret });
  expect(m.createSetup).toHaveBeenCalledWith({ customer: "cus_owned", usage: "off_session", allowed_payment_method_types: ["card"], metadata: setup.metadata }, { idempotencyKey: "recover_card_visit_attempt" });
  expect(m.charge).not.toHaveBeenCalled();
});

it("allows a failed existing intent with its method cleared, but never an action secret with no bound method", async () => {
  m.retrieve.mockResolvedValue({ ...intent, payment_method: null });
  await expect(startStripeTestPaymentRecovery("payer", "visit", "attempt")).resolves.toEqual({ clientSecret: setup.client_secret });
  m.retrieve.mockResolvedValue({ ...intent, payment_method: null, status: "requires_action" });
  await expect(getStripeTestPaymentRecovery("payer", "visit")).rejects.toMatchObject({ status: 409 });
});

it.each(["succeeded", "processing", "requires_action", "canceled"])("cannot start replacement setup while payment is %s", async status => {
  m.retrieve.mockResolvedValue({ ...intent, status });
  await expect(startStripeTestPaymentRecovery("payer", "visit", "attempt")).rejects.toMatchObject({ status: 409 });
  expect(m.createSetup).not.toHaveBeenCalled();
});

it.each([
  { livemode: true }, { status: "requires_action" }, { customer: "cus_other" },
  { metadata: { ...setup.metadata, bundleenVisitId: "other" } },
  { metadata: { ...setup.metadata, bundleenRecoveryAttemptId: "other" } },
  { metadata: { ...setup.metadata, bundleenTermsToken: "new-terms" } },
  { payment_method: "pm_unexpanded" }, { payment_method: { ...method, livemode: true } },
  { payment_method: { ...method, customer: "cus_other" } }, { payment_method: { ...method, card: null } },
])("rejects an unverified or incorrectly bound replacement setup %j", async change => {
  m.retrieveSetup.mockResolvedValue({ ...setup, ...change });
  await expect(retryStripeTestPayment("payer", "visit", "attempt", "seti_owned")).rejects.toMatchObject({ status: 409 });
  expect(m.createAttempt).not.toHaveBeenCalled(); expect(m.charge).not.toHaveBeenCalled();
});

it("persists the verified recovery attempt before invoking existing-intent charging", async () => {
  await retryStripeTestPayment("payer", "visit", "attempt", "seti_owned");
  expect(m.createAttempt).toHaveBeenCalledWith({ data: { id: "attempt", visitId: "visit", customerId: "cus_owned", paymentMethodId: "pm_replacement", setupIntentId: "seti_owned", sequence: 1, termsVersion: "completed-visit-retry-v1" } });
  expect(m.createAttempt.mock.invocationCallOrder[0]).toBeLessThan(m.charge.mock.invocationCallOrder[0]);
  expect(m.charge).toHaveBeenCalledExactlyOnceWith("visit");
});

it("retries an identical persisted attempt without creating a second attempt", async () => {
  m.attempt.mockResolvedValue({ visitId: "visit", setupIntentId: "seti_owned", paymentMethodId: "pm_replacement" });
  await retryStripeTestPayment("payer", "visit", "attempt", "seti_owned");
  expect(m.createAttempt).not.toHaveBeenCalled(); expect(m.charge).toHaveBeenCalledExactlyOnceWith("visit");
});

it.each([{ visitId: "other" }, { setupIntentId: "seti_other" }, { paymentMethodId: "pm_other" }])("rejects reuse of a recovery attempt with changed identity %j", async change => {
  m.attempt.mockResolvedValue({ visitId: "visit", setupIntentId: "seti_owned", paymentMethodId: "pm_replacement", ...change });
  await expect(retryStripeTestPayment("payer", "visit", "attempt", "seti_owned")).rejects.toMatchObject({ status: 409 });
  expect(m.createAttempt).not.toHaveBeenCalled(); expect(m.charge).not.toHaveBeenCalled();
});

it("rejects changed owner under the payment lock", async () => {
  m.current.mockResolvedValue({ ...payment, residentUserId: "other" });
  await expect(retryStripeTestPayment("payer", "visit", "attempt", "seti_owned")).rejects.toMatchObject({ status: 404 });
  expect(m.createAttempt).not.toHaveBeenCalled(); expect(m.charge).not.toHaveBeenCalled();
});

it("rejects a payment that succeeded before the recovery attempt was saved", async () => {
  m.retrieve.mockResolvedValue({ ...intent, status: "succeeded" });
  await expect(retryStripeTestPayment("payer", "visit", "attempt", "seti_owned")).rejects.toMatchObject({ status: 409 });
  expect(m.createAttempt).not.toHaveBeenCalled(); expect(m.charge).not.toHaveBeenCalled();
});

it.each([{ feature: "0", key: "sk_test_fixture" }, { feature: "1", key: "sk_live_fixture" }])("fails closed before payment access for %j", async ({ feature, key }) => {
  vi.stubEnv("STRIPE_TEST_PAYMENTS", feature); vi.stubEnv("STRIPE_SECRET_KEY", key);
  await expect(getStripeTestPaymentRecovery("payer", "visit")).rejects.toMatchObject({ status: 503 });
  expect(m.payment).not.toHaveBeenCalled(); expect(m.retrieve).not.toHaveBeenCalled();
});
