import { NextResponse } from "next/server";

import {
  adminErrorResponse,
  readAdminBody,
  requireAdminMutation,
  validationErrorResponse,
} from "@/lib/server/admin-api";
import { getCommunityDetail, updateMembership } from "@/lib/server/communities";
import { membershipUpdateSchema } from "@/lib/validation/community";
import { fieldErrors } from "@/lib/validation/profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ communityId: string; membershipId: string }> };

/**
 * Changes a membership's status.
 *
 * Ending an active residency also revokes any role that depended on it — the
 * neighborhood manager case — inside the same transaction, so the community
 * never sits in a state where its manager is not one of its residents.
 */
export async function PATCH(request: Request, context: RouteContext): Promise<NextResponse> {
  const gate = await requireAdminMutation();
  if (!gate.ok) return gate.response;

  const { communityId, membershipId } = await context.params;

  const body = await readAdminBody(request);
  if (!body.ok) return body.response;

  const parsed = membershipUpdateSchema.safeParse(body.value);
  if (!parsed.success) return validationErrorResponse(fieldErrors(parsed.error));

  try {
    const { revokedStaffRoles } = await updateMembership(
      gate.user,
      communityId,
      membershipId,
      parsed.data,
    );

    const detail = await getCommunityDetail(communityId);
    return NextResponse.json({ ...detail, revokedStaffRoles });
  } catch (error) {
    return adminErrorResponse("membership update", error);
  }
}

/**
 * Removes a member.
 *
 * `removed` rather than deleted: the row keeps the history of who lived where
 * and when, which is the record an archived community exists to preserve.
 */
export async function DELETE(_request: Request, context: RouteContext): Promise<NextResponse> {
  const gate = await requireAdminMutation();
  if (!gate.ok) return gate.response;

  const { communityId, membershipId } = await context.params;

  try {
    const { revokedStaffRoles } = await updateMembership(gate.user, communityId, membershipId, {
      status: "removed",
    });

    const detail = await getCommunityDetail(communityId);
    return NextResponse.json({ ...detail, revokedStaffRoles });
  } catch (error) {
    return adminErrorResponse("member remove", error);
  }
}
