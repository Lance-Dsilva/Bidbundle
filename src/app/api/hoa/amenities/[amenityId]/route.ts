import { NextResponse } from "next/server";

import {
  amenityErrorResponse,
  readAmenityBody,
  requireAmenityScope,
  validationErrorResponse,
} from "@/lib/server/amenity-api";
import { getAmenityDetail, updateAmenity } from "@/lib/server/amenities";
import { amenityUpdateSchema } from "@/lib/validation/amenities";
import { fieldErrors } from "@/lib/validation/profile";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ amenityId: string }> };

export async function GET(_request: Request, context: RouteContext): Promise<NextResponse> {
  const { amenityId } = await context.params;
  const gate = await requireAmenityScope(amenityId, "view");
  if (!gate.ok) return gate.response;

  try {
    return NextResponse.json(await getAmenityDetail(gate.scope, amenityId));
  } catch (error) {
    return amenityErrorResponse("amenity detail", error);
  }
}

export async function PATCH(request: Request, context: RouteContext): Promise<NextResponse> {
  const { amenityId } = await context.params;
  const gate = await requireAmenityScope(amenityId, "manage", "mutation");
  if (!gate.ok) return gate.response;

  const body = await readAmenityBody(request);
  if (!body.ok) return body.response;
  const parsed = amenityUpdateSchema.safeParse(body.value);
  if (!parsed.success) return validationErrorResponse(fieldErrors(parsed.error));

  try {
    await updateAmenity(gate.scope, amenityId, parsed.data);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return amenityErrorResponse("amenity update", error);
  }
}
