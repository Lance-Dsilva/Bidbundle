import { NextResponse } from "next/server";

import {
  hoaErrorResponse,
  readHoaBody,
  requireProviderMutation,
  validationErrorResponse,
} from "@/lib/server/hoa-api";
import { removeServiceArea, upsertServiceArea } from "@/lib/server/hoa-market";
import { serviceAreaSchema } from "@/lib/validation/hoa";
import { fieldErrors } from "@/lib/validation/profile";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ areaId: string }> };

export async function PUT(request: Request, context: RouteContext): Promise<NextResponse> {
  const gate = await requireProviderMutation();
  if (!gate.ok) return gate.response;
  const body = await readHoaBody(request);
  if (!body.ok) return body.response;
  const parsed = serviceAreaSchema.safeParse(body.value);
  if (!parsed.success) return validationErrorResponse(fieldErrors(parsed.error));
  const { areaId } = await context.params;

  try {
    const area = await upsertServiceArea(gate.user.id, parsed.data, areaId);
    return NextResponse.json({ area });
  } catch (error) {
    return hoaErrorResponse("service area update", error);
  }
}

export async function DELETE(_request: Request, context: RouteContext): Promise<NextResponse> {
  const gate = await requireProviderMutation();
  if (!gate.ok) return gate.response;
  const { areaId } = await context.params;

  try {
    await removeServiceArea(gate.user.id, areaId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return hoaErrorResponse("service area removal", error);
  }
}
