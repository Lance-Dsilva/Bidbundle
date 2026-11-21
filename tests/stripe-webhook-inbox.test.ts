import Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as platform } from "@/app/api/stripe/webhook/route";
import { POST as connect } from "@/app/api/stripe/connect-webhook/route";

const { enqueue } = vi.hoisted(() => ({ enqueue: vi.fn() }));
vi.mock("@/lib/server/db", () => ({ db: { stripeTestEvent: { createMany: enqueue } } }));

const secret = "whsec_fixture";
function eventRequest(account?: string) {
  const payload = JSON.stringify({
    object: "event", id: "evt_fixture", type: "account.updated", account,
    livemode: false, created: 1700000000,
    data: { object: { id: "acct_fixture", client_secret: "private-fixture" } },
  });
  return new Request("https://example.invalid", {
    method: "POST", body: payload,
    headers: { "stripe-signature": Stripe.webhooks.generateTestHeaderString({ payload, secret }) },
  });
}

describe("Stripe webhook intake routes", () => {
  beforeEach(() => {
    vi.stubEnv("STRIPE_TEST_WEBHOOK_INTAKE", "1");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", secret);
    vi.stubEnv("STRIPE_CONNECT_WEBHOOK_SECRET", secret);
    enqueue.mockReset().mockResolvedValue({ count: 1 });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("stores only references and acknowledges a retry with the same unique key", async () => {
    expect((await connect(eventRequest("acct_fixture"))).status).toBe(200);
    enqueue.mockResolvedValue({ count: 0 });
    expect((await connect(eventRequest("acct_fixture"))).status).toBe(200);
    expect(enqueue).toHaveBeenNthCalledWith(2, {
      skipDuplicates: true,
      data: {
        id: "evt_fixture", eventType: "account.updated", objectId: "acct_fixture",
        accountId: "acct_fixture", occurredAt: new Date(1700000000000),
      },
    });
  });

  it("rejects wrong-source requests and disabled intake before persisting", async () => {
    expect((await platform(eventRequest("acct_fixture"))).status).toBe(400);
    vi.stubEnv("STRIPE_TEST_WEBHOOK_INTAKE", "");
    expect((await connect(eventRequest("acct_fixture"))).status).toBe(503);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("returns a retryable error when the database is unavailable", async () => {
    enqueue.mockRejectedValue(new Error("fixture write failed"));
    expect((await platform(eventRequest())).status).toBe(503);
  });
});
