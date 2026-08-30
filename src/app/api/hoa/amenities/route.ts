import { NextResponse } from "next/server";

import {
  amenityErrorResponse,
  readAmenityBody,
  readCommunityId,
  requireManagerScope,
  requireViewerScope,
  validationErrorResponse,
} from "@/lib/server/amenity-api";
import { createAmenity, getAmenityCatalog } from "@/lib/server/amenities";
import { amenityCreateSchema } from "@/lib/validation/amenities";
import { fieldErrors } from "@/lib/validation/profile";

export const runtime = "nodejs";

/** The resident catalog for one HOA. */
export async function GET(request: Request): Promise<NextResponse> {
  const community = readCommunityId(request);
  if (!community.ok) return community.response;

  const gate = await requireViewerScope(community.communityId);
  if (!gate.ok) return gate.response;

  try {
    return NextResponse.json(await getAmenityCatalog(gate.scope));
  } catch (error) {
    return amenityErrorResponse("catalog", error);
  }
}

/** Creates a draft amenity. Manager or Bundleen admin only. */
export async function POST(request: Request): Promise<NextResponse> {
  const community = readCommunityId(request);
  if (!community.ok) return community.response;

  const gate = await requireManagerScope(community.communityId);
  if (!gate.ok) return gate.response;

  const body = await readAmenityBody(request);
  if (!body.ok) return body.response;
  const parsed = amenityCreateSchema.safeParse(body.value);
  if (!parsed.success) return validationErrorResponse(fieldErrors(parsed.error));

  try {
    const amenityId = await createAmenity(gate.scope, parsed.data);
    return NextResponse.json({ amenityId }, { status: 201 });
  } catch (error) {
    return amenityErrorResponse("amenity creation", error);
  }
}
