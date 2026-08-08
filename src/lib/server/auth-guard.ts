import "server-only";

import { NextResponse } from "next/server";

import {
  consumeRateLimit,
  RateLimiterUnavailableError,
  buildIdentifier,
  isRedisConfigured,
  shouldEnforceIpLimit,
} from "@/lib/server/rate-limit";
import { getRequestIp } from "@/lib/server/request-ip";

/**
 * Wording is identical for every failure mode a caller can trigger and never
 * exposes which profile-creation limit was reached.
 */
export const RATE_LIMITED_MESSAGE = "Too many attempts. Please try again later.";
export const SERVICE_UNAVAILABLE_MESSAGE =
  "Profile setup is temporarily unavailable. Please try again shortly.";

export type GuardFailure =
  | { kind: "rate-limited"; retryAfterSeconds: number }
  | { kind: "unavailable" };

/**
 * True when a missing rate limiter must block the request rather than be
 * shrugged off. Production-like environments have no excuse for an unset
 * Upstash credential; local development does, so it is allowed to proceed
 * without a limiter (loudly) to keep the app usable before the resource
 * exists.
 */
export function requiresRateLimiter(): boolean {
  return process.env.NODE_ENV === "production" || process.env.VERCEL_ENV !== undefined;
}

let missingLimiterWarned = false;

function warnLimiterMissingOnce(): void {
  if (missingLimiterWarned) return;
  missingLimiterWarned = true;
  console.warn(
    "[auth] Upstash Redis is not configured; profile setup rate limiting is DISABLED. " +
      "This is permitted in local development only.",
  );
}

/**
 * Applies the registration limiter.
 *
 * Returns `null` when the request may proceed, or a {@link GuardFailure}
 * describing why it may not.
 */
export async function guardRegistration(request: Request): Promise<GuardFailure | null> {
  const ip = getRequestIp(request);

  if (!isRedisConfigured()) {
    if (requiresRateLimiter()) return { kind: "unavailable" };
    warnLimiterMissingOnce();
    return null;
  }

  if (!shouldEnforceIpLimit(ip)) return null;

  try {
    const decision = await consumeRateLimit("register", buildIdentifier(["register", ip]));
    if (!decision.success) {
      return { kind: "rate-limited", retryAfterSeconds: decision.retryAfterSeconds };
    }
    return null;
  } catch (error) {
    if (error instanceof RateLimiterUnavailableError) return { kind: "unavailable" };
    throw error;
  }
}

/** Applies a per-account limiter to profile photo uploads. */
export async function guardAvatarUpload(userId: string): Promise<GuardFailure | null> {
  if (!isRedisConfigured()) {
    if (requiresRateLimiter()) return { kind: "unavailable" };
    warnLimiterMissingOnce();
    return null;
  }

  try {
    const decision = await consumeRateLimit(
      "avatarUpload",
      buildIdentifier(["avatar-upload", userId]),
    );
    if (!decision.success) {
      return { kind: "rate-limited", retryAfterSeconds: decision.retryAfterSeconds };
    }
    return null;
  } catch (error) {
    if (error instanceof RateLimiterUnavailableError) return { kind: "unavailable" };
    throw error;
  }
}

/** Builds the JSON `429`/`503` response for an API route handler. */
export function guardFailureResponse(failure: GuardFailure): NextResponse {
  if (failure.kind === "rate-limited") {
    return NextResponse.json(
      { error: RATE_LIMITED_MESSAGE },
      { status: 429, headers: { "Retry-After": String(failure.retryAfterSeconds) } },
    );
  }

  return NextResponse.json({ error: SERVICE_UNAVAILABLE_MESSAGE }, { status: 503 });
}
