import "server-only";
import Stripe from "stripe";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/server/db";
import { HoaWorkflowError } from "@/lib/server/hoa";
import { calculateStripePaymentAmounts } from "@/lib/stripe-payment-amounts";


function client() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (process.env.STRIPE_TEST_PAYMENTS !== "1" || !key || !/^(sk|rk)_test_[A-Za-z0-9]+$/.test(key)) throw new HoaWorkflowError("Sandbox charges are unavailable.", 503);
  return new Stripe(key, { timeout: 8000, maxNetworkRetries: 0 });
}

/** No Stripe call: lock and snapshot exactly one eligible completed visit. */
export async function prepareStripeTestPayment(visitId: string) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "ServiceVisit" WHERE "id" = ${visitId} FOR UPDATE`;
    const existing = await tx.stripeTestPayment.findUnique({ where: { visitId } });
    if (existing) return existing;
    const visit = await tx.serviceVisit.findUnique({ where: { id: visitId }, include: {
      occurrence: { include: { agreement: { include: { request: true, community: true, provider: { include: { providerProfile: true } } } } } },
    } });
    if (!visit || visit.status !== "completed" || !visit.completedAt || !visit.unitId || !visit.billingPayerUserId) throw new HoaWorkflowError("No completed billable visit was found.", 409);
    const agreement = visit.occurrence.agreement;
    if (agreement.request.kind !== "optional_group" || agreement.community.type !== "hoa" ||
        ["cancelled", "failed"].includes(agreement.request.status) || agreement.status === "cancelled" ||
        agreement.lockedHomeCount < (agreement.request.minHomes ?? 1)) throw new HoaWorkflowError("This request is not eligible for payment.", 409);
    // Subminimum USD allocations require an explicit aggregation policy, never silently overcharge them.
    if (agreement.currency !== "usd" || visit.allocatedVisitCents === null || visit.allocatedVisitCents < 50) throw new HoaWorkflowError("This visit requires billing review before charging.", 409);
    const provider = agreement.provider;
    if (provider.role !== "provider" || provider.providerProfile?.accountStatus !== "active" ||
        provider.providerProfile.stripeTestPayoutStatus !== "active" || !provider.providerProfile.stripeTestAccountId) throw new HoaWorkflowError("The provider must finish sandbox payout setup before charging.", 409);
    const key = { agreementId: agreement.id, payerUserId: visit.billingPayerUserId, unitId: visit.unitId };
    await lockConsent(tx, key);
    const consent = await tx.visitBillingConsent.findUnique({ where: { agreementId_payerUserId_unitId: key }, include: { testCard: true } });
    if (!consent?.testCard || consent.termsVersion !== "completed-visit-charge-v1" || consent.acceptedAt > visit.completedAt || consent.testCard.verifiedAt > visit.completedAt) throw new HoaWorkflowError("The resident must accept prices and save a card before service completion.", 409);
    const payer = await tx.user.findUnique({ where: { id: visit.billingPayerUserId }, select: { stripeTestCustomerId: true } });
    if (payer?.stripeTestCustomerId !== consent.testCard.customerId) throw new HoaWorkflowError("The saved card customer has changed.", 409);
    const configuredFee = process.env.PLATFORM_FEE_BPS ?? "1000";
    if (!/^\d+$/.test(configuredFee) || Number(configuredFee) > 1000) throw new HoaWorkflowError("Platform fee must preserve the provider's 90% share.", 503);
    const split = calculateStripePaymentAmounts(visit.allocatedVisitCents, Number(configuredFee));
    return tx.stripeTestPayment.create({ data: {
      visitId, requestId: agreement.requestId, agreementId: agreement.id, communityId: agreement.communityId,
      residentUserId: visit.billingPayerUserId, providerUserId: agreement.providerUserId, unitId: visit.unitId,
      customerId: consent.testCard.customerId, paymentMethodId: consent.testCard.paymentMethodId,
      providerAccountId: provider.providerProfile.stripeTestAccountId, termsToken: consent.termsToken,
      amountCents: visit.allocatedVisitCents, platformFeeCents: split.platformFeeCents, hoaShareCents: 0,
      providerAmountCents: split.providerAmountCents, currency: "usd",
    } });
  });
}
async function lockConsent(tx: Prisma.TransactionClient, key: { agreementId: string; payerUserId: string; unitId: string }) {
  await tx.$queryRaw`SELECT "agreementId" FROM "VisitBillingConsent" WHERE "agreementId" = ${key.agreementId} AND "payerUserId" = ${key.payerUserId} AND "unitId" = ${key.unitId} FOR SHARE`;
}

/** Create without confirmation, persist the intent identity, then confirm that same intent only. */
export async function chargeStripeTestVisit(visitId: string) {
  const stripe = client();
  let payment = await prepareStripeTestPayment(visitId);
  if (["succeeded", "refunded", "partially_refunded", "disputed"].includes(payment.status)) return;
  if (!payment.stripePaymentIntentId) {
    const intent = await stripe.paymentIntents.create({
      amount: payment.amountCents, currency: payment.currency, customer: payment.customerId,
      payment_method: payment.paymentMethodId, allowed_payment_method_types: ["card"],
      transfer_group: `request_${payment.requestId}`,
      metadata: { bundleenVisitId: visitId },
      // Deliberately no confirm:true. A network/DB failure cannot lose an already charged intent.
    }, { idempotencyKey: `create_visit_${visitId}` });
    if (intent.livemode !== false || intent.status !== "requires_confirmation") throw new HoaWorkflowError("Unexpected sandbox payment state.", 409);
    await db.stripeTestPayment.updateMany({ where: { visitId, stripePaymentIntentId: null }, data: { stripePaymentIntentId: intent.id } });
    payment = await db.stripeTestPayment.findUniqueOrThrow({ where: { visitId } });
  }
  // Serialize confirmation against retries and consent deletion. All confirmation retries
  // use the persisted intent, never a new charge identity after Stripe's key retention expires.
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "visitId" FROM "StripeTestPayment" WHERE "visitId" = ${visitId} FOR UPDATE`;
    const current = await tx.stripeTestPayment.findUniqueOrThrow({ where: { visitId } });
    if (!current.stripePaymentIntentId) throw new HoaWorkflowError("Missing payment identity.", 409);
    const intent = await stripe.paymentIntents.retrieve(current.stripePaymentIntentId);
    if (intent.livemode !== false || intent.amount !== current.amountCents || intent.currency !== current.currency ||
        intent.customer !== current.customerId || intent.metadata.bundleenVisitId !== visitId || intent.payment_method !== current.paymentMethodId) throw new HoaWorkflowError("Sandbox payment identity does not match.", 409);
    if (intent.status === "succeeded") {
      await tx.stripeTestPayment.update({ where: { visitId }, data: { status: "succeeded", stripeChargeId: typeof intent.latest_charge === "string" ? intent.latest_charge : intent.latest_charge?.id ?? null, failureCode: null } });
      return;
    }
    if (intent.status !== "requires_confirmation") {
      await tx.stripeTestPayment.update({ where: { visitId }, data: { status: intent.status === "requires_action" ? "requires_action" : intent.status === "requires_payment_method" || intent.status === "canceled" ? "failed" : "pending", failureCode: intent.last_payment_error?.code ?? null } });
      return;
    }
    const consentKey = { agreementId: current.agreementId, payerUserId: current.residentUserId, unitId: current.unitId };
    await lockConsent(tx, consentKey);
    const consent = await tx.visitBillingConsent.findUnique({ where: { agreementId_payerUserId_unitId: consentKey }, include: { testCard: true } });
    if (consent?.termsToken !== current.termsToken || consent.testCard?.customerId !== current.customerId || consent.testCard.paymentMethodId !== current.paymentMethodId) throw new HoaWorkflowError("Payment consent or card has changed. Billing review required.", 409);
    await tx.$queryRaw`SELECT visit."id" FROM "ServiceVisit" visit
      JOIN "ServiceOccurrence" occurrence ON occurrence."id" = visit."occurrenceId"
      JOIN "ServiceAgreement" agreement ON agreement."id" = occurrence."agreementId"
      JOIN "HoaServiceRequest" request ON request."id" = agreement."requestId"
      WHERE visit."id" = ${visitId} FOR SHARE OF visit, agreement, request`;
    const visit = await tx.serviceVisit.findUnique({ where: { id: visitId }, include: { occurrence: { include: { agreement: { include: { request: true } } } } } });
    if (!visit || visit.status !== "completed" || visit.occurrence.agreement.status === "cancelled" ||
        ["cancelled", "failed"].includes(visit.occurrence.agreement.request.status)) throw new HoaWorkflowError("The service is no longer eligible for payment.", 409);
    await tx.$queryRaw`SELECT provider."id" FROM "User" provider JOIN "ProviderProfile" profile ON profile."userId" = provider."id"
      WHERE provider."id" = ${current.providerUserId} FOR SHARE OF provider, profile`;
    const provider = await tx.user.findUnique({ where: { id: current.providerUserId }, include: { providerProfile: true } });
    if (provider?.role !== "provider" || provider.providerProfile?.accountStatus !== "active" ||
        provider.providerProfile.stripeTestAccountId !== current.providerAccountId || provider.providerProfile.stripeTestPayoutStatus !== "active") {
      throw new HoaWorkflowError("Provider payout eligibility changed. Billing review required.", 409);
    }
    // Success/failure state is reconciled from Stripe's persisted intent on a later retry/event.
    // If confirmation succeeds but the DB transaction times out, it cannot charge a second intent.
    const confirmed = await stripe.paymentIntents.confirm(current.stripePaymentIntentId, { off_session: true }, { idempotencyKey: `charge_visit_${visitId}` });
    await tx.stripeTestPayment.update({ where: { visitId }, data: {
      status: confirmed.status === "succeeded" ? "succeeded" : confirmed.status === "requires_action" ? "requires_action" : "pending",
      stripeChargeId: typeof confirmed.latest_charge === "string" ? confirmed.latest_charge : confirmed.latest_charge?.id ?? null,
    } });
  }, { timeout: 25000 });
}
