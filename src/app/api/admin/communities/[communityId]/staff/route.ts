import { NextResponse } from "next/server";

import {
  adminErrorResponse,
  readAdminBody,
  requireAdminMutation,
  validationErrorResponse,
} from "@/lib/server/admin-api";
import { assignStaffRole, getCommunityDetail } from "@/lib/server/communities";
import { staffAssignSchema } from "@/lib/validation/community";
import { fieldErrors } from "@/lib/validation/profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ communityId: string }> };

/**
 * Assigns a scoped community role.
 *
 * The request names a person and a role and nothing else — the acting admin,
 * the timestamp, and whether the assignee is eligible all come from the server.
 * Replacing a sitting neighborhood manager requires `replaceExistingManager`,
 * and answers `409` without it.
 */
export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  const gate = await requireAdminMutation();
  if (!gate.ok) return gate.response;

  const { communityId } = await context.params;

  const body = await readAdminBody(request);
  if (!body.ok) return body.response;

  const parsed = staffAssignSchema.safeParse(body.value);
  if (!parsed.success) return validationErrorResponse(fieldErrors(parsed.error));

  try {
    const { replacedAssignmentId } = await assignStaffRole(gate.user, communityId, parsed.data);
    const detail = await getCommunityDetail(communityId);
    return NextResponse.json({ ...detail, replacedAssignmentId });
  } catch (error) {
    return adminErrorResponse("staff assign", error);
  }
}
