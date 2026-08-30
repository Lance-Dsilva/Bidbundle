import { NextResponse } from "next/server";

import { transitionHoaRequest } from "@/lib/server/hoa-market";
import {
  hoaErrorResponse,
  readHoaBody,
  requireHoaMutation,
  validationErrorResponse,
} from "@/lib/server/hoa-api";
import { getNeighborhoodRequest } from "@/lib/server/neighborhood-market";
import { neighborhoodTransitionSchema } from "@/lib/validation/neighborhood";
import { fieldErrors } from "@/lib/validation/profile";

/**
 * Neighbourhood manager lifecycle control.
 *
 * The handler is thin on purpose: it validates an *action* name and hands off
 * to `transitionHoaRequest`, the same function the HOA manager workspace calls.
 * That function chooses the authority from the community's type, so a
 * neighbourhood resident cannot drive an HOA request through this route and an
 * HOA manager cannot drive a neighbourhood one.
 *
 * The scheduled deadline reconciler calls the same domain rules, which is why
 * a manager clicking "close bidding" a second after the sweep did it resolves
 * to one state rather than two.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ requestId: string }> };

export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  const gate = await requireHoaMutation();
  if (!gate.ok) return gate.response;

  const body = await readHoaBody(request);
  if (!body.ok) return body.response;

  const parsed = neighborhoodTransitionSchema.safeParse(body.value);
  if (!parsed.success) return validationErrorResponse(fieldErrors(parsed.error));

  const { requestId } = await context.params;

  try {
    await transitionHoaRequest(gate.user.id, requestId, {
      action: parsed.data.action,
      biddingClosesAt: parsed.data.biddingClosesAt ?? null,
    });
    // Return the request as it now stands so the page does not have to guess
    // what the transition produced.
    return NextResponse.json({ request: await getNeighborhoodRequest(gate.user.id, requestId) });
  } catch (error) {
    return hoaErrorResponse("neighbourhood transition", error);
  }
}
