import { NextResponse } from "next/server";

import { amenityErrorResponse, requireAmenityScope } from "@/lib/server/amenity-api";
import { normalizeUpload, storeMedia } from "@/lib/server/media";
import { MAX_MEDIA_BYTES } from "@/lib/validation/amenities";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ amenityId: string }> };

/** Adds one photo to an amenity's gallery. Manager or Bundleen admin only. */
export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  const { amenityId } = await context.params;
  const gate = await requireAmenityScope(amenityId, "manage", "media");
  if (!gate.ok) return gate.response;

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    return NextResponse.json({ error: "Expected multipart/form-data." }, { status: 415 });
  }

  // Refused on the declared length before anything is buffered.
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
      owner: { kind: "amenity_gallery", amenityId },
      image: normalized.image,
    });
    return NextResponse.json(
      { mediaId, url: `/api/hoa/amenities/media/${mediaId}` },
      { status: 201 },
    );
  } catch (error) {
    return amenityErrorResponse("gallery upload", error);
  }
}
