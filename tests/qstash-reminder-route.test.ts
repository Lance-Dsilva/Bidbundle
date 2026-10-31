import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  verify: vi.fn(),
  deliver: vi.fn(),
  reconcile: vi.fn(),
}));

vi.mock("@upstash/qstash", () => ({
  Receiver: class Receiver {
    verify = state.verify;
  },
}));

vi.mock("@/lib/server/notifications", () => ({
  deliverPendingOutbox: state.deliver,
}));

vi.mock("@/lib/server/neighborhood-market", () => ({
  reconcileNeighborhoodEnrollments: state.reconcile,
}));

const { GET, POST } = await import("@/app/api/jobs/reminders/route");

const request = (method: "GET" | "POST", headers: Record<string, string> = {}) =>
  new Request("https://bundleen.test/api/jobs/reminders", {
    method,
    headers,
    body: method === "POST" ? "{}" : undefined,
  });

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = "cron-secret";
  process.env.OUTBOX_WORKER_SECRET = "worker-secret";
  process.env.QSTASH_CURRENT_SIGNING_KEY = "current-signing-key";
  process.env.QSTASH_NEXT_SIGNING_KEY = "next-signing-key";
  state.verify.mockResolvedValue(true);
  state.deliver.mockResolvedValue({ delivered: 1 });
  state.reconcile.mockResolvedValue({ biddingOpened: 1, enrollmentExpired: 0 });
});

describe("QStash reminder worker route", () => {
  it("rejects a false signature verification without using a valid fallback secret", async () => {
    state.verify.mockResolvedValueOnce(false);
    const response = await POST(request("POST", { "Upstash-Signature": "invalid", Authorization: "Bearer worker-secret" }));
    expect(response.status).toBe(401);
    expect(state.reconcile).not.toHaveBeenCalled();
    expect(state.deliver).not.toHaveBeenCalled();
  });

  it("fails closed when signing keys are missing", async () => {
    delete process.env.QSTASH_CURRENT_SIGNING_KEY;
    const response = await POST(request("POST", { "Upstash-Signature": "signed", Authorization: "Bearer worker-secret" }));
    expect(response.status).toBe(401);
    expect(state.verify).not.toHaveBeenCalled();
    expect(state.reconcile).not.toHaveBeenCalled();
    expect(state.deliver).not.toHaveBeenCalled();
  });

  it("reports reconciliation failure without draining the outbox", async () => {
    state.reconcile.mockRejectedValueOnce(new Error("database failure"));
    const response = await POST(request("POST", { "x-outbox-secret": "worker-secret" }));
    expect(response.status).toBe(500);
    expect(state.deliver).not.toHaveBeenCalled();
  });

  it("rejects unsigned requests", async () => {
    const response = await POST(request("POST"));
    expect(response.status).toBe(401);
    expect(state.deliver).not.toHaveBeenCalled();
    expect(state.reconcile).not.toHaveBeenCalled();
  });

  it("verifies a QStash signature before draining the outbox", async () => {
    const response = await POST(
      request("POST", {
        "Upstash-Signature": "signed-jwt",
        "Upstash-Region": "iad1",
      }),
    );

    expect(response.status).toBe(200);
    expect(state.verify).toHaveBeenCalledWith({
      signature: "signed-jwt",
      body: "{}",
      clockTolerance: 5,
      upstashRegion: "iad1",
    });
    expect(state.deliver).toHaveBeenCalledWith(100);
    expect(state.reconcile).toHaveBeenCalledOnce();
    expect(state.reconcile.mock.invocationCallOrder[0]).toBeLessThan(state.deliver.mock.invocationCallOrder[0]);
  });

  it("does not fall back to a shared secret when a QStash signature is invalid", async () => {
    state.verify.mockRejectedValueOnce(new Error("bad signature"));
    const response = await POST(
      request("POST", {
        "Upstash-Signature": "invalid",
        Authorization: "Bearer worker-secret",
      }),
    );

    expect(response.status).toBe(401);
    expect(state.deliver).not.toHaveBeenCalled();
    expect(state.reconcile).not.toHaveBeenCalled();
  });

  it("retains the emergency shared-secret worker path", async () => {
    const response = await POST(
      request("POST", { "x-outbox-secret": "worker-secret" }),
    );
    expect(response.status).toBe(200);
    expect(state.verify).not.toHaveBeenCalled();
  });

  it("allows Vercel's daily recovery secret only on authenticated calls", async () => {
    const accepted = await GET(
      request("GET", { Authorization: "Bearer cron-secret" }),
    );
    const rejected = await GET(request("GET"));

    expect(accepted.status).toBe(200);
    expect(rejected.status).toBe(401);
  });
});
