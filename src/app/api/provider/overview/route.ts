import { NextResponse } from "next/server";

import { hoaErrorResponse } from "@/lib/server/hoa-api";
import { requireProviderConsole } from "@/lib/server/provider-api";
import { getProviderOverview } from "@/lib/server/provider-overview";

/**
 * The provider dashboard's headline metrics.
 *
 * Replaces the console's old `/provider/dashboard` + `/provider/me` pair,
 * which no handler ever served and whose snake-case, numeric-id contract never
 * matched this database. There is no parameter: the provider is the session,
 * so there is nothing a caller can change to see another provider's pipeline.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const gate = await requireProviderConsole();
  if (!gate.ok) return gate.response;

  try {
    return NextResponse.json({ overview: await getProviderOverview(gate.user.id) });
  } catch (error) {
    return hoaErrorResponse("provider overview", error);
  }
}
