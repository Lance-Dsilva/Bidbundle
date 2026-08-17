import { NextResponse } from "next/server";

import {
  hoaErrorResponse,
  readHoaBody,
  requireHoaMutation,
  validationErrorResponse,
} from "@/lib/server/hoa-api";
import { transitionHoaRequest } from "@/lib/server/hoa-market";
import { hoaRequestTransitionSchema } from "@/lib/validation/hoa";
import { fieldErrors } from "@/lib/validation/profile";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ requestId: string }> };

/** Manager lifecycle transition: publish, open/close bidding, complete, cancel. */
export async function PATCH(request: Request, context: RouteContext): Promise<NextResponse> {
  const gate = await requireHoaMutation();
  if (!gate.ok) return gate.response;
  const body = await readHoaBody(request);
  if (!body.ok) return body.response;
  const parsed = hoaRequestTransitionSchema.safeParse(body.value);
  if (!parsed.success) return validationErrorResponse(fieldErrors(parsed.error));
  const { requestId } = await context.params;

  try {
    await transitionHoaRequest(gate.user.id, requestId, parsed.data);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return hoaErrorResponse("request transition", error);
  }
}
