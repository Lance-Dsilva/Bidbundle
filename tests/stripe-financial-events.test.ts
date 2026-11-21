import { afterEach, beforeEach, expect, it, vi } from "vitest";
afterEach(() => vi.unstubAllEnvs());
const m = vi.hoisted(() => ({ event: {} as Record<string, any>, payment: {} as Record<string, any>, charge: {} as Record<string, any>,
  refundRows: [] as any[], reversalRows: [] as any[], op: null as any, dispute: null as any, transfer: null as any,
  observations: [] as any[], processed: vi.fn(), recordRefund: vi.fn(), recordReversal: vi.fn(), retrieveCharge: vi.fn(), retrieveDispute: vi.fn(), retrieveTransfer: vi.fn(), setup: vi.fn(), createMoney: vi.fn(), more: false, knownCard: null as any }));
const tx = vi.hoisted(() => ({ $queryRaw: vi.fn(), stripeTestEvent: { findUniqueOrThrow: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  stripeTestPayment: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn() }, stripeTestRefund: { findUnique: vi.fn() },
  stripeTestFinancialObservation: { create: vi.fn() }, stripeTestCard: { findUnique: vi.fn() }, enrollmentBillingCard: { findUnique: vi.fn() }, stripeTestPaymentAttempt: { findFirst: vi.fn() } }));
vi.mock("@/lib/server/db", () => ({ db: { ...tx, $transaction: async (fn: (client: typeof tx) => Promise<unknown>) => {
  const old = structuredClone({ event: m.event, payment: m.payment, observations: m.observations });
  try { return await fn(tx); } catch (error) { m.event = old.event; m.payment = old.payment; m.observations = old.observations; throw error; }
} } }));
vi.mock("@/lib/server/stripe-test-refunds", () => ({ recordStripeTestRefundSnapshot: m.recordRefund, recordStripeTestReversalSnapshot: m.recordReversal }));
vi.mock("stripe", () => ({ default: class { charges = { retrieve: m.retrieveCharge }; disputes = { retrieve: m.retrieveDispute }; refunds = { list: async () => ({ data: m.refundRows, has_more: m.more }), create: m.createMoney }; transfers = { retrieve: m.retrieveTransfer, listReversals: async () => ({ data: m.reversalRows, has_more: m.more }), create: m.createMoney, createReversal: m.createMoney }; setupIntents = { retrieve: m.setup }; } }));
import { reconcileStripeFinancialEvent } from "@/lib/server/stripe-financial-events";
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_fixture"); vi.stubEnv("STRIPE_TEST_PAYMENTS", "0"); vi.stubEnv("STRIPE_TEST_REFUNDS", "0");
  m.event = { id: "evt", objectId: "ch_owned", eventType: "charge.refunded", accountId: null, processedAt: null };
  m.payment = { visitId: "visit", stripeChargeId: "ch_owned", stripePaymentIntentId: "pi_owned", customerId: "cus_owned", providerAccountId: "acct_owned", amountCents: 1000, providerAmountCents: 900, currency: "usd", amountRefundedCents: 0, providerReversedCents: 0, stripeTransferId: null, status: "succeeded", reconciliationHoldReason: null, observedDisputeId: null, observedDisputeStatus: null };
  m.charge = { id: "ch_owned", livemode: false, paid: true, disputed: false, amount: 1000, amount_captured: 1000, amount_refunded: 0, currency: "usd", customer: "cus_owned", payment_intent: "pi_owned" };
  m.refundRows = []; m.reversalRows = []; m.observations = []; m.op = null; m.more = false; m.knownCard = null;
  tx.stripeTestEvent.findUniqueOrThrow.mockImplementation(async () => m.event);
  tx.stripeTestEvent.update.mockImplementation(async ({ data }) => Object.assign(m.event, data));
  tx.stripeTestEvent.updateMany.mockImplementation(async ({ data }) => { Object.assign(m.event, data); return { count: 1 }; });
  tx.stripeTestPayment.findUnique.mockImplementation(async ({ where }) => where.stripeChargeId === m.payment.stripeChargeId || where.stripeTransferId === m.payment.stripeTransferId ? m.payment : null);
  tx.stripeTestPayment.findUniqueOrThrow.mockImplementation(async () => m.payment);
  tx.stripeTestPayment.update.mockImplementation(async ({ data }) => Object.assign(m.payment, data));
  tx.stripeTestRefund.findUnique.mockImplementation(async () => m.op);
  tx.stripeTestFinancialObservation.create.mockImplementation(async ({ data }) => { m.observations.push(data); return data; });
  tx.stripeTestCard.findUnique.mockImplementation(async () => m.knownCard);
  m.retrieveCharge.mockImplementation(async () => m.charge); m.retrieveDispute.mockImplementation(async () => m.dispute); m.retrieveTransfer.mockImplementation(async () => m.transfer);
});
it("holds external refunds even when money features are disabled and preserves owned ledger counters", async () => {
  m.charge.amount_refunded = 300; m.refundRows = [{ id: "re_external", amount: 300, status: "succeeded", created: 1, metadata: {} }];
  await reconcileStripeFinancialEvent("evt"); expect(m.payment).toMatchObject({ amountRefundedCents: 0, observedChargeRefundedCents: 300, reconciliationHoldReason: "external_refund", status: "partially_refunded" });
  expect(m.observations).toHaveLength(1); expect(m.event.processedAt).toBeTruthy(); expect(m.createMoney).not.toHaveBeenCalled();
  await reconcileStripeFinancialEvent("evt"); expect(m.observations).toHaveLength(1); expect(m.retrieveCharge).toHaveBeenCalledTimes(1);
});
it("records an owned remote success through record-only helpers without issuing money operations", async () => {
  m.op = { id: "op", visitId: "visit", chargeId: "ch_owned", stripeRefundId: null }; m.charge.amount_refunded = 400;
  m.refundRows = [{ id: "re_owned", status: "succeeded", created: 1, metadata: { bundleenRefundId: "op" } }];
  m.recordRefund.mockImplementation(async () => { m.payment.amountRefundedCents = 400; });
  await reconcileStripeFinancialEvent("evt"); expect(m.recordRefund).toHaveBeenCalledWith(tx, m.op, m.refundRows[0]); expect(m.payment.reconciliationHoldReason).toBeNull(); expect(m.createMoney).not.toHaveBeenCalled();
});
it("rejects foreign operation metadata and leaves inbox retryable atomically", async () => {
  m.op = { id: "op", visitId: "other", chargeId: "ch_owned" }; m.refundRows = [{ id: "re", created: 1, metadata: { bundleenRefundId: "op" } }];
  await expect(reconcileStripeFinancialEvent("evt")).rejects.toThrow(); expect(m.event.processedAt).toBeNull(); expect(m.observations).toHaveLength(0);
});
it.each([{ livemode: true }, { customer: "cus_other" }, { payment_intent: "pi_other" }, { amount_captured: 900 }, { currency: "eur" }])("rejects mismatched fresh charge %j", async change => {
  Object.assign(m.charge, change); await expect(reconcileStripeFinancialEvent("evt")).rejects.toThrow(); expect(m.event.processedAt).toBeNull();
});
it("holds disputes using fresh processor state, not stale event type", async () => {
  m.event.eventType = "charge.dispute.closed"; m.event.objectId = "dp_owned";
  m.dispute = { id: "dp_owned", charge: "ch_owned", livemode: false, amount: 1000, currency: "usd", status: "lost" };
  await reconcileStripeFinancialEvent("evt"); expect(m.payment).toMatchObject({ reconciliationHoldReason: "processor_dispute", observedDisputeStatus: "lost", status: "disputed" });
});
it("holds an external provider reversal without fabricating local reversal accounting", async () => {
  m.payment.stripeTransferId = "tr_owned"; m.event.eventType = "transfer.reversed"; m.event.objectId = "tr_owned";
  m.transfer = { id: "tr_owned", livemode: false, amount: 900, amount_reversed: 100, currency: "usd", destination: "acct_owned", source_transaction: "ch_owned" };
  m.reversalRows = [{ id: "trr_external", created: 1, metadata: {} }];
  await reconcileStripeFinancialEvent("evt"); expect(m.payment).toMatchObject({ providerReversedCents: 0, observedProviderReversedCents: 100, reconciliationHoldReason: "external_transfer_reversal" }); expect(m.createMoney).not.toHaveBeenCalled();
});
it("holds incomplete processor history for explicit reconciliation", async () => { m.more = true; await reconcileStripeFinancialEvent("evt"); expect(m.payment.reconciliationHoldReason).toBe("incomplete_processor_history"); });
it("rolls back observation and payment state when inbox completion fails", async () => {
  m.charge.amount_refunded = 100; tx.stripeTestEvent.update.mockRejectedValue(new Error("database failure"));
  await expect(reconcileStripeFinancialEvent("evt")).rejects.toThrow(); expect(m.payment.reconciliationHoldReason).toBeNull(); expect(m.observations).toHaveLength(0); expect(m.event.processedAt).toBeNull();
});
it("does not create enrollment or card consent for an unbound SetupIntent event", async () => {
  m.event.eventType = "setup_intent.succeeded"; m.event.objectId = "seti_unbound"; await reconcileStripeFinancialEvent("evt");
  expect(m.setup).not.toHaveBeenCalled(); expect(tx.stripeTestPayment.update).not.toHaveBeenCalled(); expect(m.event.processedAt).toBeTruthy();
});
it("rejects a known setup customer mismatch without accepting the event", async () => {
  m.event.eventType = "setup_intent.succeeded"; m.event.objectId = "seti_known"; m.knownCard = { customerId: "cus_owned", paymentMethodId: "pm_owned" };
  m.setup.mockResolvedValue({ id: "seti_known", livemode: false, status: "succeeded", customer: "cus_other", payment_method: "pm_owned" });
  await expect(reconcileStripeFinancialEvent("evt")).rejects.toThrow(); expect(m.event.processedAt).toBeNull();
});
it("does not process connected-account money events as platform events", async () => { m.event.accountId = "acct_other"; await expect(reconcileStripeFinancialEvent("evt")).rejects.toThrow(); expect(m.retrieveCharge).not.toHaveBeenCalled(); });
it("recovers a charge webhook racing the local latest-charge write from the persisted intent", async () => {
  m.payment.stripeChargeId = null; m.charge.amount_refunded = 100;
  tx.stripeTestPayment.findUnique.mockImplementation(async ({ where }) => where.stripePaymentIntentId === "pi_owned" ? m.payment : null);
  await reconcileStripeFinancialEvent("evt"); expect(m.payment.stripeChargeId).toBe("ch_owned"); expect(m.payment.reconciliationHoldReason).toBe("unreconciled_refund_balance");
  expect(m.createMoney).not.toHaveBeenCalled();
});
