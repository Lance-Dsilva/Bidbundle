import { afterEach, beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ markAttempt: vi.fn(), payment: vi.fn(), update: vi.fn(), provider: vi.fn(), charge: vi.fn(), account: vi.fn(), transfer: vi.fn(), raw: vi.fn() }));
vi.mock("stripe", () => ({ default: class { charges = { retrieve: m.charge }; accounts = { retrieve: m.account }; transfers = { create: m.transfer }; } }));
vi.mock("@/lib/server/db", () => { const tx = { $queryRaw: m.raw, stripeTestPayment: { findUniqueOrThrow: m.payment, update: m.update, updateMany: m.markAttempt }, user: { findUnique: m.provider } }; return { db: { ...tx, $transaction: (fn: (t: typeof tx) => unknown) => fn(tx) } }; });
import { transferStripeTestPayment } from "@/lib/server/stripe-test-transfers";
const payment = { visitId: "visit", status: "succeeded", stripePaymentIntentId: "pi_fixture", stripeChargeId: "ch_fixture", stripeTransferId: null, amountCents: 1000, providerAmountCents: 900, currency: "usd", customerId: "cus_fixture", providerUserId: "provider", providerAccountId: "acct_fixture", requestId: "request" };
const charge = { livemode: false, paid: true, disputed: false, amount_refunded: 0, amount: 1000, amount_captured: 1000, currency: "usd", payment_intent: "pi_fixture", customer: "cus_fixture" };
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("STRIPE_TEST_TRANSFERS", "1"); vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_fixture");
  m.payment.mockResolvedValue({ ...payment, transferAttemptedAt: new Date() }); m.charge.mockResolvedValue(charge);
  m.provider.mockResolvedValue({ role: "provider", providerProfile: { accountStatus: "active", stripeTestAccountId: "acct_fixture" } });
  m.account.mockResolvedValue({ metadata: { bundleenProviderUserId: "provider" }, payouts_enabled: true, capabilities: { transfers: "active" } });
  m.transfer.mockResolvedValue({ id: "tr_fixture", livemode: false, amount: 900, currency: "usd", destination: "acct_fixture", source_transaction: "ch_fixture" });
});
afterEach(() => vi.unstubAllEnvs());
it("transfers exactly provider share against the successful source charge", async () => {
  await transferStripeTestPayment("visit");
  expect(m.transfer).toHaveBeenCalledWith({ amount: 900, currency: "usd", destination: "acct_fixture", source_transaction: "ch_fixture", transfer_group: "request_request", metadata: { bundleenVisitId: "visit" } }, { idempotencyKey: "transfer_visit_visit" });
  expect(m.markAttempt.mock.invocationCallOrder[0]).toBeLessThan(m.transfer.mock.invocationCallOrder[0]);
  expect(m.update).toHaveBeenCalledWith({ where: { visitId: "visit" }, data: { stripeTransferId: "tr_fixture" } });
});
it("never retries an uncertain transfer outside the idempotency retention window", async () => {
  m.payment.mockResolvedValue({ ...payment, transferAttemptedAt: new Date(Date.now() - 24 * 3600000) });
  await expect(transferStripeTestPayment("visit")).rejects.toMatchObject({ status: 409 }); expect(m.transfer).not.toHaveBeenCalled();
});
it("reuses the same transfer key after a network failure and skips persisted success", async () => {
  m.transfer.mockRejectedValueOnce(new Error("lost response"));
  await expect(transferStripeTestPayment("visit")).rejects.toThrow("lost response");
  await transferStripeTestPayment("visit");
  expect(m.transfer.mock.calls[0][1]).toEqual(m.transfer.mock.calls[1][1]);
  m.payment.mockResolvedValue({ ...payment, stripeTransferId: "tr_fixture" });
  await transferStripeTestPayment("visit"); expect(m.transfer).toHaveBeenCalledTimes(2);
});
it.each([{ amount_refunded: 1 }, { disputed: true }, { paid: false }, { customer: "cus_other" }, { livemode: true }])("rejects ineligible charge %j", async (delta) => {
  m.charge.mockResolvedValue({ ...charge, ...delta });
  await expect(transferStripeTestPayment("visit")).rejects.toMatchObject({ status: 409 }); expect(m.transfer).not.toHaveBeenCalled();
});
it("rejects an inactive or mismatched provider account", async () => {
  m.account.mockResolvedValue({ metadata: { bundleenProviderUserId: "other" }, payouts_enabled: true, capabilities: { transfers: "active" } });
  await expect(transferStripeTestPayment("visit")).rejects.toMatchObject({ status: 409 }); expect(m.transfer).not.toHaveBeenCalled();
});
it("rejects live credentials before mutations", async () => {
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_live_fixture");
  await expect(transferStripeTestPayment("visit")).rejects.toMatchObject({ status: 503 }); expect(m.markAttempt).not.toHaveBeenCalled();
});
