import { NextResponse } from "next/server";

import { adminErrorResponse, requireAdmin } from "@/lib/server/admin-api";
import { listStaffCandidates } from "@/lib/server/communities";
import { COMMUNITY_STAFF_ROLES, type CommunityStaffRole } from "@/lib/validation/community";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ communityId: string }> };

/**
 * The accounts the portal may offer for a given role.
 *
 * The server decides eligibility, not the picker: asking for
 * `neighborhood_manager` returns only active residents of that community, so
 * the UI cannot present an ineligible person even by accident. Submitting one
 * anyway is still rejected by `assertCanAssignStaffRole`.
 */
export async function GET(request: Request, context: RouteContext): Promise<NextResponse> {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.response;

  const { communityId } = await context.params;
  const url = new URL(request.url);
  const requestedRole = url.searchParams.get("role") ?? "";

  if (!(COMMUNITY_STAFF_ROLES as readonly string[]).includes(requestedRole)) {
    return NextResponse.json({ error: "Choose a valid role." }, { status: 400 });
  }

  const search = (url.searchParams.get("search") ?? "").trim().slice(0, 120);

  try {
    const candidates = await listStaffCandidates(
      communityId,
      requestedRole as CommunityStaffRole,
      search,
    );
    return NextResponse.json({ candidates });
  } catch (error) {
    return adminErrorResponse("staff candidates", error);
  }
}
