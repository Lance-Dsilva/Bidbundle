import { NextResponse } from "next/server";

import {
  adminErrorResponse,
  requireAdminPermissionMutation,
} from "@/lib/server/admin-api";
import { revokeAdminAccess } from "@/lib/server/admin-access";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ grantId: string }> };

export async function DELETE(_request: Request, context: RouteContext): Promise<NextResponse> {
  const gate = await requireAdminPermissionMutation("staff:manage");
  if (!gate.ok) return gate.response;

  const { grantId } = await context.params;
  try {
    const staff = await revokeAdminAccess({
      actorUserId: gate.user.id,
      grantId,
      expectedStaffAccount: true,
    });
    return NextResponse.json({ staff });
  } catch (error) {
    return adminErrorResponse("staff access revoke", error);
  }
}
