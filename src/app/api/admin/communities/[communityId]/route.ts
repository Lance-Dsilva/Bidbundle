import { NextResponse } from "next/server";

import {
  adminErrorResponse,
  notFoundResponse,
  readAdminBody,
  requireAdmin,
  requireAdminMutation,
  validationErrorResponse,
} from "@/lib/server/admin-api";
import { getCommunityDetail, updateCommunity } from "@/lib/server/communities";
import { communityUpdateSchema } from "@/lib/validation/community";
import { fieldErrors } from "@/lib/validation/profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ communityId: string }> };

export async function GET(_request: Request, context: RouteContext): Promise<NextResponse> {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.response;

  const { communityId } = await context.params;

  try {
    const detail = await getCommunityDetail(communityId);
    if (!detail) return notFoundResponse("That community no longer exists.");
    return NextResponse.json(detail);
  } catch (error) {
    return adminErrorResponse("community detail", error);
  }
}

/**
 * Edits a community, including archive and restore.
 *
 * There is deliberately no `DELETE`: communities carry memberships, staff
 * history, and audit references, so `status: "archived"` is the only way to
 * retire one. Sending the status a community is already in is harmless, which
 * is what keeps a double-submitted archive from doing anything twice.
 */
export async function PATCH(request: Request, context: RouteContext): Promise<NextResponse> {
  const gate = await requireAdminMutation();
  if (!gate.ok) return gate.response;

  const { communityId } = await context.params;

  const body = await readAdminBody(request);
  if (!body.ok) return body.response;

  const parsed = communityUpdateSchema.safeParse(body.value);
  if (!parsed.success) return validationErrorResponse(fieldErrors(parsed.error));

  try {
    await updateCommunity(gate.user, communityId, parsed.data);
    return NextResponse.json(await getCommunityDetail(communityId));
  } catch (error) {
    return adminErrorResponse("community update", error);
  }
}
