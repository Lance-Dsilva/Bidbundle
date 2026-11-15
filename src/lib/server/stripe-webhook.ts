import "server-only";

import Stripe from "stripe";

const signingSecretNames = {
  platform: "STRIPE_WEBHOOK_SECRET",
  connect: "STRIPE_CONNECT_WEBHOOK_SECRET",
} as const;

export type StripeWebhookSource = keyof typeof signingSecretNames;

export class StripeWebhookError extends Error {
  constructor(message: string, readonly status: 400 | 503) {
    super(message);
    this.name = "StripeWebhookError";
  }
}

/** Verify the original request bytes before trusting any event fields. */
export async function verifyStripeTestWebhook(
  request: Request,
  source: StripeWebhookSource,
): Promise<Stripe.Event> {
  const secret = process.env[signingSecretNames[source]];
  if (!secret || !secret.startsWith("whsec_")) {
    throw new StripeWebhookError("Stripe webhook signing is unavailable.", 503);
  }
  const signature = request.headers.get("stripe-signature");
  if (!signature) throw new StripeWebhookError("Missing Stripe signature.", 400);

  let event: Stripe.Event;
  try {
    const body = Buffer.from(await request.arrayBuffer());
    event = Stripe.webhooks.constructEvent(body, signature, secret);
  } catch {
    throw new StripeWebhookError("Invalid Stripe webhook payload or signature.", 400);
  }

  if (!event || event.object !== "event" || typeof event.id !== "string" ||
      typeof event.type !== "string" || !event.data?.object) {
    throw new StripeWebhookError("Invalid Stripe event.", 400);
  }
  if (event.livemode !== false) {
    throw new StripeWebhookError("Only Stripe test events are accepted.", 400);
  }
  if ((source === "connect") !== Boolean(event.account)) {
    throw new StripeWebhookError("Stripe event sent to the wrong webhook.", 400);
  }
  return event;
}
