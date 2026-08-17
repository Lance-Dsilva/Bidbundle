import { NextResponse } from "next/server";

import {
  hoaErrorResponse,
  readHoaBody,
  requireProviderMutation,
  validationErrorResponse,
} from "@/lib/server/hoa-api";
import { updateVisitStatus } from "@/lib/server/hoa-market";
import { visitStatusSchema } from "@/lib/validation/hoa";
import { fieldErrors } from "@/lib/validation/profile";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ visitId: string }> };

export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  const gate = await requireProviderMutation();
  if (!gate.ok) return gate.response;
  const body = await readHoaBody(request);
  if (!body.ok) return body.response;
  const parsed = visitStatusSchema.safeParse(body.value);
  if (!parsed.success) return validationErrorResponse(fieldErrors(parsed.error));
  const { visitId } = await context.params;

  try {
    await updateVisitStatus(gate.user.id, visitId, parsed.data);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return hoaErrorResponse("visit status", error);
  }
}
