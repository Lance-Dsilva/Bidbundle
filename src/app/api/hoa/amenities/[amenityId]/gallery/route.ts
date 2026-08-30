import { NextResponse } from "next/server";

import {
  amenityErrorResponse,
  readAmenityBody,
  requireAmenityScope,
  validationErrorResponse,
} from "@/lib/server/amenity-api";
import { reorderGallery, setCoverPhoto } from "@/lib/server/amenities";
import {
  amenityCoverSchema,
  amenityGalleryOrderSchema,
} from "@/lib/validation/amenities";
import { fieldErrors } from "@/lib/validation/profile";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ amenityId: string }> };

/** Reorders the gallery (`mediaIds`) or sets the cover photo (`mediaId`). */
export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  const { amenityId } = await context.params;
  const gate = await requireAmenityScope(amenityId, "manage", "mutation");
  if (!gate.ok) return gate.response;

  const body = await readAmenityBody(request);
  if (!body.ok) return body.response;

  const asCover = amenityCoverSchema.safeParse(body.value);
  if (asCover.success) {
    try {
      await setCoverPhoto(gate.scope, amenityId, asCover.data.mediaId);
      return NextResponse.json({ ok: true });
    } catch (error) {
      return amenityErrorResponse("cover photo", error);
    }
  }

  const asOrder = amenityGalleryOrderSchema.safeParse(body.value);
  if (!asOrder.success) return validationErrorResponse(fieldErrors(asOrder.error));

  try {
    await reorderGallery(gate.scope, amenityId, asOrder.data.mediaIds);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return amenityErrorResponse("gallery order", error);
  }
}
