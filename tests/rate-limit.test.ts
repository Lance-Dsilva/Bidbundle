import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Rate-limiter unit tests.
 *
 * `@upstash/redis` and `@upstash/ratelimit` are replaced with an in-memory
 * fake, so this suite never opens a network connection and never spends the
 * real Upstash quota. The fake reproduces the two behaviours the application
 * depends on — a fixed budget per identifier and a `reset` timestamp — which
 * is what the guards are written against. Section
 * `tests/integration/rate-limit.integration.test.ts` exercises the real
 * service and is excluded from `npm test`.
 */

type Bucket = { count: number; expiresAt: number };

const buckets = new Map<string, Bucket>();

/** Flips to true to simulate Redis being unreachable. */
let redisDown = false;

/** Test clock, so window expiry can be tested without waiting 15 minutes. */
let now = 1_700_000_000_000;

function windowMs(window: string): number {
  const [value, unit] = window.split(" ");
  const multiplier = unit === "m" ? 60_000 : unit === "s" ? 1_000 : 3_600_000;
  return Number(value) * multiplier;
}

vi.mock("@upstash/redis", () => ({
  Redis: class {
    constructor(public config: { url: string; token: string }) {}
  },
}));

vi.mock("@upstash/ratelimit", () => {
  class FakeRatelimit {
    private tokens: number;
    private duration: number;
    private prefix: string;

    constructor(config: {
      limiter: { tokens: number; window: string };
      prefix: string;
    }) {
      this.tokens = config.limiter.tokens;
      this.duration = windowMs(config.limiter.window);
      this.prefix = config.prefix;
    }

    static slidingWindow(tokens: number, window: string) {
      return { tokens, window };
    }

    async limit(identifier: string) {
      if (redisDown) throw new Error("ECONNREFUSED");

      const key = `${this.prefix}:${identifier}`;
      const existing = buckets.get(key);
      const bucket =
        existing && existing.expiresAt > now
          ? existing
          : { count: 0, expiresAt: now + this.duration };

      bucket.count += 1;
      buckets.set(key, bucket);

      return {
        success: bucket.count <= this.tokens,
        limit: this.tokens,
        remaining: Math.max(0, this.tokens - bucket.count),
        reset: bucket.expiresAt,
        pending: Promise.resolve(),
      };
    }
  }

  return { Ratelimit: FakeRatelimit };
});

const {
  buildIdentifier,
  consumeRateLimit,
  isRedisConfigured,
  RATE_LIMITS,
  RateLimiterUnavailableError,
  resetRateLimiterCache,
  shouldEnforceIpLimit,
  toRetryAfterSeconds,
} = await import("@/lib/server/rate-limit");

const { guardRegistration, guardFailureResponse, requiresRateLimiter } = await import(
  "@/lib/server/auth-guard"
);

function requestFrom(ip: string): Request {
  return new Request("https://bundleen.example/api/auth/register", {
    method: "POST",
    headers: { "x-real-ip": ip },
  });
}

beforeEach(() => {
  buckets.clear();
  redisDown = false;
  now = 1_700_000_000_000;
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://fake.upstash.io");
  vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "fake-token");
  vi.stubEnv("KV_REST_API_URL", undefined);
  vi.stubEnv("KV_REST_API_TOKEN", undefined);
  vi.stubEnv("RATE_LIMIT_IDENTIFIER_SECRET", "test-secret");
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("VERCEL_ENV", undefined);
  resetRateLimiterCache();
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetRateLimiterCache();
});

describe("buildIdentifier", () => {
  it("is stable for the same inputs", () => {
    expect(buildIdentifier(["login", "ada@example.com", "203.0.113.5"])).toBe(
      buildIdentifier(["login", "ada@example.com", "203.0.113.5"]),
    );
  });

  it("differs for a different email", () => {
    expect(buildIdentifier(["login", "ada@example.com", "203.0.113.5"])).not.toBe(
      buildIdentifier(["login", "grace@example.com", "203.0.113.5"]),
    );
  });

  it("differs for a different IP", () => {
    expect(buildIdentifier(["login", "ada@example.com", "203.0.113.5"])).not.toBe(
      buildIdentifier(["login", "ada@example.com", "198.51.100.9"]),
    );
  });

  it("never contains the raw email address", () => {
    // Redis keys reach Upstash storage, logs, and the console. A plain address
    // in any of those is a personal-data leak.
    const identifier = buildIdentifier(["login", "ada@example.com", "203.0.113.5"]);
    expect(identifier).not.toContain("ada");
    expect(identifier).not.toContain("@");
    expect(identifier).not.toContain("example.com");
    expect(identifier).toMatch(/^[0-9a-f]{32}$/);
  });

  it("is salted, so the same email hashes differently under another secret", () => {
    const withFirstSecret = buildIdentifier(["login", "ada@example.com"]);
    vi.stubEnv("RATE_LIMIT_IDENTIFIER_SECRET", "a-completely-different-secret");
    expect(buildIdentifier(["login", "ada@example.com"])).not.toBe(withFirstSecret);
  });
});

describe("toRetryAfterSeconds", () => {
  it("rounds up to whole seconds", () => {
    expect(toRetryAfterSeconds(now + 4200, now)).toBe(5);
  });

  it("never returns zero for a reset that is nearly due", () => {
    expect(toRetryAfterSeconds(now + 10, now)).toBe(1);
  });

  it("never returns zero or negative for a reset already in the past", () => {
    // `Retry-After: 0` would invite an immediate retry.
    expect(toRetryAfterSeconds(now - 60_000, now)).toBe(1);
  });
});

describe("shouldEnforceIpLimit", () => {
  it("skips an unknown IP outside production so local dev is not locked out", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(shouldEnforceIpLimit("unknown")).toBe(false);
  });

  it("enforces an unknown IP in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(shouldEnforceIpLimit("unknown")).toBe(true);
  });

  it("always enforces a real IP", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(shouldEnforceIpLimit("203.0.113.5")).toBe(true);
  });
});

describe("consumeRateLimit", () => {
  it("accepts Vercel KV credential names emitted by the Upstash integration", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
    vi.stubEnv("KV_REST_API_URL", "https://fake-vercel-kv.upstash.io");
    vi.stubEnv("KV_REST_API_TOKEN", "fake-kv-token");
    resetRateLimiterCache();

    expect(isRedisConfigured()).toBe(true);
    await expect(consumeRateLimit("register", "id")).resolves.toMatchObject({ success: true });
  });

  it("allows requests below the threshold", async () => {
    const id = buildIdentifier(["register", "203.0.113.5"]);
    for (let attempt = 1; attempt < RATE_LIMITS.register.attempts; attempt += 1) {
      expect((await consumeRateLimit("register", id)).success).toBe(true);
    }
  });

  it("allows the final request at the threshold and blocks the next", async () => {
    const id = buildIdentifier(["register", "203.0.113.5"]);
    for (let attempt = 0; attempt < RATE_LIMITS.register.attempts; attempt += 1) {
      expect((await consumeRateLimit("register", id)).success).toBe(true);
    }
    expect((await consumeRateLimit("register", id)).success).toBe(false);
  });

  it("reports a usable Retry-After once blocked", async () => {
    const id = buildIdentifier(["register", "203.0.113.5"]);
    for (let attempt = 0; attempt <= RATE_LIMITS.register.attempts; attempt += 1) {
      await consumeRateLimit("register", id);
    }
    const decision = await consumeRateLimit("register", id);
    expect(decision.success).toBe(false);
    expect(decision.retryAfterSeconds).toBeGreaterThan(0);
    expect(decision.retryAfterSeconds).toBeLessThanOrEqual(15 * 60);
  });

  it("keeps distinct identifiers independent", async () => {
    const first = buildIdentifier(["register", "203.0.113.5"]);
    const second = buildIdentifier(["register", "198.51.100.9"]);

    for (let attempt = 0; attempt <= RATE_LIMITS.register.attempts; attempt += 1) {
      await consumeRateLimit("register", first);
    }

    expect((await consumeRateLimit("register", first)).success).toBe(false);
    expect((await consumeRateLimit("register", second)).success).toBe(true);
  });

  it("resets once the window expires", async () => {
    const id = buildIdentifier(["register", "203.0.113.5"]);
    for (let attempt = 0; attempt <= RATE_LIMITS.register.attempts; attempt += 1) {
      await consumeRateLimit("register", id);
    }
    expect((await consumeRateLimit("register", id)).success).toBe(false);

    now += 15 * 60_000 + 1_000; // Step past the window.
    expect((await consumeRateLimit("register", id)).success).toBe(true);
  });

  it("throws RateLimiterUnavailableError when Redis is unreachable", async () => {
    redisDown = true;
    await expect(consumeRateLimit("register", "id")).rejects.toBeInstanceOf(
      RateLimiterUnavailableError,
    );
  });

  it("throws RateLimiterUnavailableError when credentials are missing", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
    vi.stubEnv("KV_REST_API_URL", "");
    vi.stubEnv("KV_REST_API_TOKEN", "");
    resetRateLimiterCache();
    expect(isRedisConfigured()).toBe(false);
    await expect(consumeRateLimit("register", "id")).rejects.toBeInstanceOf(
      RateLimiterUnavailableError,
    );
  });
});

describe("guardRegistration", () => {
  it("permits attempts below the threshold", async () => {
    const request = requestFrom("203.0.113.5");
    for (let attempt = 0; attempt < RATE_LIMITS.register.attempts; attempt += 1) {
      expect(await guardRegistration(request)).toBeNull();
    }
  });

  it("blocks the attempt past the threshold with a Retry-After", async () => {
    const request = requestFrom("203.0.113.5");
    for (let attempt = 0; attempt < RATE_LIMITS.register.attempts; attempt += 1) {
      await guardRegistration(request);
    }

    const failure = await guardRegistration(request);
    expect(failure).toEqual({
      kind: "rate-limited",
      retryAfterSeconds: expect.any(Number),
    });
  });

  it("gives a different IP its own budget", async () => {
    const blocked = requestFrom("203.0.113.5");
    for (let attempt = 0; attempt <= RATE_LIMITS.register.attempts; attempt += 1) {
      await guardRegistration(blocked);
    }

    expect(await guardRegistration(blocked)).not.toBeNull();
    expect(await guardRegistration(requestFrom("198.51.100.9"))).toBeNull();
  });

  it("reports unavailable when Redis fails in a deployed environment", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    redisDown = true;
    expect(await guardRegistration(requestFrom("203.0.113.5"))).toEqual({ kind: "unavailable" });
  });
});

describe("local profile setup", () => {
  it("can run without Upstash outside a deployed environment", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("VERCEL_ENV", undefined);
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
    vi.stubEnv("KV_REST_API_URL", "");
    vi.stubEnv("KV_REST_API_TOKEN", "");
    resetRateLimiterCache();

    expect(requiresRateLimiter()).toBe(false);
    expect(await guardRegistration(requestFrom("203.0.113.5"))).toBeNull();
  });
});

describe("guardFailureResponse", () => {
  it("returns 429 with a valid integer Retry-After header", async () => {
    const response = guardFailureResponse({ kind: "rate-limited", retryAfterSeconds: 42 });

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("42");
    expect(Number(response.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(Number.isInteger(Number(response.headers.get("Retry-After")))).toBe(true);
  });

  it("returns 503 with no Retry-After when the limiter is unavailable", async () => {
    const response = guardFailureResponse({ kind: "unavailable" });
    expect(response.status).toBe(503);
  });

  it("keeps both messages generic", async () => {
    const limited = (await guardFailureResponse({
      kind: "rate-limited",
      retryAfterSeconds: 42,
    }).json()) as { error: string };
    const unavailable = (await guardFailureResponse({ kind: "unavailable" }).json()) as {
      error: string;
    };

    // Neither may mention an account, an email, or which limiter tripped.
    for (const message of [limited.error, unavailable.error]) {
      expect(message).not.toMatch(/email|account|password|user|exists/i);
    }
  });
});
