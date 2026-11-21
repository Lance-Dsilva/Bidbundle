import "server-only";

import { db } from "@/lib/server/db";
import { StripeWebhookError, verifyStripeTestWebhook, type StripeWebhookSource } from "@/lib/server/stripe-webhook";

export async function receiveStripeTestWebhook(request: Request, source: StripeWebhookSource): Promise<Response> {
  // Enable intake explicitly only after the sandbox processor is ready.
  if (process.env.STRIPE_TEST_WEBHOOK_INTAKE !== "1") {
    return Response.json({ error: "Stripe test webhook intake is unavailable." }, { status: 503 });
  }

  try {
    const event = await verifyStripeTestWebhook(request, source);
    const resource = event.data.object;
    const occurredAt = new Date(event.created * 1000);
    if (typeof resource !== "object" || !("id" in resource) || typeof resource.id !== "string" || !resource.id ||
        !Number.isSafeInteger(event.created) || event.created < 0 || !Number.isFinite(occurredAt.getTime())) {
      throw new StripeWebhookError("Invalid Stripe resource event.", 400);
    }

    // Store references rather than the snapshot payload, which can contain
    // customer data and client secrets. Processing can fetch the current sandbox resource.
    await db.stripeTestEvent.createMany({
      data: {
        id: event.id,
        eventType: event.type,
        objectId: resource.id,
        accountId: event.account ?? null,
        occurredAt,
      },
      skipDuplicates: true,
    });
    return Response.json({ received: true });
  } catch (error) {
    if (error instanceof StripeWebhookError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    // A failed write must be retried by Stripe. Keep raw event data out of logs.
    console.error("Unable to persist Stripe test webhook event");
    return Response.json({ error: "Stripe webhook intake failed." }, { status: 503 });
  }
}
