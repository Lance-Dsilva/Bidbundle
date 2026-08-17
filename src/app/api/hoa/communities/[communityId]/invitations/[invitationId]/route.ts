import { NextResponse } from "next/server";

import { hoaErrorResponse, requireHoaMutation } from "@/lib/server/hoa-api";
import { revokeHoaResidentInvitation } from "@/lib/server/hoa";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ communityId: string; invitationId: string }> };

export async function DELETE(_request: Request, context: RouteContext): Promise<NextResponse> {
  const gate = await requireHoaMutation();
  if (!gate.ok) return gate.response;
  const { communityId, invitationId } = await context.params;
  try {
    await revokeHoaResidentInvitation({ actorUserId: gate.user.id, communityId, invitationId });
    return NextResponse.json({ revoked: true });
  } catch (error) {
    return hoaErrorResponse("resident invitation revoke", error);
  }
}
