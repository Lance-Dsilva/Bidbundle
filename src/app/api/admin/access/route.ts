import { NextResponse } from "next/server";

import {
  adminErrorResponse,
  readAdminBody,
  requireAdminOwner,
  requireAdminOwnerMutation,
  validationErrorResponse,
} from "@/lib/server/admin-api";
import { grantAdminAccess, listAdminAccess } from "@/lib/server/admin-access";
import { adminAccessGrantSchema } from "@/lib/validation/admin-access";
import { fieldErrors } from "@/lib/validation/profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const gate = await requireAdminOwner();
  if (!gate.ok) return gate.response;

  try {
    return NextResponse.json({ access: await listAdminAccess() });
  } catch (error) {
    return adminErrorResponse("admin access list", error);
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const gate = await requireAdminOwnerMutation();
  if (!gate.ok) return gate.response;

  const body = await readAdminBody(request);
  if (!body.ok) return body.response;
  const parsed = adminAccessGrantSchema.safeParse(body.value);
  if (!parsed.success) return validationErrorResponse(fieldErrors(parsed.error));

  try {
    const access = await grantAdminAccess({
      actorUserId: gate.user.id,
      email: parsed.data.email,
    });
    return NextResponse.json({ access }, { status: 201 });
  } catch (error) {
    return adminErrorResponse("admin access grant", error);
  }
}
