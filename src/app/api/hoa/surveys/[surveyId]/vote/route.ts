import { NextResponse } from "next/server";

import {
  hoaErrorResponse,
  readHoaBody,
  requireHoaMutation,
  validationErrorResponse,
} from "@/lib/server/hoa-api";
import { voteInHoaSurvey } from "@/lib/server/hoa";
import { hoaSurveyVoteSchema } from "@/lib/validation/hoa";
import { fieldErrors } from "@/lib/validation/profile";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ surveyId: string }> };

export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  const gate = await requireHoaMutation();
  if (!gate.ok) return gate.response;
  const body = await readHoaBody(request);
  if (!body.ok) return body.response;
  const parsed = hoaSurveyVoteSchema.safeParse(body.value);
  if (!parsed.success) return validationErrorResponse(fieldErrors(parsed.error));
  const { surveyId } = await context.params;

  try {
    await voteInHoaSurvey(gate.user.id, surveyId, parsed.data.optionIndex);
    return NextResponse.json({ voted: true });
  } catch (error) {
    return hoaErrorResponse("survey vote", error);
  }
}
