import { NextResponse } from "next/server";

import { adminErrorResponse, requireAdmin } from "@/lib/server/admin-api";
import { getAdminOverview } from "@/lib/server/communities";

export const runtime = "nodejs";
/** Counts change on every admin action; a cached copy would be misleading. */
export const dynamic = "force-dynamic";

/** Summary counts for the internal portal landing page. */
export async function GET(): Promise<NextResponse> {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.response;

  try {
    return NextResponse.json(await getAdminOverview());
  } catch (error) {
    return adminErrorResponse("overview", error);
  }
}
