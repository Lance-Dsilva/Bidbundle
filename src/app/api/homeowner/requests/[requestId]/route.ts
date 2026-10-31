import { NextResponse } from "next/server";

import {
  hoaErrorResponse,
  readHoaBody,
  requireHoaMutation,
  requireHoaUser,
  validationErrorResponse,
} from "@/lib/server/hoa-api";
import {
  getNeighborhoodRequest,
  mutateOwnedNeighborhoodRequest,
} from "@/lib/server/neighborhood-market";
import { ownerRequestMutationSchema } from "@/lib/validation/homeowner-requests";
import { fieldErrors } from "@/lib/validation/profile";

/**
 * One neighbourhood request, scoped to the caller.
 *
 * Membership of that exact neighbourhood is required for any of it. Bid
 * comparisons appear only for the manager, the requester, and neighbours who
 * joined; participant names only for the manager; exact stop locations only
 * for the resident of the stop.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ requestId: string }> };

export async function GET(_request: Request, context: RouteContext): Promise<NextResponse> {
  const gate = await requireHoaUser();
  if (!gate.ok) return gate.response;
  const { requestId } = await context.params;

  try {
    return NextResponse.json({
      request: await getNeighborhoodRequest(gate.user.id, requestId),
    });
  } catch (error) {
    return hoaErrorResponse("neighbourhood request", error);
  }
}


/** Owners change only their own pre-bidding scope, never manager authority. */
export async function PATCH(request: Request, context: RouteContext): Promise<NextResponse> {
  const gate = await requireHoaMutation();
  if (!gate.ok) return gate.response;
  const body = await readHoaBody(request);
  if (!body.ok) return body.response;
  const parsed = ownerRequestMutationSchema.safeParse(body.value);
  if (!parsed.success) return validationErrorResponse(fieldErrors(parsed.error));
  const { requestId } = await context.params;

  try {
    await mutateOwnedNeighborhoodRequest(gate.user.id, requestId, parsed.data);
    return NextResponse.json({ request: await getNeighborhoodRequest(gate.user.id, requestId) });
  } catch (error) {
    return hoaErrorResponse("owner request change", error);
  }
}
