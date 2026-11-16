import "server-only";
import Stripe from "stripe";
import { db } from "@/lib/server/db";
import { HoaWorkflowError } from "@/lib/server/hoa";

/** Sandbox only; preserve a durable attempt timestamp before any transfer network call. */
export async function transferStripeTestPayment(visitId: string) {
  const key = process.env.STRIPE_SECRET_KEY;
  if (process.env.STRIPE_TEST_TRANSFERS !== "1" || !key || !/^(sk|rk)_test_[A-Za-z0-9]+$/.test(key)) throw new HoaWorkflowError("Sandbox transfers are unavailable.", 503);
  const stripe = new Stripe(key, { timeout: 8000, maxNetworkRetries: 0 });
  // This write intentionally commits before the network call; a timeout cannot erase the recovery window.
  await db.stripeTestPayment.updateMany({ where: { visitId, status: "succeeded", stripeTransferId: null, transferAttemptedAt: null }, data: { transferAttemptedAt: new Date() } });
  return db.$transaction(async (tx) => {
    // Match quality-claim intake lock order before future unresolved-claim checks.
    await tx.$queryRaw`SELECT "id" FROM "ServiceVisit" WHERE "id" = ${visitId} FOR UPDATE`;
    await tx.$queryRaw`SELECT "visitId" FROM "StripeTestPayment" WHERE "visitId" = ${visitId} FOR UPDATE`;
    const payment = await tx.stripeTestPayment.findUniqueOrThrow({ where: { visitId } });
    if (payment.stripeTransferId) return;
    if (payment.status !== "succeeded" || !payment.stripePaymentIntentId || !payment.stripeChargeId || !payment.transferAttemptedAt) throw new HoaWorkflowError("No paid sandbox visit is available for transfer.", 409);
    if (Date.now() - payment.transferAttemptedAt.getTime() > 23 * 60 * 60 * 1000) {
      // Stripe may prune idempotency keys after 24h. Never blindly recreate an uncertain transfer.
      throw new HoaWorkflowError("Transfer needs Stripe reconciliation before another attempt.", 409);
    }
    const charge = await stripe.charges.retrieve(payment.stripeChargeId);
    if (charge.livemode !== false || !charge.paid || charge.disputed || charge.amount_refunded !== 0 ||
        charge.amount !== payment.amountCents || charge.amount_captured !== payment.amountCents || charge.currency !== payment.currency ||
        charge.payment_intent !== payment.stripePaymentIntentId || charge.customer !== payment.customerId) throw new HoaWorkflowError("The charge is not eligible for transfer.", 409);
    await tx.$queryRaw`SELECT provider."id" FROM "User" provider JOIN "ProviderProfile" profile ON profile."userId" = provider."id"
      WHERE provider."id" = ${payment.providerUserId} FOR SHARE OF provider, profile`;
    const provider = await tx.user.findUnique({ where: { id: payment.providerUserId }, include: { providerProfile: true } });
    if (provider?.role !== "provider" || provider.providerProfile?.accountStatus !== "active" || provider.providerProfile.stripeTestAccountId !== payment.providerAccountId) throw new HoaWorkflowError("Provider payout eligibility changed.", 409);
    const account = await stripe.accounts.retrieve(payment.providerAccountId);
    if (account.metadata?.bundleenProviderUserId !== payment.providerUserId || !account.payouts_enabled || account.capabilities?.transfers !== "active") throw new HoaWorkflowError("Provider sandbox payouts are not active.", 409);
    const transfer = await stripe.transfers.create({
      amount: payment.providerAmountCents, currency: payment.currency, destination: payment.providerAccountId,
      source_transaction: payment.stripeChargeId, transfer_group: `request_${payment.requestId}`, metadata: { bundleenVisitId: visitId },
    }, { idempotencyKey: `transfer_visit_${visitId}` });
    if (transfer.livemode !== false || transfer.amount !== payment.providerAmountCents || transfer.currency !== payment.currency ||
        transfer.destination !== payment.providerAccountId || transfer.source_transaction !== payment.stripeChargeId) throw new HoaWorkflowError("Unexpected sandbox transfer response.", 409);
    await tx.stripeTestPayment.update({ where: { visitId }, data: { stripeTransferId: transfer.id } });
  }, { timeout: 30000 });
}
