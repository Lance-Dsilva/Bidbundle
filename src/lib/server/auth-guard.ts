import "server-only";

import { NextResponse } from "next/server";

import {
  consumeRateLimit,
  RateLimiterUnavailableError,
  buildIdentifier,
  isRedisConfigured,
} from "@/lib/server/rate-limit";

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
export async function guardRegistration(userId: string): Promise<GuardFailure | null> {
  if (!isRedisConfigured()) {
    if (requiresRateLimiter()) return { kind: "unavailable" };
    warnLimiterMissingOnce();
    return null;
  }

  try {
    // Clerk has already authenticated this request. Limiting by account keeps
    // retries from one signup isolated from everyone sharing the same home,
    // office, mobile-carrier, or preview-deployment IP address.
    const decision = await consumeRateLimit(
      "register",
      buildIdentifier(["profile-setup-v2", userId]),
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

/**
 * Applies a per-admin limiter to internal-portal writes.
 *
 * Keyed on the Bundleen account rather than the IP: staff share offices and
 * VPN exits, and one admin's backlog must not lock out a colleague.
 */
export async function guardAdminMutation(userId: string): Promise<GuardFailure | null> {
  if (!isRedisConfigured()) {
    if (requiresRateLimiter()) return { kind: "unavailable" };
    warnLimiterMissingOnce();
    return null;
  }

  try {
    const decision = await consumeRateLimit(
      "adminMutation",
      buildIdentifier(["admin-mutation", userId]),
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
