import { NextResponse } from "next/server";

import {
  hoaErrorResponse,
  readHoaBody,
  requireHoaMutation,
  validationErrorResponse,
} from "@/lib/server/hoa-api";
import { createAgreementReview } from "@/lib/server/hoa-market";
import { reviewCreateSchema } from "@/lib/validation/hoa";
import { fieldErrors } from "@/lib/validation/profile";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ agreementId: string }> };

/** One manager review per completed agreement. */
export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  const gate = await requireHoaMutation();
  if (!gate.ok) return gate.response;
  const body = await readHoaBody(request);
  if (!body.ok) return body.response;
  const parsed = reviewCreateSchema.safeParse(body.value);
  if (!parsed.success) return validationErrorResponse(fieldErrors(parsed.error));
  const { agreementId } = await context.params;

  try {
    await createAgreementReview(gate.user.id, agreementId, parsed.data);
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    return hoaErrorResponse("agreement review", error);
  }
}
