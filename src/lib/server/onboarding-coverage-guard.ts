import "server-only";

import { requiresRateLimiter } from "@/lib/server/auth-guard";
import { getRequestIp } from "@/lib/server/request-ip";
import { buildIdentifier, consumeRateLimit, isRedisConfigured } from "@/lib/server/rate-limit";

export type CoverageGuardFailure = {
  status: 403 | 429 | 503;
  error: string;
  retryAfterSeconds?: number;
};

export const COVERAGE_UNAVAILABLE_MESSAGE = "We could not check neighborhood coverage. Please try again shortly.";

/** Anonymous read protection, not authentication or membership authority. */
export async function guardOnboardingCoverage(request: Request): Promise<CoverageGuardFailure | null> {
  const origin = request.headers.get("origin");
  const site = request.headers.get("sec-fetch-site");
  if ((origin !== null && origin !== new URL(request.url).origin) ||
      (site !== null && site !== "same-origin" && site !== "none")) {
    return { status: 403, error: "Check coverage from this site." };
  }

  if (!isRedisConfigured()) {
    // Match existing guards: bare local development may run without Redis.
    // Production and every Vercel environment, including Preview, fail closed.
    return requiresRateLimiter() ? { status: 503, error: COVERAGE_UNAVAILABLE_MESSAGE } : null;
  }
  // Never put an unsalted network identifier in the shared Redis key space,
  // including local development pointed at a real Redis resource.
  if (!process.env.RATE_LIMIT_IDENTIFIER_SECRET?.trim()) {
    return { status: 503, error: COVERAGE_UNAVAILABLE_MESSAGE };
  }

  try {
    const decision = await consumeRateLimit(
      "onboardingCoverage",
      buildIdentifier(["onboarding-coverage-v1", getRequestIp(request)]),
    );
    return decision.success ? null : {
      status: 429,
      error: "Too many coverage checks. Please try again later.",
      retryAfterSeconds: decision.retryAfterSeconds,
    };
  } catch {
    // No raw IPs, coordinates, provider errors or credentials enter logs/body.
    return { status: 503, error: COVERAGE_UNAVAILABLE_MESSAGE };
  }
}
