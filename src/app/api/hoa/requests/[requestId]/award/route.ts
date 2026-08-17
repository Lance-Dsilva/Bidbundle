import { NextResponse } from "next/server";

import {
  hoaErrorResponse,
  readHoaBody,
  requireHoaMutation,
  validationErrorResponse,
} from "@/lib/server/hoa-api";
import { awardBid } from "@/lib/server/hoa-market";
import { awardSchema } from "@/lib/validation/hoa";
import { fieldErrors } from "@/lib/validation/profile";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ requestId: string }> };

/**
 * Accepts exactly one bid. Retries and double-clicks return the same
 * agreement id rather than creating a second award.
 */
export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  const gate = await requireHoaMutation();
  if (!gate.ok) return gate.response;
  const body = await readHoaBody(request);
  if (!body.ok) return body.response;
  const parsed = awardSchema.safeParse(body.value);
  if (!parsed.success) return validationErrorResponse(fieldErrors(parsed.error));
  const { requestId } = await context.params;

  try {
    const agreementId = await awardBid(gate.user.id, requestId, parsed.data);
    return NextResponse.json({ agreementId }, { status: 201 });
  } catch (error) {
    return hoaErrorResponse("bid award", error);
  }
}
