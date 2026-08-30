import { NextResponse } from "next/server";

import {
  amenityErrorResponse,
  readCommunityId,
  requireViewerScope,
} from "@/lib/server/amenity-api";
import { listMyUpcomingBookings } from "@/lib/server/amenities";

export const runtime = "nodejs";

/** The caller's own upcoming reservations in one HOA. */
export async function GET(request: Request): Promise<NextResponse> {
  const community = readCommunityId(request);
  if (!community.ok) return community.response;

  const gate = await requireViewerScope(community.communityId);
  if (!gate.ok) return gate.response;

  try {
    return NextResponse.json({ bookings: await listMyUpcomingBookings(gate.scope) });
  } catch (error) {
    return amenityErrorResponse("my bookings", error);
  }
}
