import { NextResponse } from "next/server";

import { awardBid } from "@/lib/server/hoa-market";
import {
  hoaErrorResponse,
  readHoaBody,
  requireHoaMutation,
  validationErrorResponse,
} from "@/lib/server/hoa-api";
import { getNeighborhoodRequest } from "@/lib/server/neighborhood-market";
import { neighborhoodAwardSchema } from "@/lib/validation/neighborhood";
import { fieldErrors } from "@/lib/validation/profile";

/**
 * The neighbourhood manager accepts exactly one bid.
 *
 * `awardBid` is atomic and idempotent: a double-click, or two managers acting
 * at once, resolves to the same agreement because the accepted-bid and
 * agreement unique indexes admit exactly one winner. Awarding a *different*
 * bid after one is accepted is refused, not silently applied.
 *
 * If a participating home has no verified address the whole award is refused
 * and the response carries the count and names to fix — there is no partial
 * award to unwind.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ requestId: string }> };

export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  const gate = await requireHoaMutation();
  if (!gate.ok) return gate.response;

  const body = await readHoaBody(request);
  if (!body.ok) return body.response;

  const parsed = neighborhoodAwardSchema.safeParse(body.value);
  if (!parsed.success) return validationErrorResponse(fieldErrors(parsed.error));

  const { requestId } = await context.params;

  try {
    const agreementId = await awardBid(gate.user.id, requestId, { bidId: parsed.data.bidId });
    return NextResponse.json({
      agreementId,
      request: await getNeighborhoodRequest(gate.user.id, requestId),
    });
  } catch (error) {
    return hoaErrorResponse("neighbourhood award", error);
  }
}
