import { afterEach, beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ payment: vi.fn(), payer: vi.fn(), admins: vi.fn(), enqueue: vi.fn() }));
vi.mock("@/lib/server/db", () => ({ db: { stripeTestPayment: { findUnique: m.payment }, user: { findUnique: m.payer, findMany: m.admins } } }));
vi.mock("@/lib/server/notifications", () => ({ enqueueNotifications: m.enqueue }));
import { notifyStripeTestPaymentProblem } from "@/lib/server/stripe-test-payment-notifications";
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("STRIPE_TEST_PAYMENTS", "1");
  m.payment.mockResolvedValue({ status: "failed", residentUserId: "payer", lastRecoveryAttemptId: null, failureCode: "do_not_disclose", stripePaymentIntentId: "pi_secret_private" });
  m.payer.mockResolvedValue({ id: "payer", email: "payer@example.invalid" }); m.admins.mockResolvedValue([{ id: "admin", email: "admin@example.invalid" }]);
});
afterEach(() => vi.unstubAllEnvs());
it("targets original payer and active administrators with stable versioned dedupe and no processor details", async () => {
  await notifyStripeTestPaymentProblem("visit"); await notifyStripeTestPaymentProblem("visit");
  expect(m.admins).toHaveBeenCalledWith(expect.objectContaining({ where: { role: "admin", adminAccess: { status: "active" } } }));
  const rows = m.enqueue.mock.calls[0][0];
  expect(rows).toHaveLength(2); expect(rows[0]).toMatchObject({ userId: "payer", emailLinkOrigin: "stripe_test", linkPath: "/app/homeowner/billing/payments/visit" });
  expect(rows.map((row: { dedupeKey: string }) => row.dedupeKey)).toEqual(m.enqueue.mock.calls[1][0].map((row: { dedupeKey: string }) => row.dedupeKey));
  expect(JSON.stringify(rows)).not.toMatch(/do_not_disclose|pi_secret/);
});
it("new recovery outcome receives a new dedupe identity", async () => {
  await notifyStripeTestPaymentProblem("visit");
  m.payment.mockResolvedValue({ status: "requires_action", residentUserId: "payer", lastRecoveryAttemptId: "retry1" });
  await notifyStripeTestPaymentProblem("visit");
  expect(m.enqueue.mock.calls[0][0][0].dedupeKey).not.toBe(m.enqueue.mock.calls[1][0][0].dedupeKey);
});
it("does not queue for disabled or successful payments", async () => {
  vi.stubEnv("STRIPE_TEST_PAYMENTS", "0"); await notifyStripeTestPaymentProblem("visit"); expect(m.payment).not.toHaveBeenCalled();
  vi.stubEnv("STRIPE_TEST_PAYMENTS", "1"); m.payment.mockResolvedValue({ status: "succeeded" }); await notifyStripeTestPaymentProblem("visit"); expect(m.enqueue).not.toHaveBeenCalled();
});
