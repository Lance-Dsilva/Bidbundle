import { NextResponse } from "next/server";

import {
  amenityErrorResponse,
  readAmenityBody,
  readCommunityId,
  requireManagerScope,
  validationErrorResponse,
} from "@/lib/server/amenity-api";
import { sendAmenityBroadcast } from "@/lib/server/amenity-communications";
import { amenityBroadcastSchema } from "@/lib/validation/amenities";
import { fieldErrors } from "@/lib/validation/profile";

export const runtime = "nodejs";

/**
 * Previews, tests, or sends one HOA-scoped amenity message.
 *
 * The audience is resolved from `communityId` and the manager's own scope. It
 * has no segment parameter and no path to the global broadcast audience.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const community = readCommunityId(request);
  if (!community.ok) return community.response;

  const gate = await requireManagerScope(community.communityId, "broadcast");
  if (!gate.ok) return gate.response;

  const body = await readAmenityBody(request);
  if (!body.ok) return body.response;
  const parsed = amenityBroadcastSchema.safeParse(body.value);
  if (!parsed.success) return validationErrorResponse(fieldErrors(parsed.error));

  const amenityId = new URL(request.url).searchParams.get("amenityId");

  try {
    return NextResponse.json(
      await sendAmenityBroadcast(gate.scope, amenityId, parsed.data),
    );
  } catch (error) {
    return amenityErrorResponse("amenity broadcast", error);
  }
}
