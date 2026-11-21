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
// Independent adversarial delivery checks; the production reconciler is real.
it("rechecks processed state after acquiring payment locks", async () => {
  tx.stripeTestEvent.findUniqueOrThrow.mockResolvedValueOnce(m.event).mockResolvedValueOnce({ ...m.event, processedAt: new Date() });
  await reconcileStripeFinancialEvent("evt");
  expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
  expect(m.retrieveCharge).not.toHaveBeenCalled();
  expect(m.observations).toHaveLength(0);
});
it("an older dispute-created delivery uses current won state without clearing a prior hold", async () => {
  m.event.eventType = "charge.dispute.created"; m.event.objectId = "dp_owned";
  m.payment.reconciliationHoldReason = "processor_dispute";
  m.dispute = { id: "dp_owned", charge: "ch_owned", livemode: false, amount: 1000, currency: "usd", status: "won" };
  await reconcileStripeFinancialEvent("evt");
  expect(m.payment).toMatchObject({ observedDisputeStatus: "won", reconciliationHoldReason: "processor_dispute" });
  expect(m.createMoney).not.toHaveBeenCalled();
});
it("two differently aged deliveries observe current totals rather than replaying event deltas", async () => {
  m.charge.amount_refunded = 400;
  await reconcileStripeFinancialEvent("evt");
  m.event = { ...m.event, id: "evt_older", processedAt: null, occurredAt: new Date(0) };
  await reconcileStripeFinancialEvent("evt_older");
  expect(m.payment.observedChargeRefundedCents).toBe(400);
  expect(m.payment.amountRefundedCents).toBe(0);
  expect(m.observations.map(row => row.refundedCents)).toEqual([400, 400]);
  expect(m.createMoney).not.toHaveBeenCalled();
});
it("rejects reversal metadata pointing at a foreign visit before record-only mutation", async () => {
  m.payment.stripeTransferId = "tr_owned";
  m.transfer = { id: "tr_owned", livemode: false, amount: 900, amount_reversed: 100, currency: "usd", destination: "acct_owned", source_transaction: "ch_owned" };
  m.op = { id: "op", visitId: "foreign", transferId: "tr_owned" };
  m.reversalRows = [{ id: "trr_other", created: 1, metadata: { bundleenRefundId: "op" } }];
  await expect(reconcileStripeFinancialEvent("evt")).rejects.toThrow();
  expect(m.recordReversal).not.toHaveBeenCalled();
  expect(m.event.processedAt).toBeNull();
  expect(m.observations).toHaveLength(0);
});
