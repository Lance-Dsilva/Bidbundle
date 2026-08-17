import { NextResponse } from "next/server";

import { hoaErrorResponse, requireHoaUser } from "@/lib/server/hoa-api";
import { listRequestBids } from "@/lib/server/hoa-market";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ requestId: string }> };

/** Transparent bid list for the HOA's manager and active residents. */
export async function GET(_request: Request, context: RouteContext): Promise<NextResponse> {
  const gate = await requireHoaUser();
  if (!gate.ok) return gate.response;
  const { requestId } = await context.params;

  try {
    return NextResponse.json({ bids: await listRequestBids(gate.user.id, requestId) });
  } catch (error) {
    return hoaErrorResponse("bid list", error);
  }
}
