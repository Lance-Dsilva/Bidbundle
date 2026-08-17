import { NextResponse } from "next/server";

import {
  hoaErrorResponse,
  readHoaBody,
  requireHoaMutation,
  validationErrorResponse,
} from "@/lib/server/hoa-api";
import { createHoaRequest } from "@/lib/server/hoa-market";
import { hoaRequestCreateSchema } from "@/lib/validation/hoa";
import { fieldErrors } from "@/lib/validation/profile";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ communityId: string }> };

export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  const gate = await requireHoaMutation();
  if (!gate.ok) return gate.response;
  const body = await readHoaBody(request);
  if (!body.ok) return body.response;
  const parsed = hoaRequestCreateSchema.safeParse(body.value);
  if (!parsed.success) return validationErrorResponse(fieldErrors(parsed.error));
  const { communityId } = await context.params;

  try {
    const requestId = await createHoaRequest(gate.user.id, communityId, parsed.data);
    return NextResponse.json({ requestId }, { status: 201 });
  } catch (error) {
    return hoaErrorResponse("request creation", error);
  }
}
