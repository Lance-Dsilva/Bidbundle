import { NextResponse } from "next/server";

import {
  hoaErrorResponse,
  readHoaBody,
  requireHoaMutation,
  validationErrorResponse,
} from "@/lib/server/hoa-api";
import { respondToOptionalRequest } from "@/lib/server/hoa-market";
import { participationResponseSchema } from "@/lib/validation/hoa";
import { fieldErrors } from "@/lib/validation/profile";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ requestId: string }> };

/** Resident joins or declines an optional request while enrollment is open. */
export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  const gate = await requireHoaMutation();
  if (!gate.ok) return gate.response;
  const body = await readHoaBody(request);
  if (!body.ok) return body.response;
  const parsed = participationResponseSchema.safeParse(body.value);
  if (!parsed.success) return validationErrorResponse(fieldErrors(parsed.error));
  const { requestId } = await context.params;

  try {
    await respondToOptionalRequest(gate.user.id, requestId, parsed.data);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return hoaErrorResponse("request participation", error);
  }
}
