import { afterEach, beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ events: vi.fn(), mark: vi.fn(), payment: vi.fn(), pending: vi.fn(), profile: vi.fn(), charge: vi.fn(), refresh: vi.fn() }));
vi.mock("@/lib/server/db", () => ({ db: { stripeTestEvent: { findMany: m.events, updateMany: m.mark }, stripeTestPayment: { findUnique: m.payment, findMany: m.pending }, providerProfile: { findUnique: m.profile } } }));
vi.mock("@/lib/server/stripe-test-payments", () => ({ chargeStripeTestVisit: m.charge }));
vi.mock("@/lib/server/stripe-test-connect", () => ({ refreshStripeTestPayouts: m.refresh }));
import { reconcileStripeTestPayments } from "@/lib/server/stripe-test-reconciliation";
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv("STRIPE_TEST_PAYMENTS", "1"); vi.stubEnv("STRIPE_TEST_CONNECT", "1"); m.events.mockResolvedValue([]); m.pending.mockResolvedValue([]); m.mark.mockResolvedValue({ count: 1 }); });
afterEach(() => vi.unstubAllEnvs());
it("does no work when both test features are disabled", async () => {
  vi.stubEnv("STRIPE_TEST_PAYMENTS", "0"); vi.stubEnv("STRIPE_TEST_CONNECT", "0");
  expect(await reconcileStripeTestPayments()).toEqual({ processed: 0, refreshed: 0, failed: 0 }); expect(m.events).not.toHaveBeenCalled();
});
it("uses an owned payment reference and leaves failures retryable", async () => {
  m.events.mockResolvedValue([{ id: "evt_1", eventType: "payment_intent.succeeded", objectId: "pi_owned", accountId: null }]);
  m.payment.mockResolvedValue({ visitId: "visit" }); m.charge.mockRejectedValueOnce(new Error("timeout"));
  expect((await reconcileStripeTestPayments()).failed).toBe(1); expect(m.mark).not.toHaveBeenCalled();
  expect((await reconcileStripeTestPayments()).processed).toBe(1); expect(m.charge).toHaveBeenCalledWith("visit");
});
it("never creates a payment from an unrelated signed Stripe fixture", async () => {
  m.events.mockResolvedValue([{ id: "evt_1", eventType: "payment_intent.succeeded", objectId: "pi_unknown", accountId: null }]);
  m.payment.mockResolvedValue(null);
  expect((await reconcileStripeTestPayments()).processed).toBe(1); expect(m.charge).not.toHaveBeenCalled();
});
it("checks Connect envelope identity and refreshes only the owning provider", async () => {
  m.events.mockResolvedValue([{ id: "evt_1", eventType: "account.updated", objectId: "acct_owned", accountId: "acct_owned" }]);
  m.profile.mockResolvedValue({ userId: "provider" });
  await reconcileStripeTestPayments(); expect(m.refresh).toHaveBeenCalledWith("provider");
  m.events.mockResolvedValue([{ id: "evt_2", eventType: "account.updated", objectId: "acct_other", accountId: "acct_owned" }]);
  expect((await reconcileStripeTestPayments()).failed).toBe(1); expect(m.refresh).toHaveBeenCalledTimes(1);
});
it("recovers pending intent state without requiring another webhook", async () => {
  m.pending.mockResolvedValue([{ visitId: "visit" }]);
  expect((await reconcileStripeTestPayments(999)).refreshed).toBe(1);
  expect(m.pending).toHaveBeenCalledWith(expect.objectContaining({ take: 3 })); expect(m.charge).toHaveBeenCalledWith("visit");
});
