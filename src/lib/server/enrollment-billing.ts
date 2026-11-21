import "server-only";
import { createHash } from "node:crypto";
import Stripe from "stripe";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/server/db";
import { HoaWorkflowError } from "@/lib/server/hoa";
import { notifyPriceLadderUnlock } from "@/lib/server/price-ladder";
const VERSION = "capped-completed-visit-v1";
function stripeClient() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (process.env.STRIPE_TEST_PAYMENTS !== "1" || !key || !/^(sk|rk)_test_[A-Za-z0-9]+$/.test(key)) throw new HoaWorkflowError("Sandbox enrollment is unavailable.", 503);
  return new Stripe(key, { timeout: 8000, maxNetworkRetries: 0 });
}
async function snapshot(tx: Prisma.TransactionClient, payerId: string, requestId: string, requireOpen = true) {
  const request = await tx.hoaServiceRequest.findUnique({ where: { id: requestId }, include: { community: true, priceCommitment: true } });
  const membership = request ? await tx.communityMembership.findFirst({ where: { userId: payerId, communityId: request.communityId, status: "active" } }) : null;
  const payer = await tx.user.findUnique({ where: { id: payerId }, select: { role: true, stripeTestCustomerId: true } });
  if (!request || request.community.type !== "hoa" || request.community.status !== "active" || request.kind !== "optional_group" ||
      !membership?.unitId || payer?.role !== "homeowner") throw new HoaWorkflowError("Enrollment not found.", 404);
  const commitment = request.priceCommitment;
  if (!commitment?.acceptedAt || request.poolTemplate || (requireOpen && (request.status !== "collecting_interest" || request.participantsLockedAt ||
      (request.enrollmentClosesAt && request.enrollmentClosesAt <= new Date())))) throw new HoaWorkflowError("This service is not open for capped enrollment.", 409);
  if (commitment.guaranteedPerHomeCents < request.totalOccurrences * 50) throw new HoaWorkflowError("This service needs billing review before card enrollment.", 409);
  const immutableTerms = [VERSION, requestId, payerId, membership.id, membership.unitId, commitment.id, commitment.providerUserId,
    commitment.scope, request.category, request.description, request.recurrenceIntervalDays, request.totalOccurrences, request.startDate?.toISOString(), request.requiresAfterPhoto];
  return { request, membership, payer, commitment, immutableTerms };
}
async function lockSnapshot(tx: Prisma.TransactionClient, payerId: string, requestId: string, requireOpen = true) {
  await tx.$queryRaw`SELECT "id" FROM "HoaServiceRequest" WHERE "id"=${requestId} FOR UPDATE`;
  const initial = await snapshot(tx, payerId, requestId, requireOpen);
  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id"=${payerId} FOR SHARE`;
  await tx.$queryRaw`SELECT "id" FROM "Community" WHERE "id"=${initial.request.communityId} FOR SHARE`;
  await tx.$queryRaw`SELECT "id" FROM "CommunityMembership" WHERE "id"=${initial.membership.id} FOR SHARE`;
  const live = await snapshot(tx, payerId, requestId, requireOpen);
  if (live.membership.id !== initial.membership.id || live.membership.unitId !== initial.membership.unitId) throw new HoaWorkflowError("Your home changed. Review enrollment again.", 409);
  return live;
}
function token(terms: unknown[], maximumCents: number) { return createHash("sha256").update(JSON.stringify([...terms, "usd", maximumCents])).digest("hex"); }
export async function getEnrollmentBillingOffer(payerId: string, requestId: string) {
  if (process.env.STRIPE_TEST_PAYMENTS !== "1") throw new HoaWorkflowError("Sandbox enrollment is unavailable.", 503);
  const s = await snapshot(db, payerId, requestId);
  return { title: s.request.title, scope: s.commitment.scope, maximumCents: s.commitment.guaranteedPerHomeCents, currency: "usd",
    totalOccurrences: s.request.totalOccurrences, recurrenceLabel: s.request.recurrenceLabel, termsToken: token(s.immutableTerms, s.commitment.guaranteedPerHomeCents) };
}
export async function startEnrollmentBilling(payerId: string, requestId: string, consentId: string, termsToken: string) {
  const stripe = stripeClient();
  const consent = await db.$transaction(async tx => {
    const s = await lockSnapshot(tx, payerId, requestId);
    const existing = await tx.enrollmentBillingConsent.findUnique({ where: { id: consentId } });
    if (existing) {
      if (existing.requestId !== requestId || existing.payerUserId !== payerId || existing.unitId !== s.membership.unitId || existing.revokedAt ||
          existing.termsToken !== termsToken || token(s.immutableTerms, existing.maximumCents) !== termsToken) throw new HoaWorkflowError("Enrollment consent changed. Start again.", 409);
      return existing;
    }
    if (token(s.immutableTerms, s.commitment.guaranteedPerHomeCents) !== termsToken) throw new HoaWorkflowError("Review the current maximum price before accepting.", 409);
    if (!s.request.stripeTestEnrollmentRequired) {
      if (await tx.hoaRequestParticipation.count({ where: { requestId } })) throw new HoaWorkflowError("This existing request needs manager billing review before card enrollment.", 409);
      await tx.hoaServiceRequest.update({ where: { id: requestId }, data: { stripeTestEnrollmentRequired: true } });
    }
    return tx.enrollmentBillingConsent.create({ data: { id: consentId, requestId, payerUserId: payerId, unitId: s.membership.unitId!, membershipId: s.membership.id,
      commitmentId: s.commitment.id, providerUserId: s.commitment.providerUserId, maximumCents: s.commitment.guaranteedPerHomeCents,
      currency: "usd", termsVersion: VERSION, termsToken } });
  });
  let payer = await db.user.findUniqueOrThrow({ where: { id: payerId }, select: { stripeTestCustomerId: true } });
  if (!payer.stripeTestCustomerId) {
    const customer = await stripe.customers.create({}, { idempotencyKey: `bundleen-test-customer:${createHash("sha256").update(JSON.stringify([payerId])).digest("hex")}` });
    if (customer.livemode !== false) throw new HoaWorkflowError("Sandbox customer setup failed.", 503);
    await db.user.updateMany({ where: { id: payerId, stripeTestCustomerId: null }, data: { stripeTestCustomerId: customer.id } });
    payer = await db.user.findUniqueOrThrow({ where: { id: payerId }, select: { stripeTestCustomerId: true } });
  }
  if (!payer.stripeTestCustomerId) throw new HoaWorkflowError("Sandbox customer setup failed.", 503);
  const setup = await stripe.setupIntents.create({ customer: payer.stripeTestCustomerId, usage: "off_session", allowed_payment_method_types: ["card"],
    metadata: { bundleenEnrollmentConsentId: consent.id, bundleenTermsToken: consent.termsToken } }, { idempotencyKey: `enrollment_setup_${consent.id}` });
  if (setup.livemode !== false || setup.customer !== payer.stripeTestCustomerId || !setup.client_secret) throw new HoaWorkflowError("Sandbox card setup failed.", 503);
  const current = await snapshot(db, payerId, requestId);
  const liveConsent = await db.enrollmentBillingConsent.findUniqueOrThrow({ where: { id: consent.id } });
  if (liveConsent.revokedAt || current.payer.stripeTestCustomerId !== setup.customer || token(current.immutableTerms, consent.maximumCents) !== consent.termsToken) throw new HoaWorkflowError("Enrollment changed. Start again.", 409);
  return { clientSecret: setup.client_secret };
}
export async function confirmEnrollmentBilling(payerId: string, requestId: string, consentId: string, setupIntentId: string) {
  const stripe = stripeClient();
  const prepared = await db.enrollmentBillingConsent.findUnique({ where: { id: consentId } });
  if (!prepared || prepared.requestId !== requestId || prepared.payerUserId !== payerId || prepared.revokedAt) throw new HoaWorkflowError("Enrollment not found.", 404);
  const setup = await stripe.setupIntents.retrieve(setupIntentId, { expand: ["payment_method"] });
  const card = setup.payment_method;
  if (setup.livemode !== false || setup.status !== "succeeded" || setup.metadata?.bundleenEnrollmentConsentId !== consentId || setup.metadata.bundleenTermsToken !== prepared.termsToken ||
      !card || typeof card === "string" || card.livemode !== false || !card.card || setup.customer !== card.customer) throw new HoaWorkflowError("A verified sandbox card is required.", 409);
  await db.$transaction(async tx => {
    const s = await lockSnapshot(tx, payerId, requestId, false);
    await tx.$queryRaw`SELECT "id" FROM "EnrollmentBillingConsent" WHERE "id"=${consentId} FOR UPDATE`;
    const consent = await tx.enrollmentBillingConsent.findUniqueOrThrow({ where: { id: consentId }, include: { card: true } });
    if (!s.request.stripeTestEnrollmentRequired || consent.revokedAt || consent.membershipId !== s.membership.id || consent.unitId !== s.membership.unitId ||
        consent.providerUserId !== s.commitment.providerUserId || token(s.immutableTerms, consent.maximumCents) !== consent.termsToken ||
        s.commitment.guaranteedPerHomeCents > consent.maximumCents || s.payer.stripeTestCustomerId !== setup.customer) throw new HoaWorkflowError("Enrollment or card ownership changed. Start again.", 409);
    const existing = await tx.hoaRequestParticipation.findFirst({ where: { requestId, unitId: consent.unitId } });
    if (existing?.response === "joined") {
      if (existing.userId === payerId && existing.enrollmentConsentId === consentId && consent.card?.setupIntentId === setupIntentId) return;
      throw new HoaWorkflowError("This home is already enrolled.", 409);
    }
    if (s.request.status !== "collecting_interest" || s.request.participantsLockedAt ||
        (s.request.enrollmentClosesAt && s.request.enrollmentClosesAt <= new Date())) throw new HoaWorkflowError("Sign-ups for this request have closed or locked.", 409);
    if (s.request.maxHomes != null && await tx.hoaRequestParticipation.count({ where: { requestId, response: "joined" } }) >= s.request.maxHomes) throw new HoaWorkflowError("This service has reached its maximum number of homes.", 409);
    if (consent.card && consent.card.setupIntentId !== setupIntentId) throw new HoaWorkflowError("A different card is already bound to this consent.", 409);
    if (!consent.card) await tx.enrollmentBillingCard.create({ data: { consentId, customerId: card.customer as string, paymentMethodId: card.id, setupIntentId, brand: card.card!.brand, last4: card.card!.last4 } });
    const data = { response: "joined" as const, userId: payerId, enrollmentConsentId: consentId };
    if (existing) await tx.hoaRequestParticipation.update({ where: { id: existing.id }, data });
    else await tx.hoaRequestParticipation.create({ data: { requestId, unitId: consent.unitId, ...data } });
    await notifyPriceLadderUnlock(tx, requestId, s.commitment.guaranteedPerHomeCents);
  });
  return { joined: true };
}
