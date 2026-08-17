import { NextResponse } from "next/server";

import {
  adminErrorResponse,
  readAdminBody,
  requireAdminMutation,
  validationErrorResponse,
} from "@/lib/server/admin-api";
import { updateUnit } from "@/lib/server/hoa-units";
import { unitUpdateSchema } from "@/lib/validation/hoa";
import { fieldErrors } from "@/lib/validation/profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ communityId: string; unitId: string }> };

export async function PATCH(request: Request, context: RouteContext): Promise<NextResponse> {
  const gate = await requireAdminMutation();
  if (!gate.ok) return gate.response;
  const body = await readAdminBody(request);
  if (!body.ok) return body.response;
  const parsed = unitUpdateSchema.safeParse(body.value);
  if (!parsed.success) return validationErrorResponse(fieldErrors(parsed.error));
  const { communityId, unitId } = await context.params;

  try {
    const unit = await updateUnit(gate.user.id, communityId, unitId, parsed.data);
    return NextResponse.json({ unit });
  } catch (error) {
    return adminErrorResponse("unit update", error);
  }
}
