import "server-only";
import Stripe from "stripe";
import { db } from "@/lib/server/db";
import { HoaWorkflowError } from "@/lib/server/hoa";
import { recordStripeTestRefundSnapshot, recordStripeTestReversalSnapshot } from "@/lib/server/stripe-test-refunds";

export const FINANCIAL_EVENT_TYPES = ["charge.refunded", "charge.dispute.created", "charge.dispute.updated", "charge.dispute.closed", "transfer.reversed", "setup_intent.succeeded"];
const idOf = (value: string | { id: string } | null) => typeof value === "string" ? value : value?.id ?? null;
const invalid = () => new HoaWorkflowError("Financial event identity requires review.", 409);
function client() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key || !/^(sk|rk)_test_[A-Za-z0-9]+$/.test(key)) throw new HoaWorkflowError("Sandbox reconciliation is unavailable.", 503);
  // Read-only reconciliation continues for persisted events even if money-movement flags are off.
  return new Stripe(key, { timeout: 8000, maxNetworkRetries: 0 });
}

/** Reads processor state only. Never creates a refund, reversal, payment or enrollment. */
export async function reconcileStripeFinancialEvent(eventId: string) {
  const event = await db.stripeTestEvent.findUniqueOrThrow({ where: { id: eventId } });
  if (event.processedAt) return;
  if (event.accountId || !FINANCIAL_EVENT_TYPES.includes(event.eventType)) throw invalid();
  const stripe = client();
  if (event.eventType === "setup_intent.succeeded") {
    const known = await db.stripeTestCard.findUnique({ where: { setupIntentId: event.objectId } }) ??
      await db.enrollmentBillingCard.findUnique({ where: { setupIntentId: event.objectId } }) ??
      await db.stripeTestPaymentAttempt.findFirst({ where: { setupIntentId: event.objectId } });
    if (known) {
      const setup = await stripe.setupIntents.retrieve(event.objectId);
      if (setup.id !== event.objectId || setup.livemode !== false || setup.status !== "succeeded" || idOf(setup.customer) !== known.customerId || idOf(setup.payment_method) !== known.paymentMethodId) throw invalid();
    }
    // An unbound setup cannot grant consent, save a card or join a household from metadata alone.
    await db.stripeTestEvent.updateMany({ where: { id: eventId, processedAt: null }, data: { processedAt: new Date() } });
    return;
  }
  let chargeId = event.objectId;
  let disputeId: string | null = null;
  if (event.eventType.startsWith("charge.dispute.")) {
    const dispute = await stripe.disputes.retrieve(event.objectId);
    if (dispute.id !== event.objectId || dispute.livemode !== false || !idOf(dispute.charge)) throw invalid();
    chargeId = idOf(dispute.charge)!; disputeId = dispute.id;
  } else if (event.eventType === "transfer.reversed") {
    const known = await db.stripeTestPayment.findUnique({ where: { stripeTransferId: event.objectId } });
    if (!known) { await db.stripeTestEvent.updateMany({ where: { id: eventId, processedAt: null }, data: { processedAt: new Date() } }); return; }
    chargeId = known.stripeChargeId ?? "";
  }
  let owner = await db.stripeTestPayment.findUnique({ where: { stripeChargeId: chargeId } });
  if (!owner) {
    // A financial webhook can beat the local write of latest_charge after a successful confirmation.
    // Match the already persisted intent, never arbitrary metadata, before recovering its charge identity.
    const candidate = await stripe.charges.retrieve(chargeId);
    const intentId = idOf(candidate.payment_intent);
    if (candidate.livemode === false && intentId) owner = await db.stripeTestPayment.findUnique({ where: { stripePaymentIntentId: intentId } });
  }
  if (!owner) { await db.stripeTestEvent.updateMany({ where: { id: eventId, processedAt: null }, data: { processedAt: new Date() } }); return; }
  await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "ServiceVisit" WHERE "id"=${owner.visitId} FOR UPDATE`;
    await tx.$queryRaw`SELECT "visitId" FROM "StripeTestPayment" WHERE "visitId"=${owner.visitId} FOR UPDATE`;
    const currentEvent = await tx.stripeTestEvent.findUniqueOrThrow({ where: { id: eventId } });
    if (currentEvent.processedAt) return;
    let payment = await tx.stripeTestPayment.findUniqueOrThrow({ where: { visitId: owner.visitId } });
    const charge = await stripe.charges.retrieve(chargeId);
    if ((payment.stripeChargeId && charge.id !== payment.stripeChargeId) || charge.id !== chargeId || charge.livemode !== false || !charge.paid || charge.amount !== payment.amountCents || charge.amount_captured !== payment.amountCents ||
        charge.currency !== payment.currency || idOf(charge.customer) !== payment.customerId || idOf(charge.payment_intent) !== payment.stripePaymentIntentId ||
        !Number.isSafeInteger(charge.amount_refunded) || charge.amount_refunded < 0 || charge.amount_refunded > payment.amountCents) throw invalid();
    if (!payment.stripeChargeId) payment = await tx.stripeTestPayment.update({ where: { visitId: payment.visitId }, data: { stripeChargeId: charge.id } });
    let hold = payment.reconciliationHoldReason;
    let observedDisputeId = disputeId ?? payment.observedDisputeId;
    let observedDisputeStatus = payment.observedDisputeStatus;
    if (observedDisputeId) {
      const dispute = await stripe.disputes.retrieve(observedDisputeId);
      if (dispute.id !== observedDisputeId || dispute.livemode !== false || idOf(dispute.charge) !== charge.id || dispute.currency !== payment.currency || dispute.amount <= 0 || dispute.amount > payment.amountCents) throw invalid();
      observedDisputeStatus = dispute.status;
      if (!["won", "warning_closed"].includes(dispute.status)) hold = "processor_dispute";
    }
    if (charge.disputed && !observedDisputeId) hold = "processor_dispute";
    const refunds = await stripe.refunds.list({ charge: charge.id, limit: 100 });
    if (refunds.has_more) hold ??= "incomplete_processor_history";
    for (const refund of [...refunds.data].sort((a, b) => a.created - b.created)) {
      const opId = refund.metadata?.bundleenRefundId;
      const op = opId ? await tx.stripeTestRefund.findUnique({ where: { id: opId } }) : null;
      if (!op) { if (!["failed", "canceled"].includes(refund.status ?? "")) hold ??= "external_refund"; continue; }
      if (op.visitId !== payment.visitId || op.chargeId !== charge.id || (op.stripeRefundId && op.stripeRefundId !== refund.id)) throw invalid();
      await recordStripeTestRefundSnapshot(tx, op, refund);
    }
    let reversed = 0;
    if (payment.stripeTransferId) {
      const transfer = await stripe.transfers.retrieve(payment.stripeTransferId);
      if (transfer.id !== payment.stripeTransferId || transfer.livemode !== false || transfer.amount !== payment.providerAmountCents || transfer.currency !== payment.currency ||
          idOf(transfer.destination) !== payment.providerAccountId || idOf(transfer.source_transaction) !== charge.id ||
          !Number.isSafeInteger(transfer.amount_reversed) || transfer.amount_reversed < 0 || transfer.amount_reversed > payment.providerAmountCents) throw invalid();
      reversed = transfer.amount_reversed;
      const reversals = await stripe.transfers.listReversals(transfer.id, { limit: 100 });
      if (reversals.has_more) hold ??= "incomplete_processor_history";
      for (const reversal of [...reversals.data].sort((a, b) => a.created - b.created)) {
        const opId = reversal.metadata?.bundleenRefundId;
        const op = opId ? await tx.stripeTestRefund.findUnique({ where: { id: opId } }) : null;
        if (!op) { hold ??= "external_transfer_reversal"; continue; }
        if (op.visitId !== payment.visitId || op.transferId !== transfer.id || (op.stripeReversalId && op.stripeReversalId !== reversal.id)) throw invalid();
        await recordStripeTestReversalSnapshot(tx, op, reversal);
      }
    }
    payment = await tx.stripeTestPayment.findUniqueOrThrow({ where: { visitId: owner.visitId } });
    if (charge.amount_refunded !== payment.amountRefundedCents) hold ??= "unreconciled_refund_balance";
    if (reversed !== payment.providerReversedCents) hold ??= "unreconciled_transfer_balance";
    const status = hold === "processor_dispute" ? "disputed" : charge.amount_refunded === payment.amountCents ? "refunded" : charge.amount_refunded > 0 ? "partially_refunded" : payment.status;
    await tx.stripeTestPayment.update({ where: { visitId: payment.visitId }, data: { reconciliationHoldReason: hold,
      observedChargeRefundedCents: charge.amount_refunded, observedProviderReversedCents: reversed, observedDisputeId, observedDisputeStatus, status } });
    await tx.stripeTestFinancialObservation.create({ data: { eventId, visitId: payment.visitId, refundedCents: charge.amount_refunded,
      reversedCents: reversed, disputeId: observedDisputeId, disputeStatus: observedDisputeStatus, holdReason: hold } });
    await tx.stripeTestEvent.update({ where: { id: eventId }, data: { processedAt: new Date() } });
  }, { timeout: 60000 });
}
