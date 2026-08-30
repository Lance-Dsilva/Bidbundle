import { NextResponse } from "next/server";

import {
  amenityErrorResponse,
  readAmenityBody,
  requireViewerScope,
  validationErrorResponse,
} from "@/lib/server/amenity-api";
import { deleteOwnReview, updateReview } from "@/lib/server/amenity-reviews";
import { db } from "@/lib/server/db";
import { amenityReviewSchema } from "@/lib/validation/amenities";
import { fieldErrors } from "@/lib/validation/profile";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ reviewId: string }> };

async function communityOf(reviewId: string): Promise<string | null> {
  const review = await db.amenityReview.findUnique({
    where: { id: reviewId },
    select: { communityId: true },
  });
  return review?.communityId ?? null;
}

/** Edits the caller's own review. A manager cannot reach this path. */
export async function PATCH(request: Request, context: RouteContext): Promise<NextResponse> {
  const { reviewId } = await context.params;
  const communityId = await communityOf(reviewId);
  if (!communityId) {
    return NextResponse.json({ error: "That review was not found." }, { status: 404 });
  }

  const gate = await requireViewerScope(communityId, "mutation");
  if (!gate.ok) return gate.response;

  const body = await readAmenityBody(request);
  if (!body.ok) return body.response;
  const parsed = amenityReviewSchema.safeParse(body.value);
  if (!parsed.success) return validationErrorResponse(fieldErrors(parsed.error));

  try {
    await updateReview(gate.scope, reviewId, parsed.data);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return amenityErrorResponse("review update", error);
  }
}

export async function DELETE(_request: Request, context: RouteContext): Promise<NextResponse> {
  const { reviewId } = await context.params;
  const communityId = await communityOf(reviewId);
  if (!communityId) return NextResponse.json({ ok: true });

  const gate = await requireViewerScope(communityId, "mutation");
  if (!gate.ok) return gate.response;

  try {
    await deleteOwnReview(gate.scope, reviewId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return amenityErrorResponse("review removal", error);
  }
}
