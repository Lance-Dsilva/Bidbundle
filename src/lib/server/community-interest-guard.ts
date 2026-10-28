import "server-only";

import { requiresRateLimiter } from "@/lib/server/auth-guard";
import { getRequestIp } from "@/lib/server/request-ip";
import { buildIdentifier, consumeRateLimit, isRedisConfigured } from "@/lib/server/rate-limit";

export type CommunityInterestGuardFailure = { status: 403 | 429 | 503; error: string; retryAfterSeconds?: number };
export const COMMUNITY_INTEREST_UNAVAILABLE = "We could not receive your community interest. Please try again shortly.";

/** Anonymous intake protection only; no contact field can confer authority. */
export async function guardCommunityInterest(request: Request): Promise<CommunityInterestGuardFailure | null> {
  const origin = request.headers.get("origin");
  const site = request.headers.get("sec-fetch-site");
  if ((origin !== null && origin !== new URL(request.url).origin) ||
      (site !== null && site !== "same-origin" && site !== "none")) {
    return { status: 403, error: "Submit community interest from this site." };
  }
  if (!isRedisConfigured()) {
    // Like existing guards, bare local development may run without Redis.
    // Production and every Vercel environment, including Preview, fail closed.
    return requiresRateLimiter() ? { status: 503, error: COMMUNITY_INTEREST_UNAVAILABLE } : null;
  }
  if (!process.env.RATE_LIMIT_IDENTIFIER_SECRET?.trim()) {
    return { status: 503, error: COMMUNITY_INTEREST_UNAVAILABLE };
  }
  try {
    const decision = await consumeRateLimit("communityInterest", buildIdentifier(["community-interest-v1", getRequestIp(request)]));
    return decision.success ? null : {
      status: 429,
      error: "Too many submissions. Please try again later.",
      retryAfterSeconds: decision.retryAfterSeconds,
    };
  } catch {
    return { status: 503, error: COMMUNITY_INTEREST_UNAVAILABLE };
  }
}
