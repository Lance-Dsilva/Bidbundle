import { NextResponse } from "next/server";

import { hoaErrorResponse, requireProviderUser } from "@/lib/server/hoa-api";
import { getProviderHoaWorkspace } from "@/lib/server/hoa-market";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Provider HOA workspace: coverage, eligible feed, bids, won agreements. */
export async function GET(): Promise<NextResponse> {
  const gate = await requireProviderUser();
  if (!gate.ok) return gate.response;

  try {
    return NextResponse.json({ workspace: await getProviderHoaWorkspace(gate.user.id) });
  } catch (error) {
    return hoaErrorResponse("provider workspace", error);
  }
}
