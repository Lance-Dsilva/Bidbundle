import "server-only";
import { db } from "@/lib/server/db";
import { chargeStripeTestVisit } from "@/lib/server/stripe-test-payments";
import { refreshStripeTestPayouts } from "@/lib/server/stripe-test-connect";

/** Authenticated job caller only. Inbox processing is retry-safe; event payloads are not trusted state. */
export async function reconcileStripeTestPayments(limit = 3) {
  const result = { processed: 0, refreshed: 0, failed: 0 };
  const payments = process.env.STRIPE_TEST_PAYMENTS === "1";
  const connect = process.env.STRIPE_TEST_CONNECT === "1";
  if (!payments && !connect) return result;
  const take = Math.min(3, Math.max(1, Math.floor(limit)));
  const types = [
    ...(payments ? ["payment_intent.succeeded", "payment_intent.payment_failed", "payment_intent.requires_action"] : []),
    ...(connect ? ["account.updated"] : []),
  ];
  const events = await db.stripeTestEvent.findMany({ where: { processedAt: null, eventType: { in: types } }, orderBy: { receivedAt: "asc" }, take });
  for (const event of events) {
    try {
      if (event.eventType === "account.updated") {
        if (!event.accountId || event.accountId !== event.objectId) throw new Error("Invalid connected account reference");
        const profile = await db.providerProfile.findUnique({ where: { stripeTestAccountId: event.accountId }, select: { userId: true } });
        if (profile) await refreshStripeTestPayouts(profile.userId);
      } else {
        if (event.accountId) throw new Error("Unexpected connected payment event");
        const payment = await db.stripeTestPayment.findUnique({ where: { stripePaymentIntentId: event.objectId }, select: { visitId: true } });
        if (payment) await chargeStripeTestVisit(payment.visitId);
      }
      // Unowned sandbox fixtures are harmless; no arbitrary Stripe event can create a payment.
      const updated = await db.stripeTestEvent.updateMany({ where: { id: event.id, processedAt: null }, data: { processedAt: new Date() } });
      result.processed += updated.count;
    } catch { result.failed += 1; }
  }
  if (payments) {
    // Outbox delivery means the command was attempted, not that payment settled.
    // Recover asynchronous processing or a lost webhook from the persisted intent.
    const pending = await db.stripeTestPayment.findMany({ where: { status: "pending", stripePaymentIntentId: { not: null } }, orderBy: { updatedAt: "asc" }, take, select: { visitId: true } });
    for (const row of pending) {
      try { await chargeStripeTestVisit(row.visitId); result.refreshed += 1; }
      catch { result.failed += 1; }
    }
  }
  return result;
}
