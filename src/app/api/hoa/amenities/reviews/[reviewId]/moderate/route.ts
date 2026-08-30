import { NextResponse } from "next/server";

import {
  amenityErrorResponse,
  readAmenityBody,
  requireManagerScope,
  validationErrorResponse,
} from "@/lib/server/amenity-api";
import { moderateReview } from "@/lib/server/amenity-reviews";
import { db } from "@/lib/server/db";
import { reviewModerationSchema } from "@/lib/validation/amenities";
import { fieldErrors } from "@/lib/validation/profile";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ reviewId: string }> };

/** Bundleen-admin moderation. The service refuses a non-admin scope. */
export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  const { reviewId } = await context.params;
  const review = await db.amenityReview.findUnique({
    where: { id: reviewId },
    select: { communityId: true },
  });
  if (!review) {
    return NextResponse.json({ error: "That review was not found." }, { status: 404 });
  }

  const gate = await requireManagerScope(review.communityId);
  if (!gate.ok) return gate.response;

  const body = await readAmenityBody(request);
  if (!body.ok) return body.response;
  const parsed = reviewModerationSchema.safeParse(body.value);
  if (!parsed.success) return validationErrorResponse(fieldErrors(parsed.error));

  try {
    await moderateReview(gate.scope, reviewId, parsed.data.reason);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return amenityErrorResponse("review moderation", error);
  }
}
