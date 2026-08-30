import { NextResponse } from "next/server";

import {
  amenityErrorResponse,
  readCommunityId,
  requireManagerScope,
} from "@/lib/server/amenity-api";
import { getManagerAmenityWorkspace } from "@/lib/server/amenities";

export const runtime = "nodejs";

/** The "Amenities & spaces" dashboard for one HOA. */
export async function GET(request: Request): Promise<NextResponse> {
  const community = readCommunityId(request);
  if (!community.ok) return community.response;

  const gate = await requireManagerScope(community.communityId, "none");
  if (!gate.ok) return gate.response;

  try {
    return NextResponse.json(await getManagerAmenityWorkspace(gate.scope));
  } catch (error) {
    return amenityErrorResponse("manager workspace", error);
  }
}
