import "server-only";

import { createHash } from "node:crypto";
import Stripe from "stripe";
import { db } from "@/lib/server/db";
import { HoaWorkflowError } from "@/lib/server/hoa";
import { getVisitBillingOffer } from "@/lib/server/visit-billing-consent";

function idempotencyKey(scope: string, parts: string[]): string {
  return scope + ":" + createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

export async function startStripeTestCardSetup(
  payerUserId: string,
  agreementId: string,
  attemptId: string,
): Promise<{ clientSecret: string }> {
  const stripe = createStripeTestClient();
  const offer = await getAcceptedOffer(payerUserId, agreementId);
  const payer = await db.user.findUniqueOrThrow({
    where: { id: payerUserId }, select: { stripeTestCustomerId: true },
  });
  let customerId = payer.stripeTestCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({}, {
      idempotencyKey: idempotencyKey("bundleen-test-customer", [payerUserId]),
    });
    if (customer.livemode !== false) {
      throw new HoaWorkflowError("Stripe sandbox card setup is unavailable.", 503);
    }
    await db.user.updateMany({
      where: { id: payerUserId, stripeTestCustomerId: null },
      data: { stripeTestCustomerId: customer.id },
    });
    const saved = await db.user.findUniqueOrThrow({
      where: { id: payerUserId }, select: { stripeTestCustomerId: true },
    });
    customerId = saved.stripeTestCustomerId;
    if (!customerId) throw new HoaWorkflowError("Stripe sandbox card setup is unavailable.", 503);
  }

  const intent = await stripe.setupIntents.create({
    customer: customerId,
    allowed_payment_method_types: ["card"],
    usage: "off_session",
    metadata: {
      bundleenAgreementId: agreementId,
      bundleenTermsToken: offer.termsToken,
      bundleenConsentAt: offer.acceptedAt,
    },
  }, {
    idempotencyKey: idempotencyKey("bundleen-test-card", [customerId, agreementId, offer.termsToken, offer.acceptedAt, attemptId]),
  });
  if (intent.livemode !== false || intent.customer !== customerId || !intent.client_secret) {
    throw new HoaWorkflowError("Stripe sandbox card setup is unavailable.", 503);
  }

  // Recheck authority before disclosing a client secret after network calls.
  const current = await getVisitBillingOffer(payerUserId, agreementId);
  if (current.termsToken !== offer.termsToken || current.acceptedAt !== offer.acceptedAt) {
    throw new HoaWorkflowError("Review and accept the current visit prices before adding a card.", 409);
  }
  return { clientSecret: intent.client_secret };
}

export async function verifyStripeTestCardSetup(
  payerUserId: string,
  agreementId: string,
  setupIntentId: string,
): Promise<{ brand: string; last4: string }> {
  const stripe = createStripeTestClient();
  const offer = await getAcceptedOffer(payerUserId, agreementId);
  const payer = await db.user.findUniqueOrThrow({
    where: { id: payerUserId }, select: { stripeTestCustomerId: true },
  });
  const customerId = payer.stripeTestCustomerId;
  if (!customerId) throw new HoaWorkflowError("No Stripe sandbox card setup was found.", 404);

  const intent = await stripe.setupIntents.retrieve(setupIntentId, { expand: ["payment_method"] });
  if (intent.livemode !== false || intent.customer !== customerId ||
      intent.metadata?.bundleenAgreementId !== agreementId ||
      intent.metadata.bundleenTermsToken !== offer.termsToken ||
      intent.metadata.bundleenConsentAt !== offer.acceptedAt) {
    throw new HoaWorkflowError("No Stripe sandbox card setup was found.", 404);
  }

  const method = intent.payment_method;
  if (intent.status !== "succeeded" || !method || typeof method === "string" ||
      method.livemode !== false || method.customer !== customerId || !method.card) {
    throw new HoaWorkflowError("Stripe has not confirmed a card for this agreement.", 409);
  }
  const current = await getAcceptedOffer(payerUserId, agreementId);
  if (current.termsToken !== offer.termsToken || current.acceptedAt !== offer.acceptedAt) {
    throw new HoaWorkflowError("Review and accept the current visit prices before adding a card.", 409);
  }
  return { brand: method.card.brand, last4: method.card.last4 };
}

function createStripeTestClient(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (process.env.STRIPE_TEST_CARD_SETUP !== "1" || !key || !/^(sk|rk)_test_[A-Za-z0-9]+$/.test(key)) {
    throw new HoaWorkflowError("Stripe sandbox card setup is unavailable.", 503);
  }
  return new Stripe(key);
}

async function getAcceptedOffer(payerUserId: string, agreementId: string) {
  const offer = await getVisitBillingOffer(payerUserId, agreementId);
  if (!offer.acceptedAt) {
    throw new HoaWorkflowError("Accept the final visit prices before adding a card.", 409);
  }
  return { ...offer, acceptedAt: offer.acceptedAt };
}
