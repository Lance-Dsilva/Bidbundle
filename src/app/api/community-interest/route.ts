import { NextResponse } from "next/server";

import { submitCommunityInterest } from "@/lib/server/community-interest";
import { COMMUNITY_INTEREST_UNAVAILABLE, guardCommunityInterest } from "@/lib/server/community-interest-guard";
import { readJsonBody, validationErrorResponse } from "@/lib/server/profile";
import { communityInterestSchema, MAX_COMMUNITY_INTEREST_BODY_BYTES } from "@/lib/validation/community-interest";
import { fieldErrors } from "@/lib/validation/profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function noStore(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "no-store");
  return response;
}

/** Public intake, never a public lead read or account/permission mutation. */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    const failure = await guardCommunityInterest(request);
    if (failure) return noStore(NextResponse.json({ error: failure.error }, {
      status: failure.status,
      ...(failure.retryAfterSeconds !== undefined ? { headers: { "Retry-After": String(failure.retryAfterSeconds) } } : {}),
    }));
    const body = await readJsonBody(request, MAX_COMMUNITY_INTEREST_BODY_BYTES);
    if (!body.ok) return noStore(body.response);
    const parsed = communityInterestSchema.safeParse(body.value);
    if (!parsed.success) return noStore(validationErrorResponse(fieldErrors(parsed.error)));
    await submitCommunityInterest(parsed.data);
    // Identical status and shape for a new lead and an existing dedupe pair.
    return noStore(NextResponse.json({ received: true }, { status: 201 }));
  } catch {
    // Driver messages can contain contact data. Do not log or serialize them.
    return noStore(NextResponse.json({ error: COMMUNITY_INTEREST_UNAVAILABLE }, { status: 503 }));
  }
}
