import { NextResponse } from "next/server";

import {
  adminErrorResponse,
  readAdminBody,
  requireAdminMutation,
  validationErrorResponse,
} from "@/lib/server/admin-api";
import { importUnits } from "@/lib/server/hoa-units";
import { unitImportSchema } from "@/lib/validation/hoa";
import { fieldErrors } from "@/lib/validation/profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ communityId: string }> };

/** CSV unit import. `commit: false` returns the dry-run preview only. */
export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  const gate = await requireAdminMutation();
  if (!gate.ok) return gate.response;
  const body = await readAdminBody(request, 512 * 1024);
  if (!body.ok) return body.response;
  const parsed = unitImportSchema.safeParse(body.value);
  if (!parsed.success) return validationErrorResponse(fieldErrors(parsed.error));
  const { communityId } = await context.params;

  try {
    const result = await importUnits(gate.user.id, communityId, parsed.data);
    return NextResponse.json({ result });
  } catch (error) {
    return adminErrorResponse("unit import", error);
  }
}
