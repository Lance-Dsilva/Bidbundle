import { NextResponse } from "next/server";

import { getOnboardingCoverage } from "@/lib/server/onboarding-coverage";
import { COVERAGE_UNAVAILABLE_MESSAGE, guardOnboardingCoverage } from "@/lib/server/onboarding-coverage-guard";
import { readJsonBody } from "@/lib/server/profile";
import { MAX_COVERAGE_BODY_BYTES, onboardingCoverageSchema } from "@/lib/validation/onboarding-coverage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function noStore(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "no-store");
  return response;
}

/** Public, bounded availability read before Clerk account creation. */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    const failure = await guardOnboardingCoverage(request);
    if (failure) {
      return noStore(NextResponse.json({ error: failure.error }, {
        status: failure.status,
        ...(failure.retryAfterSeconds !== undefined
          ? { headers: { "Retry-After": String(failure.retryAfterSeconds) } }
          : {}),
      }));
    }
    const body = await readJsonBody(request, MAX_COVERAGE_BODY_BYTES);
    if (!body.ok) return noStore(body.response);
    const parsed = onboardingCoverageSchema.safeParse(body.value);
    if (!parsed.success) {
      return noStore(NextResponse.json({ error: "Choose a valid address location to check coverage." }, { status: 400 }));
    }
    return noStore(NextResponse.json({ coverage: await getOnboardingCoverage(parsed.data) }));
  } catch {
    return noStore(NextResponse.json({ error: COVERAGE_UNAVAILABLE_MESSAGE }, { status: 503 }));
  }
}
