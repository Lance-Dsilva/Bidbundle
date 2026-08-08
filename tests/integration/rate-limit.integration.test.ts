import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  consumeRateLimit,
  RATE_LIMITS,
  resetRateLimiterCache,
} from "@/lib/server/rate-limit";

/**
 * Exercises the real Upstash limiter.
 *
 * Every test uses a fresh random identifier, so the suite costs a few dozen
 * Redis commands rather than burning a shared bucket, and repeated runs never
 * interfere with each other. Skipped entirely when the credentials are absent.
 */

const configured = Boolean(
  (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) ||
    (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN),
);

const suite = configured ? describe : describe.skip;

if (!configured) {
  console.warn(
    "[integration] Skipping Upstash tests: neither a complete UPSTASH_REDIS_REST_* nor KV_REST_API_* credential pair is set.",
  );
}

/** A per-test identifier, so no run inherits another's counters. */
function freshIdentifier(): string {
  return `itest-${randomUUID()}`;
}

suite("Upstash rate limiter (live)", () => {
  beforeAll(() => {
    process.env.RATE_LIMIT_IDENTIFIER_SECRET ??= "integration-test-secret";
    resetRateLimiterCache();
  });

  afterAll(() => {
    resetRateLimiterCache();
  });

  it("allows every request below the registration threshold", async () => {
    const id = freshIdentifier();

    for (let attempt = 1; attempt <= RATE_LIMITS.register.attempts; attempt += 1) {
      const decision = await consumeRateLimit("register", id);
      expect(decision.success).toBe(true);
      expect(decision.remaining).toBe(RATE_LIMITS.register.attempts - attempt);
    }
  });

  it("blocks the request past the registration threshold with a usable Retry-After", async () => {
    const id = freshIdentifier();

    for (let attempt = 0; attempt < RATE_LIMITS.register.attempts; attempt += 1) {
      await consumeRateLimit("register", id);
    }

    const blocked = await consumeRateLimit("register", id);
    expect(blocked.success).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(Number.isInteger(blocked.retryAfterSeconds)).toBe(true);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    expect(blocked.retryAfterSeconds).toBeLessThanOrEqual(15 * 60);
  });

  it("keeps distinct profile identifiers independent", async () => {
    const first = freshIdentifier();
    const second = freshIdentifier();

    for (let attempt = 0; attempt <= RATE_LIMITS.register.attempts; attempt += 1) {
      await consumeRateLimit("register", first);
    }

    expect((await consumeRateLimit("register", first)).success).toBe(false);
    expect((await consumeRateLimit("register", second)).success).toBe(true);
  });

  it("reports a reset timestamp in the future", async () => {
    const decision = await consumeRateLimit("register", freshIdentifier());
    expect(decision.reset).toBeGreaterThan(Date.now());
    expect(decision.reset).toBeLessThanOrEqual(Date.now() + 16 * 60_000);
  });
});
