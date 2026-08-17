import { NextResponse } from "next/server";

import { adminErrorResponse, requireAdminMutation } from "@/lib/server/admin-api";
import { revokeHoaManagerInvitation } from "@/lib/server/hoa";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ communityId: string; invitationId: string }> };

export async function DELETE(_request: Request, context: RouteContext): Promise<NextResponse> {
  const gate = await requireAdminMutation();
  if (!gate.ok) return gate.response;
  const { communityId, invitationId } = await context.params;
  try {
    await revokeHoaManagerInvitation({ actorUserId: gate.user.id, communityId, invitationId });
    return NextResponse.json({ revoked: true });
  } catch (error) {
    return adminErrorResponse("HOA manager invitation revoke", error);
  }
}
