import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ configured: true, consume: vi.fn() }));
vi.mock("@/lib/server/rate-limit", async (original) => ({ ...await original<typeof import("@/lib/server/rate-limit")>(), isRedisConfigured: () => state.configured, consumeRateLimit: state.consume }));
import { guardCommunityInterest } from "@/lib/server/community-interest-guard";
import { RATE_LIMITS } from "@/lib/server/rate-limit";
function request(headers: Record<string, string | undefined> = {}) { const actual = new Headers({ "x-real-ip": "203.0.113.7" }); for (const [key, value] of Object.entries(headers)) if (value !== undefined) actual.set(key, value); return new Request("https://bundleen.test/api/community-interest", { method: "POST", headers: actual }); }
beforeEach(() => { state.configured = true; state.consume.mockReset().mockResolvedValue({ success: true, retryAfterSeconds: 1 }); vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("VERCEL_ENV", undefined); vi.stubEnv("RATE_LIMIT_IDENTIFIER_SECRET", "independent-community interest-test-salt"); });
afterEach(() => vi.unstubAllEnvs());
describe("anonymous community interest abuse and privacy guard", () => {
  it("uses a dedicated bounded community interest bucket", async () => { expect(RATE_LIMITS.communityInterest).toEqual({ attempts: 10, window: "15 m" }); await expect(guardCommunityInterest(request())).resolves.toBeNull(); expect(state.consume).toHaveBeenCalledWith("communityInterest", expect.stringMatching(/^[0-9a-f]{32}$/)); expect(state.consume.mock.calls[0][1]).not.toContain("203.0.113.7"); });
  it("uses trusted Vercel IP precedence and ignores appended spoofed values", async () => {
    await guardCommunityInterest(request({ "x-vercel-forwarded-for": "198.51.100.4, 192.0.2.88", "x-forwarded-for": "192.0.2.1" })); const first = state.consume.mock.calls[0][1];
    await guardCommunityInterest(request({ "x-vercel-forwarded-for": "198.51.100.4, 192.0.2.99", "x-forwarded-for": "192.0.2.2" })); expect(state.consume.mock.calls[1][1]).toBe(first);
    vi.stubEnv("RATE_LIMIT_IDENTIFIER_SECRET", "different-private-salt"); await guardCommunityInterest(request({ "x-vercel-forwarded-for": "198.51.100.4" })); expect(state.consume.mock.calls[2][1]).not.toBe(first);
  });
  it.each([{ origin: "https://attacker.test" }, { origin: "null" }, { "sec-fetch-site": "cross-site" }, { "sec-fetch-site": "same-site" }])("rejects non-origin browser checks before consuming capacity: %j", async (headers) => { await expect(guardCommunityInterest(request(headers))).resolves.toMatchObject({ status: 403 }); expect(state.consume).not.toHaveBeenCalled(); });
  it.each([{ origin: "https://bundleen.test", "sec-fetch-site": "same-origin" }, { "sec-fetch-site": "none" }, {}])("still rate-limits permitted same-origin or non-browser requests: %j", async (headers) => { await expect(guardCommunityInterest(request(headers))).resolves.toBeNull(); expect(state.consume).toHaveBeenCalledOnce(); });
  it.each(["production", "preview"])("fails closed without Redis in %s", async (environment) => { state.configured = false; vi.stubEnv(environment === "production" ? "NODE_ENV" : "VERCEL_ENV", environment); await expect(guardCommunityInterest(request())).resolves.toMatchObject({ status: 503 }); expect(state.consume).not.toHaveBeenCalled(); });
  it.each([undefined, "", "   "])("does not send an unsalted IP digest to configured Redis: %j", async (secret) => { vi.stubEnv("RATE_LIMIT_IDENTIFIER_SECRET", secret); await expect(guardCommunityInterest(request())).resolves.toMatchObject({ status: 503 }); expect(state.consume).not.toHaveBeenCalled(); });
  it("preserves explicit bare local development behavior without pretending a limiter ran", async () => { state.configured = false; await expect(guardCommunityInterest(request())).resolves.toBeNull(); expect(state.consume).not.toHaveBeenCalled(); });
  it("does not bypass the anonymous bucket when the platform IP is unavailable", async () => { await guardCommunityInterest(new Request("https://bundleen.test/api/community-interest", { method: "POST" })); expect(state.consume).toHaveBeenCalledWith("communityInterest", expect.stringMatching(/^[0-9a-f]{32}$/)); });
  it("returns rate limit retry metadata without interpreting failure as geographic unavailability", async () => { state.consume.mockResolvedValue({ success: false, retryAfterSeconds: 61 }); await expect(guardCommunityInterest(request())).resolves.toMatchObject({ status: 429, retryAfterSeconds: 61 }); });
  it("contains limiter service errors without logging raw identifiers or coordinates", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {}); const warn = vi.spyOn(console, "warn").mockImplementation(() => {}); state.consume.mockRejectedValue(new Error("203.0.113.7 latitude30.4 secret-token"));
    try { const result = await guardCommunityInterest(request()); expect(result?.status).toBe(503); expect(JSON.stringify(result)).not.toMatch(/203\.0\.113|30\.4|secret-token/); expect(log).not.toHaveBeenCalled(); expect(warn).not.toHaveBeenCalled(); } finally { log.mockRestore(); warn.mockRestore(); }
  });
});
