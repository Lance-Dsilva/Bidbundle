import { reconcileRecurringFinancialEvent } from "@/lib/server/recurring-financial-events";
import { notifyStripeTestPaymentProblem } from "@/lib/server/stripe-test-payment-notifications";
import "server-only";
import { FINANCIAL_EVENT_TYPES, reconcileStripeFinancialEvent } from "@/lib/server/stripe-financial-events";
import { db } from "@/lib/server/db";
import { chargeStripeTestVisit } from "@/lib/server/stripe-test-payments";
import { refreshStripeTestPayouts } from "@/lib/server/stripe-test-connect";

/** Authenticated job caller only. Inbox processing is retry-safe; event payloads are not trusted state. */
export async function reconcileStripeTestPayments(limit = 3) {
  const result = { processed: 0, refreshed: 0, failed: 0 };
  const payments = process.env.STRIPE_TEST_PAYMENTS === "1";
  const connect = process.env.STRIPE_TEST_CONNECT === "1";
  const financial = /^(sk|rk)_test_[A-Za-z0-9]+$/.test(process.env.STRIPE_SECRET_KEY ?? "");
  if (!payments && !connect && !financial) return result;
  const take = Math.min(3, Math.max(1, Math.floor(limit)));
  const types = [
    ...(financial ? FINANCIAL_EVENT_TYPES : []),
    ...(payments ? ["payment_intent.succeeded", "payment_intent.payment_failed", "payment_intent.requires_action"] : []),
    ...(connect ? ["account.updated"] : []),
  ];
  const events = await db.stripeTestEvent.findMany({ where: { processedAt: null, OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }], eventType: { in: types } }, orderBy: { receivedAt: "asc" }, take });
  for (const event of events) {
    try {
      if (await reconcileRecurringFinancialEvent(event.id)) { result.processed += 1; continue; }
      if (FINANCIAL_EVENT_TYPES.includes(event.eventType)) {
        await reconcileStripeFinancialEvent(event.id); result.processed += 1; continue;
      }
      if (event.eventType === "account.updated") {
        if (!event.accountId || event.accountId !== event.objectId) throw new Error("Invalid connected account reference");
        const profile = await db.providerProfile.findUnique({ where: { stripeTestAccountId: event.accountId }, select: { userId: true } });
        if (profile) await refreshStripeTestPayouts(profile.userId);
      } else {
        if (event.accountId) throw new Error("Unexpected connected payment event");
        const payment = await db.stripeTestPayment.findUnique({ where: { stripePaymentIntentId: event.objectId }, select: { visitId: true } });
        if (payment) { await chargeStripeTestVisit(payment.visitId); await notifyStripeTestPaymentProblem(payment.visitId); }
      }
      // Unowned sandbox fixtures are harmless; no arbitrary Stripe event can create a payment.
      const updated = await db.stripeTestEvent.updateMany({ where: { id: event.id, processedAt: null }, data: { processedAt: new Date() } });
      result.processed += updated.count;
    } catch {
      result.failed += 1;
      // A poison event must not permanently starve newer owned events.
      const delayMs = Math.min(60 * 60_000, 30_000 * 2 ** Math.min(event.attempts ?? 0, 7));
      await db.stripeTestEvent.updateMany({ where: { id: event.id, processedAt: null }, data: { attempts: { increment: 1 }, nextAttemptAt: new Date(Date.now() + delayMs) } });
    }
  }
  if (payments) {
    // Outbox delivery means the command was attempted, not that payment settled.
    // Recover asynchronous processing or a lost webhook from the persisted intent.
    const pending = await db.stripeTestPayment.findMany({ where: { status: { in: ["pending", "failed", "requires_action"] }, stripePaymentIntentId: { not: null } }, orderBy: { updatedAt: "asc" }, take, select: { visitId: true } });
    for (const row of pending) {
      try { await chargeStripeTestVisit(row.visitId); await notifyStripeTestPaymentProblem(row.visitId); result.refreshed += 1; }
      catch { result.failed += 1; }
    }
  }
  return result;
}
