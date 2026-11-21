import "server-only";
import Stripe from "stripe";
import type { Prisma, StripeTestPayment } from "@/generated/prisma/client";
import { db } from "@/lib/server/db";
import { HoaWorkflowError } from "@/lib/server/hoa";
import { notifyStripeTestPaymentProblem } from "@/lib/server/stripe-test-payment-notifications";
import { chargeStripeTestVisit } from "@/lib/server/stripe-test-payments";

function client() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (process.env.STRIPE_TEST_PAYMENTS !== "1" || !key || !/^(sk|rk)_test_[A-Za-z0-9]+$/.test(key)) throw new HoaWorkflowError("Sandbox payment recovery is unavailable.", 503);
  return new Stripe(key, { timeout: 8000, maxNetworkRetries: 0 });
}
async function ownedPayment(payerId: string, visitId: string) {
  const payment = await db.stripeTestPayment.findUnique({ where: { visitId } });
  // The original payer retains responsibility after moving out. A current unit
  // occupant gains no access to that payer's payment or client secret.
  if (!payment || payment.residentUserId !== payerId || !payment.stripePaymentIntentId) throw new HoaWorkflowError("Payment not found.", 404);
  if (payment.reconciliationHoldReason) throw new HoaWorkflowError("Payment requires financial reconciliation.", 409);
  return payment;
}
async function verifiedIntent(stripe: Stripe, payment: StripeTestPayment, reader: Pick<Prisma.TransactionClient, "stripeTestPaymentAttempt"> = db) {
  const intent = await stripe.paymentIntents.retrieve(payment.stripePaymentIntentId!);
  const methods = await reader.stripeTestPaymentAttempt.findMany({ where: { visitId: payment.visitId }, select: { paymentMethodId: true } });
  if (intent.livemode !== false || intent.id !== payment.stripePaymentIntentId || intent.amount !== payment.amountCents ||
      intent.currency !== payment.currency || (payment.receiptEmail && intent.receipt_email !== payment.receiptEmail) || intent.customer !== payment.customerId || intent.metadata.bundleenVisitId !== payment.visitId ||
      (intent.payment_method !== payment.paymentMethodId && !methods.some(row => row.paymentMethodId === intent.payment_method) && !(intent.payment_method === null && intent.status === "requires_payment_method"))) {
    throw new HoaWorkflowError("Payment requires billing review.", 409);
  }
  return intent;
}
export async function getStripeTestPaymentRecovery(payerId: string, visitId: string) {
  const stripe = client(); const payment = await ownedPayment(payerId, visitId);
  const intent = await verifiedIntent(stripe, payment);
  // Recheck owner/identity immediately before returning a secret, even though
  // immutable payment identity also prevents reassignment at the database layer.
  await ownedPayment(payerId, visitId);
  return { amountCents: payment.amountCents, currency: payment.currency, status: intent.status,
    ...(intent.status === "requires_action" && intent.client_secret ? { clientSecret: intent.client_secret } : {}) };
}
export async function startStripeTestPaymentRecovery(payerId: string, visitId: string, attemptId: string) {
  const stripe = client(); const payment = await ownedPayment(payerId, visitId);
  const intent = await verifiedIntent(stripe, payment);
  if (intent.status !== "requires_payment_method") throw new HoaWorkflowError("Refresh this payment before trying another card.", 409);
  const setup = await stripe.setupIntents.create({ customer: payment.customerId, usage: "off_session", allowed_payment_method_types: ["card"],
    metadata: { bundleenVisitId: visitId, bundleenRecoveryAttemptId: attemptId, bundleenTermsToken: payment.termsToken },
  }, { idempotencyKey: `recover_card_${visitId}_${attemptId}` });
  if (setup.livemode !== false || setup.customer !== payment.customerId || !setup.client_secret) throw new HoaWorkflowError("Sandbox card setup is unavailable.", 503);
  await ownedPayment(payerId, visitId);
  return { clientSecret: setup.client_secret };
}
export async function retryStripeTestPayment(payerId: string, visitId: string, attemptId: string, setupIntentId: string) {
  const stripe = client(); const payment = await ownedPayment(payerId, visitId);
  const setup = await stripe.setupIntents.retrieve(setupIntentId, { expand: ["payment_method"] });
  const method = setup.payment_method;
  if (setup.livemode !== false || setup.status !== "succeeded" || setup.customer !== payment.customerId ||
      setup.metadata?.bundleenVisitId !== visitId || setup.metadata.bundleenRecoveryAttemptId !== attemptId || setup.metadata.bundleenTermsToken !== payment.termsToken ||
      !method || typeof method === "string" || method.livemode !== false || method.customer !== payment.customerId || !method.card) {
    throw new HoaWorkflowError("No verified replacement card was found for this payment.", 409);
  }
  await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "ServiceVisit" WHERE "id" = ${visitId} FOR UPDATE`;
    await tx.$queryRaw`SELECT "visitId" FROM "StripeTestPayment" WHERE "visitId" = ${visitId} FOR UPDATE`;
    const current = await tx.stripeTestPayment.findUniqueOrThrow({ where: { visitId } });
    if (current.residentUserId !== payerId || current.stripePaymentIntentId !== payment.stripePaymentIntentId) throw new HoaWorkflowError("Payment not found.", 404);
    if (current.reconciliationHoldReason) throw new HoaWorkflowError("Payment requires financial reconciliation.", 409);
    const existing = await tx.stripeTestPaymentAttempt.findUnique({ where: { id: attemptId } });
    if (existing) {
      if (existing.visitId !== visitId || existing.setupIntentId !== setupIntentId || existing.paymentMethodId !== method.id) throw new HoaWorkflowError("Recovery attempt changed. Refresh and try again.", 409);
      return;
    }
    const intent = await verifiedIntent(stripe, current, tx);
    if (intent.status !== "requires_payment_method") throw new HoaWorkflowError("Payment state changed. Refresh before trying another card.", 409);
    const latest = await tx.stripeTestPaymentAttempt.findFirst({ where: { visitId }, orderBy: { sequence: "desc" }, select: { sequence: true } });
    await tx.stripeTestPaymentAttempt.create({ data: { id: attemptId, visitId, customerId: payment.customerId, paymentMethodId: method.id, setupIntentId,
      sequence: (latest?.sequence ?? 0) + 1, termsVersion: "completed-visit-retry-v1" } });
  }, { timeout: 15000 });
  // Attempt identity is committed before any charge confirmation. A network or
  // database failure can only retry this existing PaymentIntent, never create one.
  await chargeStripeTestVisit(visitId);
  await notifyStripeTestPaymentProblem(visitId);
  return getStripeTestPaymentRecovery(payerId, visitId);
}
