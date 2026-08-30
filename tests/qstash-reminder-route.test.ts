import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  verify: vi.fn(),
  deliver: vi.fn(),
}));

vi.mock("@upstash/qstash", () => ({
  Receiver: class Receiver {
    verify = state.verify;
  },
}));

vi.mock("@/lib/server/notifications", () => ({
  deliverPendingOutbox: state.deliver,
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
});

describe("QStash reminder worker route", () => {
  it("rejects unsigned requests", async () => {
    const response = await POST(request("POST"));
    expect(response.status).toBe(401);
    expect(state.deliver).not.toHaveBeenCalled();
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
