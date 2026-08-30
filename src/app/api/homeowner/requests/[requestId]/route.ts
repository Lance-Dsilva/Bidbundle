import { NextResponse } from "next/server";

import { hoaErrorResponse, requireHoaUser } from "@/lib/server/hoa-api";
import { getNeighborhoodRequest } from "@/lib/server/neighborhood-market";

/**
 * One neighbourhood request, scoped to the caller.
 *
 * Membership of that exact neighbourhood is required for any of it. Bid
 * comparisons appear only for the manager, the requester, and neighbours who
 * joined; participant names only for the manager; exact stop locations only
 * for the resident of the stop.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ requestId: string }> };

export async function GET(_request: Request, context: RouteContext): Promise<NextResponse> {
  const gate = await requireHoaUser();
  if (!gate.ok) return gate.response;
  const { requestId } = await context.params;

  try {
    return NextResponse.json({
      request: await getNeighborhoodRequest(gate.user.id, requestId),
    });
  } catch (error) {
    return hoaErrorResponse("neighbourhood request", error);
  }
}
