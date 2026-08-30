import { NextResponse } from "next/server";

import {
  amenityErrorResponse,
  readAmenityBody,
  requireManagerScope,
  validationErrorResponse,
} from "@/lib/server/amenity-api";
import { respondToReview } from "@/lib/server/amenity-reviews";
import { db } from "@/lib/server/db";
import { reviewResponseSchema } from "@/lib/validation/amenities";
import { fieldErrors } from "@/lib/validation/profile";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ reviewId: string }> };

/**
 * The manager's labelled reply to a resident review.
 *
 * There is no sibling route that edits or deletes the review itself, by
 * design: a manager who can silently remove criticism makes every remaining
 * rating meaningless.
 */
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
  const parsed = reviewResponseSchema.safeParse(body.value);
  if (!parsed.success) return validationErrorResponse(fieldErrors(parsed.error));

  try {
    await respondToReview(gate.scope, reviewId, parsed.data.body);
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    return amenityErrorResponse("review response", error);
  }
}
