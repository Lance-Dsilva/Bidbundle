import { NextResponse } from "next/server";

import {
  adminErrorResponse,
  readAdminBody,
  requireAdmin,
  requireAdminMutation,
  validationErrorResponse,
} from "@/lib/server/admin-api";
import { createUnit, listUnits } from "@/lib/server/hoa-units";
import { unitCreateSchema } from "@/lib/validation/hoa";
import { fieldErrors } from "@/lib/validation/profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ communityId: string }> };

export async function GET(_request: Request, context: RouteContext): Promise<NextResponse> {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.response;
  const { communityId } = await context.params;

  try {
    return NextResponse.json({ units: await listUnits(communityId) });
  } catch (error) {
    return adminErrorResponse("unit list", error);
  }
}

export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  const gate = await requireAdminMutation();
  if (!gate.ok) return gate.response;
  const body = await readAdminBody(request);
  if (!body.ok) return body.response;
  const parsed = unitCreateSchema.safeParse(body.value);
  if (!parsed.success) return validationErrorResponse(fieldErrors(parsed.error));
  const { communityId } = await context.params;

  try {
    const unit = await createUnit(gate.user.id, communityId, parsed.data);
    return NextResponse.json({ unit }, { status: 201 });
  } catch (error) {
    return adminErrorResponse("unit creation", error);
  }
}
