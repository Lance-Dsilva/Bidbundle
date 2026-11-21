import "server-only";
import Stripe from "stripe";
import type { Prisma, StripeTestPayment, StripeTestRefund } from "@/generated/prisma/client";
import { db } from "@/lib/server/db";
import { HoaWorkflowError } from "@/lib/server/hoa";
import { incrementalProviderReversal } from "@/lib/stripe-refund-amounts";

const WINDOW_MS = 23 * 60 * 60 * 1000;
function client() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (process.env.STRIPE_TEST_REFUNDS !== "1" || !key || !/^(sk|rk)_test_[A-Za-z0-9]+$/.test(key)) throw new HoaWorkflowError("Sandbox refunds are unavailable.", 503);
  return new Stripe(key, { timeout: 8000, maxNetworkRetries: 0 });
}
async function owner(tx: Prisma.TransactionClient, actorId: string) {
  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id"=${actorId} FOR SHARE`;
  await tx.$queryRaw`SELECT "userId" FROM "AdminAccessGrant" WHERE "userId"=${actorId} FOR SHARE`;
  const user = await tx.user.findUnique({ where: { id: actorId }, include: { adminAccess: true } });
  if (user?.role !== "admin" || !user.isVerified || user.adminAccess?.status !== "active" || user.adminAccess.level !== "owner" ||
      user.adminAccess.isStaffAccount || user.adminAccess.email !== user.email.toLowerCase()) throw new HoaWorkflowError("Primary administrator access is required for refunds.", 403);
}
async function lockPayment(tx: Prisma.TransactionClient, visitId: string) {
  await tx.$queryRaw`SELECT "id" FROM "ServiceVisit" WHERE "id"=${visitId} FOR UPDATE`;
  await tx.$queryRaw`SELECT "visitId" FROM "StripeTestPayment" WHERE "visitId"=${visitId} FOR UPDATE`;
}
function audit(tx: Prisma.TransactionClient, payment: StripeTestPayment, operation: StripeTestRefund, outcome: string, actorUserId: string | null) {
  return tx.adminAuditLog.create({ data: { actorUserId, action: "marketplace_recovery_action", targetType: "service_visit", targetId: payment.visitId,
    communityId: payment.communityId, providerUserId: payment.providerUserId,
    metadata: { operation: "stripe_test_refund", refundOperationId: operation.id, outcome, amountCents: operation.amountCents, reversalCents: operation.reversalCents, reason: operation.reason } } });
}

/** Reserve once under the paid-balance lock. Nothing is sent to Stripe here. */
export async function requestStripeTestRefund(actorId: string, visitId: string, input: { id: string; amountCents: number; reason: "service_quality" | "duplicate" | "requested_by_customer" }) {
  client();
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents < 1) throw new HoaWorkflowError("Enter a positive refund amount in cents.", 400);
  return db.$transaction(async tx => {
    await lockPayment(tx, visitId);
    await owner(tx, actorId);
    const existing = await tx.stripeTestRefund.findUnique({ where: { id: input.id } });
    if (existing) {
      if (existing.visitId !== visitId || existing.actorUserId !== actorId || existing.amountCents !== input.amountCents || existing.reason !== input.reason) throw new HoaWorkflowError("Refund request identity changed.", 409);
      return existing;
    }
    const payment = await tx.stripeTestPayment.findUnique({ where: { visitId } });
    if (!payment || !["succeeded", "partially_refunded"].includes(payment.status) || !payment.stripeChargeId || !payment.stripePaymentIntentId) throw new HoaWorkflowError("A paid visit is required for a refund.", 409);
    if (payment.transferAttemptedAt && !payment.stripeTransferId) throw new HoaWorkflowError("Reconcile the pending provider transfer before refunding.", 409);
    if (await tx.stripeTestRefund.findFirst({ where: { visitId, state: { notIn: ["succeeded", "failed"] } } })) throw new HoaWorkflowError("Finish the existing refund before requesting another.", 409);
    if (input.amountCents > payment.amountCents - payment.amountRefundedCents) throw new HoaWorkflowError("Refund exceeds the remaining paid amount.", 409);
    const operation = await tx.stripeTestRefund.create({ data: { id: input.id, visitId, actorUserId: actorId, reason: input.reason,
      amountCents: input.amountCents, refundedBeforeCents: payment.amountRefundedCents, cumulativeRefundCents: payment.amountRefundedCents + input.amountCents,
      reversedBeforeCents: payment.providerReversedCents,
      reversalCents: payment.stripeTransferId ? incrementalProviderReversal(payment.amountCents, payment.providerAmountCents, payment.amountRefundedCents, input.amountCents) : 0,
      chargeId: payment.stripeChargeId, transferId: payment.stripeTransferId } });
    await audit(tx, payment, operation, "requested", actorId);
    return operation;
  });
}

export async function retryStripeTestRefund(actorId: string, visitId: string, id: string) {
  client();
  await db.$transaction(async tx => {
    await lockPayment(tx, visitId);
    await owner(tx, actorId);
    const operation = await tx.stripeTestRefund.findUnique({ where: { id } });
    if (!operation || operation.visitId !== visitId) throw new HoaWorkflowError("Refund not found.", 404);
  });
  return processStripeTestRefund(id);
}

const objectId = (value: string | { id: string } | null) => typeof value === "string" ? value : value?.id ?? null;
function assertRefund(refund: Stripe.Refund, op: StripeTestRefund, payment: StripeTestPayment) {
  // Refunds have no livemode field; the test-only client and verified source charge establish mode.
  if (refund.amount !== op.amountCents || refund.currency !== payment.currency || objectId(refund.charge) !== op.chargeId ||
      objectId(refund.payment_intent) !== payment.stripePaymentIntentId || refund.metadata?.bundleenRefundId !== op.id) throw new HoaWorkflowError("Refund identity needs reconciliation.", 409);
}
function assertReversal(reversal: Stripe.TransferReversal, op: StripeTestRefund, payment: StripeTestPayment) {
  if (reversal.amount !== op.reversalCents || reversal.currency !== payment.currency || objectId(reversal.transfer) !== op.transferId ||
      reversal.metadata?.bundleenRefundId !== op.id) throw new HoaWorkflowError("Transfer reversal identity needs reconciliation.", 409);
}
async function recordRefund(op: StripeTestRefund, refund: Stripe.Refund) {
  await db.$transaction(async tx => {
    await lockPayment(tx, op.visitId);
    const current = await tx.stripeTestRefund.findUniqueOrThrow({ where: { id: op.id } });
    if (["succeeded", "failed"].includes(current.state)) return;
    if (current.state === "reversal_pending" && refund.status !== "succeeded") return;
    const payment = await tx.stripeTestPayment.findUniqueOrThrow({ where: { visitId: op.visitId } });
    assertRefund(refund, current, payment);
    if (refund.status === "succeeded") {
      if (![current.refundedBeforeCents, current.cumulativeRefundCents].includes(payment.amountRefundedCents)) throw new HoaWorkflowError("Refund balance needs reconciliation.", 409);
      await tx.stripeTestPayment.update({ where: { visitId: op.visitId }, data: { amountRefundedCents: current.cumulativeRefundCents,
        refundedAt: new Date(), status: current.cumulativeRefundCents === payment.amountCents ? "refunded" : "partially_refunded" } });
      const state = current.reversalCents > 0 ? "reversal_pending" : "succeeded";
      await tx.stripeTestRefund.update({ where: { id: op.id }, data: { stripeRefundId: refund.id, state, failureCode: null } });
      if (current.state !== "reversal_pending") await audit(tx, payment, current, state === "succeeded" ? "completed" : "refunded_reversal_pending", null);
    } else {
      const failed = ["failed", "canceled"].includes(refund.status ?? "");
      await tx.stripeTestRefund.update({ where: { id: op.id }, data: { stripeRefundId: refund.id, state: failed ? "failed" : "refund_pending", failureCode: failed ? "processor_refund_failed" : null } });
      if (failed) await audit(tx, payment, current, "failed", null);
    }
  });
}

/** Each remote mutation has its own durable identity, clock and recovery path. */
export async function processStripeTestRefund(id: string) {
  const stripe = client();
  let op = await db.stripeTestRefund.findUniqueOrThrow({ where: { id } });
  if (["succeeded", "failed"].includes(op.state)) return op;
  const payment = await db.stripeTestPayment.findUniqueOrThrow({ where: { visitId: op.visitId } });
  const charge = await stripe.charges.retrieve(op.chargeId);
  if (charge.livemode !== false || !charge.paid || charge.disputed || charge.amount !== payment.amountCents || charge.amount_captured !== payment.amountCents ||
      charge.currency !== payment.currency || objectId(charge.customer) !== payment.customerId || objectId(charge.payment_intent) !== payment.stripePaymentIntentId) throw new HoaWorkflowError("Source charge needs reconciliation.", 409);

  let refund: Stripe.Refund | undefined;
  if (op.stripeRefundId) refund = await stripe.refunds.retrieve(op.stripeRefundId);
  else {
    // Recover an acknowledged-to-Stripe but not-yet-recorded operation before any retry.
    const list = await stripe.refunds.list({ charge: op.chargeId, limit: 100 });
    const matches = list.data.filter(row => row.metadata?.bundleenRefundId === id);
    if (matches.length > 1) throw new HoaWorkflowError("Multiple refund operations need reconciliation.", 409);
    refund = matches[0];
    if (!refund) {
      const recorded = await db.stripeTestRefund.findMany({ where: { visitId: op.visitId, stripeRefundId: { not: null } }, select: { stripeRefundId: true } });
      if (list.data.some(row => !["failed", "canceled"].includes(row.status ?? "") && !recorded.some(known => known.stripeRefundId === row.id))) throw new HoaWorkflowError("An unrecorded refund needs reconciliation.", 409);
      if (list.has_more || charge.amount_refunded !== op.refundedBeforeCents) throw new HoaWorkflowError("External refunds need reconciliation before retrying.", 409);
      if (op.refundAttemptedAt && Date.now() - op.refundAttemptedAt.getTime() > WINDOW_MS) throw new HoaWorkflowError("Uncertain refund needs reconciliation before another attempt.", 409);
      await db.stripeTestRefund.updateMany({ where: { id, refundAttemptedAt: null }, data: { refundAttemptedAt: new Date() } });
      const attempted = await db.stripeTestRefund.findUniqueOrThrow({ where: { id } });
      if (!attempted.refundAttemptedAt || Date.now() - attempted.refundAttemptedAt.getTime() > WINDOW_MS) throw new HoaWorkflowError("Refund attempt needs reconciliation.", 409);
      refund = await stripe.refunds.create({ charge: op.chargeId, amount: op.amountCents,
        reason: op.reason === "duplicate" ? "duplicate" : "requested_by_customer", metadata: { bundleenRefundId: id, bundleenVisitId: op.visitId } }, { idempotencyKey: `refund_${id}` });
    }
  }
  assertRefund(refund, op, payment);
  await recordRefund(op, refund);
  op = await db.stripeTestRefund.findUniqueOrThrow({ where: { id } });
  if (op.state !== "reversal_pending" || !op.transferId) return op;

  const transfer = await stripe.transfers.retrieve(op.transferId);
  if (transfer.livemode !== false || transfer.amount !== payment.providerAmountCents || transfer.currency !== payment.currency ||
      objectId(transfer.destination) !== payment.providerAccountId || objectId(transfer.source_transaction) !== op.chargeId) throw new HoaWorkflowError("Provider transfer needs reconciliation.", 409);
  let reversal: Stripe.TransferReversal | undefined;
  if (op.stripeReversalId) reversal = await stripe.transfers.retrieveReversal(op.transferId, op.stripeReversalId);
  else {
    const list = await stripe.transfers.listReversals(op.transferId, { limit: 100 });
    const matches = list.data.filter(row => row.metadata?.bundleenRefundId === id);
    if (matches.length > 1) throw new HoaWorkflowError("Multiple reversal operations need reconciliation.", 409);
    reversal = matches[0];
    if (!reversal) {
      if (list.has_more || transfer.amount_reversed !== op.reversedBeforeCents) throw new HoaWorkflowError("External transfer reversals need reconciliation.", 409);
      if (op.reversalAttemptedAt && Date.now() - op.reversalAttemptedAt.getTime() > WINDOW_MS) throw new HoaWorkflowError("Uncertain reversal needs reconciliation before another attempt.", 409);
      await db.stripeTestRefund.updateMany({ where: { id, reversalAttemptedAt: null }, data: { reversalAttemptedAt: new Date() } });
      const attempted = await db.stripeTestRefund.findUniqueOrThrow({ where: { id } });
      if (!attempted.reversalAttemptedAt || Date.now() - attempted.reversalAttemptedAt.getTime() > WINDOW_MS) throw new HoaWorkflowError("Reversal attempt needs reconciliation.", 409);
      reversal = await stripe.transfers.createReversal(op.transferId, { amount: op.reversalCents, metadata: { bundleenRefundId: id } }, { idempotencyKey: `reverse_refund_${id}` });
    }
  }
  assertReversal(reversal, op, payment);
  const reversalId = reversal.id;
  await db.$transaction(async tx => {
    await lockPayment(tx, op.visitId);
    const current = await tx.stripeTestRefund.findUniqueOrThrow({ where: { id } });
    if (current.state === "succeeded") return;
    const paid = await tx.stripeTestPayment.findUniqueOrThrow({ where: { visitId: op.visitId } });
    if (current.state !== "reversal_pending" || paid.providerReversedCents !== current.reversedBeforeCents) throw new HoaWorkflowError("Provider reversal balance needs reconciliation.", 409);
    await tx.stripeTestPayment.update({ where: { visitId: op.visitId }, data: { providerReversedCents: current.reversedBeforeCents + current.reversalCents } });
    await tx.stripeTestRefund.update({ where: { id }, data: { stripeReversalId: reversalId, state: "succeeded", failureCode: null } });
    await audit(tx, paid, current, "completed", null);
  });
  return db.stripeTestRefund.findUniqueOrThrow({ where: { id } });
}

export async function reconcileStripeTestRefunds() {
  if (process.env.STRIPE_TEST_REFUNDS !== "1") return;
  const rows = await db.stripeTestRefund.findMany({ where: { state: { notIn: ["succeeded", "failed"] } }, orderBy: { updatedAt: "asc" }, take: 3 });
  for (const row of rows) {
    try { await processStripeTestRefund(row.id); }
    catch { await db.stripeTestRefund.updateMany({ where: { id: row.id, state: { notIn: ["succeeded", "failed"] } }, data: { failureCode: "retry_or_reconciliation_required", updatedAt: new Date() } }); }
  }
}
