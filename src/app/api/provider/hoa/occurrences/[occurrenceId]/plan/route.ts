import { NextResponse } from "next/server";

import {
  hoaErrorResponse,
  readHoaBody,
  requireProviderMutation,
  validationErrorResponse,
} from "@/lib/server/hoa-api";
import { saveDayPlan } from "@/lib/server/hoa-market";
import { dayPlanSchema } from "@/lib/validation/hoa";
import { fieldErrors } from "@/lib/validation/profile";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ occurrenceId: string }> };

/** Save (and optionally publish) the provider's stop order for one day. */
export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  const gate = await requireProviderMutation();
  if (!gate.ok) return gate.response;
  const body = await readHoaBody(request);
  if (!body.ok) return body.response;
  const parsed = dayPlanSchema.safeParse(body.value);
  if (!parsed.success) return validationErrorResponse(fieldErrors(parsed.error));
  const { occurrenceId } = await context.params;

  try {
    await saveDayPlan(gate.user.id, occurrenceId, parsed.data);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return hoaErrorResponse("day plan", error);
  }
}
