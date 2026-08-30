import { NextResponse } from "next/server";

import { hoaErrorResponse, requireHoaUser } from "@/lib/server/hoa-api";
import { getNeighborhoodHub } from "@/lib/server/neighborhood-market";

/**
 * The homeowner's neighbourhood page, in one read.
 *
 * Returns the caller's own neighbourhood — resolved from their active
 * membership, never from a query parameter — with every request in it, scoped
 * to what this account may see. A homeowner with no neighbourhood gets
 * `{ hub: null }` and a `200`: having no neighbourhood is a product state, not
 * an error.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const gate = await requireHoaUser();
  if (!gate.ok) return gate.response;

  try {
    return NextResponse.json({ hub: await getNeighborhoodHub(gate.user.id) });
  } catch (error) {
    return hoaErrorResponse("neighbourhood hub", error);
  }
}
