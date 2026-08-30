import { NextResponse } from "next/server";

import { amenityErrorResponse, requireViewerScope } from "@/lib/server/amenity-api";
import { db } from "@/lib/server/db";
import { normalizeUpload, storeMedia } from "@/lib/server/media";
import { MAX_MEDIA_BYTES } from "@/lib/validation/amenities";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ reviewId: string }> };

/** Attaches a photo to the caller's own review. */
export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  const { reviewId } = await context.params;

  const review = await db.amenityReview.findUnique({
    where: { id: reviewId },
    select: { communityId: true, authorUserId: true, status: true },
  });
  if (!review || review.status !== "published") {
    return NextResponse.json({ error: "That review was not found." }, { status: 404 });
  }

  const gate = await requireViewerScope(review.communityId, "media");
  if (!gate.ok) return gate.response;

  // Only the author. A manager may respond to a review; they may not decorate
  // it with photographs of their own.
  if (review.authorUserId !== gate.scope.userId) {
    return NextResponse.json({ error: "That review was not found." }, { status: 404 });
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    return NextResponse.json({ error: "Expected multipart/form-data." }, { status: 415 });
  }

  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_MEDIA_BYTES + 16 * 1024) {
    return NextResponse.json({ error: "That image is too large." }, { status: 413 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Could not read the upload." }, { status: 400 });
  }

  const normalized = await normalizeUpload(form.get("file"));
  if (!normalized.ok) {
    return NextResponse.json(
      { error: normalized.rejection.message },
      { status: normalized.rejection.reason === "too-large" ? 413 : 400 },
    );
  }

  try {
    const mediaId = await storeMedia({
      communityId: gate.scope.communityId,
      uploaderUserId: gate.scope.userId,
      owner: { kind: "amenity_review", reviewId },
      image: normalized.image,
    });
    return NextResponse.json(
      { mediaId, url: `/api/hoa/amenities/media/${mediaId}` },
      { status: 201 },
    );
  } catch (error) {
    return amenityErrorResponse("review photo", error);
  }
}
