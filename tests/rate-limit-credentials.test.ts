import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  clients: [] as Array<{ url: string; token: string }>,
  limiters: [] as Array<{ limiter: { tokens: number; window: string }; prefix: string }>,
  identifiers: [] as string[], down: false, allow: true,
}));
vi.mock("@upstash/redis", () => ({ Redis: class {
  constructor(config: { url: string; token: string }) { state.clients.push({ ...config }); }
} }));
vi.mock("@upstash/ratelimit", () => ({ Ratelimit: class {
  constructor(private config: { limiter: { tokens: number; window: string }; prefix: string }) { state.limiters.push(config); }
  static slidingWindow(tokens: number, window: string) { return { tokens, window }; }
  async limit(identifier: string) {
    state.identifiers.push(identifier);
    if (state.down) throw new Error("synthetic-dedicated-credential-must-not-leak");
    return { success: state.allow, limit: this.config.limiter.tokens, remaining: 0, reset: Date.now() + 37000, pending: Promise.resolve() };
  }
} }));
import { consumeRateLimit, isRedisConfigured, RateLimiterUnavailableError, RATE_LIMITS, resetRateLimiterCache } from "@/lib/server/rate-limit";
import { guardAiChat, requiresRateLimiter } from "@/lib/server/auth-guard";

const pairs = {
  dedicated: ["RATE_LIMIT_KV_REST_API_URL", "RATE_LIMIT_KV_REST_API_TOKEN"],
  upstash: ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"],
  legacy: ["KV_REST_API_URL", "KV_REST_API_TOKEN"],
} as const;
function pair(name: keyof typeof pairs) {
  vi.stubEnv(pairs[name][0], `https://${name}.example.invalid`);
  vi.stubEnv(pairs[name][1], `synthetic-${name}-token`);
}
beforeEach(() => {
  for (const name of Object.values(pairs).flat()) vi.stubEnv(name, "");
  vi.stubEnv("RATE_LIMIT_IDENTIFIER_SECRET", "synthetic-ai-regression-key"); vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("VERCEL_ENV", "production");
  resetRateLimiterCache(); state.clients.length = 0; state.limiters.length = 0; state.identifiers.length = 0; state.down = false; state.allow = true;
});
afterEach(() => { resetRateLimiterCache(); vi.unstubAllEnvs(); });

describe("rate-limit resource credential selection", () => {
  it("uses the complete dedicated resource before unrelated Upstash and legacy resources", async () => {
    pair("legacy"); pair("upstash"); pair("dedicated");
    expect(isRedisConfigured()).toBe(true); expect(await guardAiChat("synthetic-account")).toBeNull();
    expect(state.clients).toEqual([{ url: "https://dedicated.example.invalid", token: "synthetic-dedicated-token" }]);
  });
  it.each([0, 1])("falls back to the complete Upstash pair when dedicated credential %s is absent", async absent => {
    pair("dedicated"); pair("upstash"); pair("legacy"); vi.stubEnv(pairs.dedicated[absent], "");
    await consumeRateLimit("aiChat", "opaque-key");
    expect(state.clients).toEqual([{ url: "https://upstash.example.invalid", token: "synthetic-upstash-token" }]);
  });
  it("retains a complete legacy KV pair when newer integrations are incomplete", async () => {
    vi.stubEnv(pairs.dedicated[0], "https://dedicated.example.invalid"); vi.stubEnv(pairs.upstash[1], "synthetic-upstash-token"); pair("legacy");
    await consumeRateLimit("aiChat", "opaque-key");
    expect(state.clients).toEqual([{ url: "https://legacy.example.invalid", token: "synthetic-legacy-token" }]);
  });
  it("treats whitespace-only credentials as missing and trims a complete resource pair", async () => {
    pair("upstash"); vi.stubEnv(pairs.dedicated[0], "https://dedicated.example.invalid"); vi.stubEnv(pairs.dedicated[1], " \t ");
    await consumeRateLimit("aiChat", "opaque-key"); expect(state.clients[0].url).toBe("https://upstash.example.invalid");
    resetRateLimiterCache(); state.clients.length = 0;
    vi.stubEnv(pairs.dedicated[0], " https://dedicated.example.invalid "); vi.stubEnv(pairs.dedicated[1], " synthetic-dedicated-token ");
    await consumeRateLimit("aiChat", "opaque-key");
    expect(state.clients).toEqual([{ url: "https://dedicated.example.invalid", token: "synthetic-dedicated-token" }]);
  });
  it.each([
    ["RATE_LIMIT_KV_REST_API_URL", "UPSTASH_REDIS_REST_TOKEN"],
    ["UPSTASH_REDIS_REST_URL", "RATE_LIMIT_KV_REST_API_TOKEN"],
    ["RATE_LIMIT_KV_REST_API_URL", "KV_REST_API_TOKEN"],
    ["KV_REST_API_URL", "UPSTASH_REDIS_REST_TOKEN"],
  ])("never combines an incomplete %s with unrelated %s", async (urlKey, tokenKey) => {
    vi.stubEnv(urlKey, "https://partial.example.invalid"); vi.stubEnv(tokenKey, "synthetic-unrelated-token");
    expect(isRedisConfigured()).toBe(false);
    await expect(consumeRateLimit("aiChat", "opaque-key")).rejects.toBeInstanceOf(RateLimiterUnavailableError);
    expect(state.clients).toHaveLength(0);
  });
  it("does not fall through to another resource when a configured dedicated resource fails", async () => {
    pair("dedicated"); pair("upstash"); pair("legacy"); state.down = true;
    await expect(consumeRateLimit("aiChat", "opaque-key")).rejects.toThrow("Rate limiter request failed.");
    expect(await guardAiChat("synthetic-account")).toEqual({ kind: "unavailable" });
    expect(state.clients).toEqual([{ url: "https://dedicated.example.invalid", token: "synthetic-dedicated-token" }]);
  });
  it("keeps production fail-closed with no complete credentials", async () => {
    expect(requiresRateLimiter()).toBe(true); expect(await guardAiChat("synthetic-account")).toEqual({ kind: "unavailable" });
    expect(state.clients).toHaveLength(0);
  });
  it("keeps the same AI cost limit, denial and salted per-account bucket", async () => {
    pair("dedicated"); state.allow = false;
    expect(RATE_LIMITS.aiChat).toEqual({ attempts: 20, window: "5 m" });
    expect(await guardAiChat("synthetic-raw-account-id")).toEqual({ kind: "rate-limited", retryAfterSeconds: 37 });
    expect(state.limiters).toEqual([expect.objectContaining({ limiter: { tokens: 20, window: "5 m" }, prefix: "bundleen:ratelimit:aiChat" })]);
    expect(state.identifiers[0]).toMatch(/^[a-f0-9]{32}$/); expect(state.identifiers[0]).not.toContain("synthetic-raw-account-id");
  });
});
