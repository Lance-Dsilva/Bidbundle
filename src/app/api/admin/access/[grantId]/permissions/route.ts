import { NextResponse } from "next/server";

import {
  adminErrorResponse,
  readAdminBody,
  requireAdminOwnerMutation,
  validationErrorResponse,
} from "@/lib/server/admin-api";
import { setAdminPermissions } from "@/lib/server/admin-access";
import { adminPermissionsSchema } from "@/lib/validation/admin-access";
import { fieldErrors } from "@/lib/validation/profile";

/**
 * Owner-only. Shared admins cannot grant themselves — or each other — the
 * ability to email every Bundleen customer.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ grantId: string }> };

export async function PUT(request: Request, context: RouteContext): Promise<NextResponse> {
  const gate = await requireAdminOwnerMutation();
  if (!gate.ok) return gate.response;

  const body = await readAdminBody(request);
  if (!body.ok) return body.response;

  const parsed = adminPermissionsSchema.safeParse(body.value);
  if (!parsed.success) return validationErrorResponse(fieldErrors(parsed.error));

  const { grantId } = await context.params;
  if (!grantId || grantId.length > 64) {
    return NextResponse.json({ error: "Invalid admin access record." }, { status: 400 });
  }

  try {
    const access = await setAdminPermissions({
      actorUserId: gate.user.id,
      grantId,
      permissions: parsed.data.permissions,
    });
    return NextResponse.json({ access });
  } catch (error) {
    return adminErrorResponse("admin permissions", error);
  }
}
