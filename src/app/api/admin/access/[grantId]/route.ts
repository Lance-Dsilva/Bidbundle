import { NextResponse } from "next/server";

import { adminErrorResponse, requireAdminOwnerMutation } from "@/lib/server/admin-api";
import { revokeAdminAccess } from "@/lib/server/admin-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ grantId: string }> };

export async function DELETE(_request: Request, context: RouteContext): Promise<NextResponse> {
  const gate = await requireAdminOwnerMutation();
  if (!gate.ok) return gate.response;

  const { grantId } = await context.params;
  if (!grantId || grantId.length > 64) {
    return NextResponse.json({ error: "Invalid admin access record." }, { status: 400 });
  }

  try {
    const access = await revokeAdminAccess({
      actorUserId: gate.user.id,
      grantId,
    });
    return NextResponse.json({ access });
  } catch (error) {
    return adminErrorResponse("admin access revoke", error);
  }
}

