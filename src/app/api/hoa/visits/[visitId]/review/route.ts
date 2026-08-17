import { NextResponse } from "next/server";

import {
  hoaErrorResponse,
  readHoaBody,
  requireHoaMutation,
  validationErrorResponse,
} from "@/lib/server/hoa-api";
import { createVisitReview } from "@/lib/server/hoa-market";
import { reviewCreateSchema } from "@/lib/validation/hoa";
import { fieldErrors } from "@/lib/validation/profile";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ visitId: string }> };

/** One homeowner review per completed visit to their own home. */
export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  const gate = await requireHoaMutation();
  if (!gate.ok) return gate.response;
  const body = await readHoaBody(request);
  if (!body.ok) return body.response;
  const parsed = reviewCreateSchema.safeParse(body.value);
  if (!parsed.success) return validationErrorResponse(fieldErrors(parsed.error));
  const { visitId } = await context.params;

  try {
    await createVisitReview(gate.user.id, visitId, parsed.data);
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    return hoaErrorResponse("visit review", error);
  }
}
