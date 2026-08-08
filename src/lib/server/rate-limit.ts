import "server-only";

import { createHash } from "node:crypto";

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

import { isUnknownIp } from "@/lib/server/request-ip";

/**
 * Upstash-backed protection for Bundleen-owned account/profile mutations.
 * Clerk independently protects its managed sign-in and sign-up endpoints.
 *
 * These thresholds are initial security defaults, not tuned values. They are
 * deliberately strict; revisit them once real traffic shows how often ordinary
 * users trip them (shared office NAT and mobile carrier CGNAT put many people
 * behind one address, which is the most likely source of false positives).
 */
export const RATE_LIMITS = {
  /** Per-IP Bundleen profile creation. */
  register: { attempts: 5, window: "15 m" },
  /** Per-user profile photo uploads. */
  avatarUpload: { attempts: 10, window: "1 h" },
} as const;

type LimiterName = keyof typeof RATE_LIMITS;

export class RateLimiterUnavailableError extends Error {
  constructor(message = "Rate limiter is unavailable.") {
    super(message);
    this.name = "RateLimiterUnavailableError";
  }
}

export type RateLimitDecision = {
  success: boolean;
  limit: number;
  remaining: number;
  /** Epoch milliseconds at which the window resets. */
  reset: number;
  /** Whole seconds until reset, floored at 1, for the `Retry-After` header. */
  retryAfterSeconds: number;
};

/**
 * Turns identifying limiter inputs into a stable, non-reversible bucket key.
 *
 * Redis keys end up in Upstash's storage, logs, and console, so the raw
 * address never goes in. The digest is salted with
 * `RATE_LIMIT_IDENTIFIER_SECRET` to stop an
 * attacker who reads the key space from confirming a guessed address by
 * hashing it themselves — an unsalted SHA-256 of an IP is trivially reversible
 * against the small IPv4 address space.
 */
export function buildIdentifier(parts: readonly string[]): string {
  const salt = process.env.RATE_LIMIT_IDENTIFIER_SECRET ?? "";
  return createHash("sha256").update(`${salt}:${parts.join("|")}`).digest("hex").slice(0, 32);
}

type RedisCredentials = {
  url: string;
  token: string;
};

/**
 * Supports both names emitted by a direct Upstash integration and the legacy
 * Vercel KV names that Vercel's Upstash Marketplace integration may inject.
 * A URL and token must come from the same pair so credentials from separate
 * resources cannot accidentally be combined.
 */
function getRedisCredentials(): RedisCredentials | null {
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    return {
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    };
  }

  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    return {
      url: process.env.KV_REST_API_URL,
      token: process.env.KV_REST_API_TOKEN,
    };
  }

  return null;
}

export function isRedisConfigured(): boolean {
  return getRedisCredentials() !== null;
}

let redisClient: Redis | null = null;
const limiterCache = new Map<LimiterName, Ratelimit>();

function getRedis(): Redis {
  const credentials = getRedisCredentials();

  if (!credentials) {
    throw new RateLimiterUnavailableError("Upstash Redis credentials are not configured.");
  }

  redisClient ??= new Redis(credentials);

  return redisClient;
}

function getLimiter(name: LimiterName): Ratelimit {
  const cached = limiterCache.get(name);
  if (cached) return cached;

  const { attempts, window } = RATE_LIMITS[name];

  const limiter = new Ratelimit({
    redis: getRedis(),
    // Sliding window rather than fixed: a fixed window lets an attacker send
    // `attempts` at the very end of one window and `attempts` again at the
    // start of the next, doubling the effective rate across the boundary.
    limiter: Ratelimit.slidingWindow(attempts, window),
    analytics: false,
    prefix: `bundleen:ratelimit:${name}`,
  });

  limiterCache.set(name, limiter);
  return limiter;
}

/** Test seam: drops the cached client so env changes take effect. */
export function resetRateLimiterCache(): void {
  redisClient = null;
  limiterCache.clear();
}

/**
 * Consumes one token from `name` for `identifier`.
 *
 * Throws {@link RateLimiterUnavailableError} when Redis is unreachable or
 * unconfigured. Callers must treat that as a hard failure rather than an
 * allow: swallowing it would leave the endpoint running with no brute-force
 * protection at exactly the moment an attacker is hammering it.
 */
export async function consumeRateLimit(
  name: LimiterName,
  identifier: string,
): Promise<RateLimitDecision> {
  let result: Awaited<ReturnType<Ratelimit["limit"]>>;

  try {
    result = await getLimiter(name).limit(identifier);
  } catch (error) {
    if (error instanceof RateLimiterUnavailableError) throw error;
    throw new RateLimiterUnavailableError("Rate limiter request failed.");
  }

  // `pending` covers Upstash's background bookkeeping. It is awaited so the
  // serverless function is not frozen mid-write, and its failure is ignored
  // because the limit decision above has already been made.
  await result.pending.catch(() => undefined);

  return {
    success: result.success,
    limit: result.limit,
    remaining: result.remaining,
    reset: result.reset,
    retryAfterSeconds: toRetryAfterSeconds(result.reset),
  };
}

/**
 * `Retry-After` must be a positive integer number of seconds. A reset that has
 * already passed, or is under a second away, still has to advertise at least
 * 1 — `Retry-After: 0` invites an immediate retry.
 */
export function toRetryAfterSeconds(resetEpochMs: number, nowMs: number = Date.now()): number {
  return Math.max(1, Math.ceil((resetEpochMs - nowMs) / 1000));
}

/**
 * Whether an IP-scoped limit should be enforced for this address.
 *
 * `next dev` provides no forwarding headers, so every local request would
 * collapse into one shared `unknown` bucket and lock the developer out after
 * five attempts. In production the platform always supplies an IP, so an
 * unknown value there means something is genuinely wrong and is still counted.
 */
export function shouldEnforceIpLimit(ip: string): boolean {
  return !isUnknownIp(ip) || process.env.NODE_ENV === "production";
}
