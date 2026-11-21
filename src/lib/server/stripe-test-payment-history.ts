import "server-only";
import Stripe from "stripe";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/server/db";
import { HoaWorkflowError } from "@/lib/server/hoa";

function enabled() {
  if (process.env.STRIPE_TEST_PAYMENTS !== "1") throw new HoaWorkflowError("Sandbox payment history is unavailable.", 404);
}
const historySelect = {
  observedChargeRefundedCents: true, observedProviderReversedCents: true, reconciliationHoldReason: true,
  visitId: true, requestId: true, status: true, amountCents: true, amountRefundedCents: true,
  providerAmountCents: true, providerReversedCents: true, platformFeeCents: true, currency: true,
  stripeChargeId: true, stripeTransferId: true, transferAmountCents: true, createdAt: true,
  visit: { select: { occurrence: { select: { sequence: true, agreement: { select: {
    request: { select: { title: true } }, community: { select: { name: true } },
  } } } } } },
} satisfies Prisma.StripeTestPaymentSelect;
type HistoryRow = Prisma.StripeTestPaymentGetPayload<{ select: typeof historySelect }>;
function serialize(row: HistoryRow) {
  return {
    visitId: row.visitId, requestId: row.requestId, status: row.status, amountCents: row.amountCents,
    refundedCents: Math.max(row.amountRefundedCents, row.observedChargeRefundedCents ?? 0),
    requiresReview: Boolean(row.reconciliationHoldReason), providerCents: row.providerAmountCents,
    transferredCents: row.stripeTransferId ? (row.transferAmountCents ?? row.providerAmountCents) : 0, reversedCents: Math.max(row.providerReversedCents, row.observedProviderReversedCents ?? 0),
    feeCents: row.platformFeeCents, currency: row.currency, createdAt: row.createdAt.toISOString(),
    title: row.visit.occurrence.agreement.request.title, communityName: row.visit.occurrence.agreement.community.name,
    visitNumber: row.visit.occurrence.sequence,
    receiptAvailable: Boolean(row.stripeChargeId) && ["succeeded", "partially_refunded", "refunded"].includes(row.status),
  };
}
async function page(where: Prisma.StripeTestPaymentWhereInput, after?: string) {
  if (after && !await db.stripeTestPayment.findFirst({ where: { ...where, visitId: after }, select: { visitId: true } })) {
    throw new HoaWorkflowError("Payment history page not found.", 404);
  }
  const rows = await db.stripeTestPayment.findMany({ where, select: historySelect,
    orderBy: [{ createdAt: "desc" }, { visitId: "desc" }], take: 51,
    ...(after ? { cursor: { visitId: after }, skip: 1 } : {}),
  });
  return { payments: rows.slice(0, 50).map(serialize), nextCursor: rows.length > 50 ? rows[49].visitId : null };
}
/** Scope to the immutable original payer, never the current unit occupant. */
export async function listResidentTestPayments(payerUserId: string, after?: string) {
  enabled(); return page({ residentUserId: payerUserId }, after);
}
export async function listProviderTestPayments(providerUserId: string, after?: string) {
  enabled(); return page({ providerUserId }, after);
}
export async function listAdminTestPayments(actorUserId: string, communityId: string, requestId?: string, after?: string) {
  enabled();
  const actor = await db.user.findUnique({ where: { id: actorUserId }, include: { adminAccess: true } });
  // Ordinary staff grants are not financial-administrator access.
  if (actor?.role !== "admin" || !actor.isVerified || actor.adminAccess?.status !== "active" || actor.adminAccess.isStaffAccount ||
      !["owner", "admin"].includes(actor.adminAccess.level) || actor.adminAccess.email !== actor.email.toLowerCase()) {
    throw new HoaWorkflowError("Administrator access required.", 403);
  }
  return page({ communityId, ...(requestId ? { requestId } : {}) }, after);
}

export type ProviderTestPaymentTotals = {
  chargedCents: number; refundedCents: number; transferredCents: number; reversedCents: number;
  awaitingTransferCents: number; uncollectedCents: number; grossFeeCents: number;
  paymentCount: number; reviewPaymentCount: number; currency: "usd";
};
/** All persisted payments, not only the visible page or the 200 agreement limit. */
export async function getProviderTestPaymentTotals(providerUserId: string): Promise<ProviderTestPaymentTotals> {
  enabled();
  const [row] = await db.$queryRaw<Array<Record<Exclude<keyof ProviderTestPaymentTotals, "currency">, bigint>>>`
    SELECT COUNT(*)::bigint AS "paymentCount",
      COUNT(*) FILTER (WHERE "reconciliationHoldReason" IS NOT NULL)::bigint AS "reviewPaymentCount",
      COALESCE(SUM(CASE WHEN "status" IN ('succeeded','partially_refunded','refunded','disputed') THEN "amountCents" ELSE 0 END),0)::bigint AS "chargedCents",
      COALESCE(SUM(GREATEST("amountRefundedCents", "observedChargeRefundedCents")),0)::bigint AS "refundedCents",
      COALESCE(SUM(CASE WHEN "stripeTransferId" IS NOT NULL THEN COALESCE("transferAmountCents", "providerAmountCents") ELSE 0 END),0)::bigint AS "transferredCents",
      COALESCE(SUM(GREATEST("providerReversedCents", "observedProviderReversedCents")),0)::bigint AS "reversedCents",
      COALESCE(SUM(CASE WHEN "status" IN ('succeeded','partially_refunded') AND "stripeTransferId" IS NULL AND "reconciliationHoldReason" IS NULL
        THEN "providerAmountCents" - FLOOR("providerAmountCents"::numeric * "amountRefundedCents" / "amountCents") ELSE 0 END),0)::bigint AS "awaitingTransferCents",
      COALESCE(SUM(CASE WHEN "status" IN ('pending','failed','requires_action') THEN "providerAmountCents" ELSE 0 END),0)::bigint AS "uncollectedCents",
      COALESCE(SUM(CASE WHEN "status" IN ('succeeded','partially_refunded','refunded','disputed') THEN "platformFeeCents" ELSE 0 END),0)::bigint AS "grossFeeCents"
    FROM "StripeTestPayment" WHERE "providerUserId" = ${providerUserId}
  `;
  const values = Object.fromEntries(Object.entries(row).map(([key, value]) => {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 0) throw new HoaWorkflowError("Payment totals require review.", 503);
    return [key, number];
  })) as Omit<ProviderTestPaymentTotals, "currency">;
  return { ...values, currency: "usd" };
}

/** The receipt is read from the exact owned charge, not accepted from the browser. */
export async function getResidentTestReceipt(payerUserId: string, visitId: string) {
  enabled();
  const payment = await db.stripeTestPayment.findFirst({ where: { visitId, residentUserId: payerUserId } });
  if (!payment?.stripeChargeId || !payment.stripePaymentIntentId) throw new HoaWorkflowError("Receipt not found.", 404);
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key || !/^(sk|rk)_test_[A-Za-z0-9]+$/.test(key)) throw new HoaWorkflowError("Sandbox receipts are unavailable.", 503);
  const stripe = new Stripe(key, { timeout: 8000, maxNetworkRetries: 0 });
  const charge = await stripe.charges.retrieve(payment.stripeChargeId);
  if (charge.id !== payment.stripeChargeId || charge.livemode !== false || !charge.paid ||
      charge.payment_intent !== payment.stripePaymentIntentId || charge.customer !== payment.customerId ||
      charge.amount !== payment.amountCents || charge.currency !== payment.currency || !charge.receipt_url) {
    throw new HoaWorkflowError("Receipt requires billing review.", 409);
  }
  let url: URL;
  try { url = new URL(charge.receipt_url); } catch { throw new HoaWorkflowError("Receipt is unavailable.", 409); }
  if (url.protocol !== "https:" || url.hostname !== "pay.stripe.com" || url.port || url.username || url.password || !url.pathname.startsWith("/receipts/")) {
    throw new HoaWorkflowError("Receipt is unavailable.", 409);
  }
  return url.href;
}
