import Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { verifyStripeTestWebhook } from "@/lib/server/stripe-webhook";

const platformSecret = "whsec_fixture_platform";
const connectSecret = "whsec_fixture_connect";
const baseEvent = {
  object: "event",
  id: "evt_fixture",
  type: "payment_intent.succeeded",
  livemode: false,
  data: { object: { id: "pi_fixture" } },
};

function signedRequest(payload: string, secret = platformSecret, body = payload) {
  const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret });
  return new Request("https://example.invalid/webhook", {
    method: "POST",
    body,
    headers: { "stripe-signature": signature },
  });
}

describe("Stripe test webhook verification", () => {
  beforeEach(() => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", platformSecret);
    vi.stubEnv("STRIPE_CONNECT_WEBHOOK_SECRET", connectSecret);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("verifies an event using the raw request bytes", async () => {
    const payload = JSON.stringify(baseEvent, null, 2);
    await expect(verifyStripeTestWebhook(signedRequest(payload), "platform"))
      .resolves.toMatchObject({ id: baseEvent.id, livemode: false });
    await expect(verifyStripeTestWebhook(signedRequest(payload, platformSecret, JSON.stringify(baseEvent)), "platform"))
      .rejects.toMatchObject({ status: 400 });
  });

  it("separates Connect events and signing secrets", async () => {
    const payload = JSON.stringify({ ...baseEvent, account: "acct_fixture", type: "account.updated" });
    await expect(verifyStripeTestWebhook(signedRequest(payload, connectSecret), "connect"))
      .resolves.toMatchObject({ account: "acct_fixture" });
    await expect(verifyStripeTestWebhook(signedRequest(payload), "connect")).rejects.toMatchObject({ status: 400 });
    await expect(verifyStripeTestWebhook(signedRequest(payload), "platform")).rejects.toMatchObject({ status: 400 });
  });

  it("rejects even a correctly signed live event", async () => {
    const payload = JSON.stringify({ ...baseEvent, livemode: true });
    await expect(verifyStripeTestWebhook(signedRequest(payload), "platform")).rejects.toMatchObject({ status: 400 });
  });

  it("fails closed when the secret or signature is absent", async () => {
    const payload = JSON.stringify(baseEvent);
    await expect(verifyStripeTestWebhook(new Request("https://example.invalid/"), "platform"))
      .rejects.toMatchObject({ status: 400 });
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "");
    await expect(verifyStripeTestWebhook(signedRequest(payload), "platform")).rejects.toMatchObject({ status: 503 });
  });
});
