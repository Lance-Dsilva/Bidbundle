import { NextResponse } from "next/server";

import {
  hoaErrorResponse,
  readHoaBody,
  requireHoaMutation,
  validationErrorResponse,
} from "@/lib/server/hoa-api";
import { closeOccurrence } from "@/lib/server/hoa-market";
import { emptyMutationSchema } from "@/lib/validation/hoa";
import { fieldErrors } from "@/lib/validation/profile";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ occurrenceId: string }> };

/** Manager closes a service day after every visit is completed or resolved. */
export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  const gate = await requireHoaMutation();
  if (!gate.ok) return gate.response;
  const body = await readHoaBody(request);
  if (!body.ok) return body.response;
  const parsed = emptyMutationSchema.safeParse(body.value);
  if (!parsed.success) return validationErrorResponse(fieldErrors(parsed.error));
  const { occurrenceId } = await context.params;

  try {
    await closeOccurrence(gate.user.id, occurrenceId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return hoaErrorResponse("occurrence close", error);
  }
}
