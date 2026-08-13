import { NextResponse } from "next/server";

import {
  adminErrorResponse,
  readAdminBody,
  requireAdminMutation,
  validationErrorResponse,
} from "@/lib/server/admin-api";
import { getCommunityDetail, revokeStaffAssignment } from "@/lib/server/communities";
import { staffRevokeSchema } from "@/lib/validation/community";
import { fieldErrors } from "@/lib/validation/profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ communityId: string; assignmentId: string }> };

/**
 * Revokes a scoped community role.
 *
 * Revoking an already-revoked assignment succeeds without appending a second
 * audit entry, so a double-clicked "Revoke" cannot produce a misleading log.
 * The body is optional — an empty request is a revocation with no note.
 */
export async function DELETE(request: Request, context: RouteContext): Promise<NextResponse> {
  const gate = await requireAdminMutation();
  if (!gate.ok) return gate.response;

  const { communityId, assignmentId } = await context.params;

  let note: string | null = null;
  if (request.headers.get("content-type")?.includes("application/json")) {
    const body = await readAdminBody(request);
    if (!body.ok) return body.response;

    const parsed = staffRevokeSchema.safeParse(body.value);
    if (!parsed.success) return validationErrorResponse(fieldErrors(parsed.error));
    note = parsed.data.note ?? null;
  }

  try {
    await revokeStaffAssignment(gate.user, communityId, assignmentId, note);
    return NextResponse.json(await getCommunityDetail(communityId));
  } catch (error) {
    return adminErrorResponse("staff revoke", error);
  }
}
