import { NextResponse } from "next/server";

import { hoaErrorResponse, requireHoaUser } from "@/lib/server/hoa-api";
import { listHomeownerBids } from "@/lib/server/marketplace-reads";

/**
 * Quotes on the requests this homeowner opened or joined.
 *
 * Replaces the old `/homeowner/bids` call, which had no Route Handler behind
 * it and used numeric ids. Scope is the signed-in account: there is no
 * parameter here that can name another homeowner's requests.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const gate = await requireHoaUser();
  if (!gate.ok) return gate.response;

  try {
    return NextResponse.json({ bids: await listHomeownerBids(gate.user.id) });
  } catch (error) {
    return hoaErrorResponse("homeowner bids", error);
  }
}
