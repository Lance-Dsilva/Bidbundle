import { NextResponse } from "next/server";

import {
  hoaErrorResponse,
  readHoaBody,
  requireHoaMutation,
  validationErrorResponse,
} from "@/lib/server/hoa-api";
import { updateHoaSurveyStatus } from "@/lib/server/hoa";
import { hoaSurveyStatusSchema } from "@/lib/validation/hoa";
import { fieldErrors } from "@/lib/validation/profile";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ surveyId: string }> };

export async function PATCH(request: Request, context: RouteContext): Promise<NextResponse> {
  const gate = await requireHoaMutation();
  if (!gate.ok) return gate.response;
  const body = await readHoaBody(request);
  if (!body.ok) return body.response;
  const parsed = hoaSurveyStatusSchema.safeParse(body.value);
  if (!parsed.success) return validationErrorResponse(fieldErrors(parsed.error));
  const { surveyId } = await context.params;

  try {
    await updateHoaSurveyStatus(gate.user.id, surveyId, parsed.data);
    return NextResponse.json({ updated: true });
  } catch (error) {
    return hoaErrorResponse("survey status update", error);
  }
}
