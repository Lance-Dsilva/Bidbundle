import { NextResponse } from "next/server";

import {
  hoaErrorResponse,
  readHoaBody,
  requireHoaMutation,
  validationErrorResponse,
} from "@/lib/server/hoa-api";
import { respondToNeighborhoodRequest } from "@/lib/server/neighborhood-market";
import { participationSchema } from "@/lib/validation/neighborhood";
import { fieldErrors } from "@/lib/validation/profile";

/**
 * Join or decline a neighbour's request.
 *
 * `POST` rather than `PUT` because the caller names an answer, not a row: the
 * participation identity is `(request, signed-in account)` and cannot be
 * addressed from the client. Repeating the same answer is a no-op, so a
 * double-click or a retried request is safe.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ requestId: string }> };

export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  const gate = await requireHoaMutation();
  if (!gate.ok) return gate.response;

  const body = await readHoaBody(request);
  if (!body.ok) return body.response;

  const parsed = participationSchema.safeParse(body.value);
  if (!parsed.success) return validationErrorResponse(fieldErrors(parsed.error));

  const { requestId } = await context.params;

  try {
    const result = await respondToNeighborhoodRequest(
      gate.user.id,
      requestId,
      parsed.data.response,
    );
    return NextResponse.json(result);
  } catch (error) {
    return hoaErrorResponse("neighbourhood participation", error);
  }
}
