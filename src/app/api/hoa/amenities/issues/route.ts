import { NextResponse } from "next/server";

import {
  amenityErrorResponse,
  readCommunityId,
  requireViewerScope,
} from "@/lib/server/amenity-api";
import { listHoaIssues, listMyIssues } from "@/lib/server/amenity-issues";

export const runtime = "nodejs";

/**
 * The caller's own reports, or — for scoped staff — the HOA's queue.
 *
 * Which one is returned is decided by the resolved scope, not by a query
 * parameter, so a resident cannot ask for the queue.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const community = readCommunityId(request);
  if (!community.ok) return community.response;

  const gate = await requireViewerScope(community.communityId);
  if (!gate.ok) return gate.response;

  try {
    const issues = gate.scope.canManage
      ? await listHoaIssues(gate.scope)
      : await listMyIssues(gate.scope);
    return NextResponse.json({ issues, queue: gate.scope.canManage });
  } catch (error) {
    return amenityErrorResponse("issue list", error);
  }
}
