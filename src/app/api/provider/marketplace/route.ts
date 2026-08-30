import { NextResponse } from "next/server";

import { hoaErrorResponse, requireProviderUser } from "@/lib/server/hoa-api";
import { getProviderHoaWorkspace } from "@/lib/server/hoa-market";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The provider marketplace: coverage, the eligible feed, this provider's own
 * bids, the agreements they won, and their day plans.
 *
 * One endpoint for both community types. The feed carries HOA and
 * neighbourhood opportunities together, each labelled with its `context`, so a
 * provider has one place to look and Bundleen has one eligibility rule to
 * maintain.
 */
export async function GET(): Promise<NextResponse> {
  const gate = await requireProviderUser();
  if (!gate.ok) return gate.response;

  try {
    return NextResponse.json({ workspace: await getProviderHoaWorkspace(gate.user.id) });
  } catch (error) {
    return hoaErrorResponse("provider workspace", error);
  }
}
