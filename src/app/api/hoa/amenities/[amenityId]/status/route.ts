import { NextResponse } from "next/server";

import {
  amenityErrorResponse,
  readAmenityBody,
  requireAmenityScope,
  validationErrorResponse,
} from "@/lib/server/amenity-api";
import { setAmenityStatus } from "@/lib/server/amenities";
import { amenityStatusSchema } from "@/lib/validation/amenities";
import { fieldErrors } from "@/lib/validation/profile";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ amenityId: string }> };

/** Publishes, unpublishes, or archives an amenity. */
export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  const { amenityId } = await context.params;
  const gate = await requireAmenityScope(amenityId, "manage", "mutation");
  if (!gate.ok) return gate.response;

  const body = await readAmenityBody(request);
  if (!body.ok) return body.response;
  const parsed = amenityStatusSchema.safeParse(body.value);
  if (!parsed.success) return validationErrorResponse(fieldErrors(parsed.error));

  try {
    await setAmenityStatus(gate.scope, amenityId, parsed.data.status);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return amenityErrorResponse("amenity status", error);
  }
}
