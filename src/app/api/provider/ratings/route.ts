import { NextResponse } from "next/server";

import { hoaErrorResponse } from "@/lib/server/hoa-api";
import { requireProviderConsole } from "@/lib/server/provider-api";
import { getProviderReviews } from "@/lib/server/provider-reviews";
import {
  MAX_REVIEW_PAGE_SIZE,
  REVIEW_PAGE_SIZE,
  readPagination,
} from "@/lib/validation/provider-console";

/**
 * This provider's own reviews, with the real average and distribution.
 *
 * Replaces `/provider/reviews`, which had no handler and whose response shape
 * the page then padded out with a hard-coded list of testimonials. The provider
 * is taken from the session — there is deliberately no `providerId` parameter,
 * because a review list keyed on a browser-supplied id is a public directory,
 * not a private console.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const gate = await requireProviderConsole();
  if (!gate.ok) return gate.response;

  const { limit, offset } = readPagination(new URL(request.url).searchParams, {
    limit: REVIEW_PAGE_SIZE,
    maxLimit: MAX_REVIEW_PAGE_SIZE,
  });

  try {
    return NextResponse.json(await getProviderReviews(gate.user.id, { limit, offset }));
  } catch (error) {
    return hoaErrorResponse("provider reviews", error);
  }
}
