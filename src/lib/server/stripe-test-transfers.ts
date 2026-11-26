import "server-only";
import Stripe from "stripe";
import { db } from "@/lib/server/db";
import { HoaWorkflowError } from "@/lib/server/hoa";

/** Sandbox only; preserve a durable attempt timestamp before any transfer network call. */
export async function transferStripeTestPayment(visitId: string) {
  const key = process.env.STRIPE_SECRET_KEY;
  if (process.env.STRIPE_TEST_TRANSFERS !== "1" || !key || !/^(sk|rk)_test_[A-Za-z0-9]+$/.test(key)) throw new HoaWorkflowError("Sandbox transfers are unavailable.", 503);
  const stripe = new Stripe(key, { timeout: 8000, maxNetworkRetries: 0 });
  // Reserve only after eligibility checks. A second locked check closes the
  // claim-intake race between reservation commit and the external mutation.
  for (const reserveOnly of [true, false]) await db.$transaction(async (tx) => {
    // Match quality-claim intake lock order before future unresolved-claim checks.
    await tx.$queryRaw`SELECT "id" FROM "ServiceVisit" WHERE "id" = ${visitId} FOR UPDATE`;
    await tx.$queryRaw`SELECT "visitId" FROM "StripeTestPayment" WHERE "visitId" = ${visitId} FOR UPDATE`;
    const payment = await tx.stripeTestPayment.findUniqueOrThrow({ where: { visitId } });
    if (payment.stripeTransferId) return;
    if (payment.transferAttemptedAt) {
      // Recover an already-created transfer even if a later claim now blocks
      // new payouts. Discovery is read-only and never recreates an old key.
      const prior = await stripe.transfers.list({ transfer_group: `request_${payment.requestId}`, limit: 100 });
      if (prior.has_more) throw new HoaWorkflowError("Provider transfer history needs reconciliation.", 409);
      const matches = prior.data.filter(row => row.metadata?.bundleenVisitId === visitId);
      if (matches.length > 1) throw new HoaWorkflowError("Multiple provider transfers need reconciliation.", 409);
      const found = matches[0];
      if (found) {
        const objectId = (value: string | { id: string } | null) => typeof value === "string" ? value : value?.id ?? null;
        if (found.livemode !== false || found.amount !== (payment.transferAmountCents ?? payment.providerAmountCents) || found.currency !== payment.currency || objectId(found.destination) !== payment.providerAccountId || objectId(found.source_transaction) !== payment.stripeChargeId || found.amount_reversed !== payment.providerReversedCents) throw new HoaWorkflowError("Recovered transfer identity needs reconciliation.", 409);
        await tx.stripeTestPayment.update({ where: { visitId }, data: { stripeTransferId: found.id } });
        return;
      }
    }
    if (await tx.serviceQualityClaim.findFirst({ where: { visitId, resolution: { notIn: ["redo_complete", "refund_complete"] } } })) throw new HoaWorkflowError("An unresolved service quality claim blocks provider payout.", 409);
    // Added by financial webhook integration; fail closed without changing counters.
    if ((payment as typeof payment & { reconciliationHoldReason?: string | null }).reconciliationHoldReason) throw new HoaWorkflowError("Payment reconciliation is required before payout.", 409);
    if (await tx.stripeTestRefund.findFirst({ where: { visitId, state: { notIn: ["failed", "succeeded"] } } })) throw new HoaWorkflowError("A refund blocks the original provider transfer. Reconcile the remaining balance first.", 409);
    if (!["succeeded", "partially_refunded"].includes(payment.status) || !payment.stripePaymentIntentId || !payment.stripeChargeId) throw new HoaWorkflowError("No paid sandbox visit is available for transfer.", 409);
    if (payment.transferAttemptedAt && Date.now() - payment.transferAttemptedAt.getTime() > 23 * 60 * 60 * 1000) {
      // Stripe may prune idempotency keys after 24h. Never blindly recreate an uncertain transfer.
      throw new HoaWorkflowError("Transfer needs Stripe reconciliation before another attempt.", 409);
    }
    const refunded = payment.amountRefundedCents ?? 0;
    const providerAmount = payment.providerAmountCents - Number(BigInt(payment.providerAmountCents) * BigInt(refunded) / BigInt(payment.amountCents));
    if (providerAmount <= 0) throw new HoaWorkflowError("No provider balance remains to transfer.", 409);
    if (payment.transferAmountCents != null && (payment.transferAmountCents !== providerAmount || payment.transferRefundedBeforeCents !== refunded)) throw new HoaWorkflowError("Reserved transfer balance needs reconciliation.", 409);
    const charge = await stripe.charges.retrieve(payment.stripeChargeId);
    if (charge.livemode !== false || !charge.paid || charge.disputed || charge.amount_refunded !== (payment.amountRefundedCents ?? 0) ||
        charge.amount !== payment.amountCents || charge.amount_captured !== payment.amountCents || charge.currency !== payment.currency ||
        charge.payment_intent !== payment.stripePaymentIntentId || charge.customer !== payment.customerId) throw new HoaWorkflowError("The charge is not eligible for transfer.", 409);
    await tx.$queryRaw`SELECT provider."id" FROM "User" provider JOIN "ProviderProfile" profile ON profile."userId" = provider."id"
      WHERE provider."id" = ${payment.providerUserId} FOR SHARE OF provider, profile`;
    const provider = await tx.user.findUnique({ where: { id: payment.providerUserId }, include: { providerProfile: true } });
    if (provider?.role !== "provider" || provider.providerProfile?.accountStatus !== "active" || provider.providerProfile.stripeTestAccountId !== payment.providerAccountId) throw new HoaWorkflowError("Provider payout eligibility changed.", 409);
    const account = await stripe.accounts.retrieve(payment.providerAccountId);
    if (account.metadata?.bundleenProviderUserId !== payment.providerUserId || !account.payouts_enabled || account.capabilities?.transfers !== "active") throw new HoaWorkflowError("Provider sandbox payouts are not active.", 409);
    if (reserveOnly) {
      if (!payment.transferAttemptedAt) await tx.stripeTestPayment.update({ where: { visitId }, data: { transferAttemptedAt: new Date(), transferAmountCents: providerAmount, transferRefundedBeforeCents: refunded } });
      return;
    }
    if (!payment.transferAttemptedAt) throw new HoaWorkflowError("Missing durable transfer attempt.", 409);
    const transfer = await stripe.transfers.create({
      amount: providerAmount, currency: payment.currency, destination: payment.providerAccountId,
      source_transaction: payment.stripeChargeId, transfer_group: `request_${payment.requestId}`, metadata: { bundleenVisitId: visitId },
    }, { idempotencyKey: `transfer_visit_${visitId}` });
    if (transfer.livemode !== false || transfer.amount !== providerAmount || transfer.currency !== payment.currency ||
        transfer.destination !== payment.providerAccountId || transfer.source_transaction !== payment.stripeChargeId) throw new HoaWorkflowError("Unexpected sandbox transfer response.", 409);
    await tx.stripeTestPayment.update({ where: { visitId }, data: { stripeTransferId: transfer.id } });
  }, { timeout: 30000 });
}
