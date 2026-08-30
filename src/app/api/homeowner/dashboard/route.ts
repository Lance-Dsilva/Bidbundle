import { NextResponse } from "next/server";

import { authorizeRequest } from "@/lib/server/auth";
import { logUnexpectedFailure } from "@/lib/server/errors";
import { getHomeownerDashboard } from "@/lib/server/homeowner-requests";

/**
 * Counters for the homeowner shell and dashboard.
 *
 * Every figure is an aggregate over rows the caller owns, resolved from the
 * session — there is no user id in the URL and no way to read another
 * household's totals.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const authorized = await authorizeRequest(["homeowner"]);
  if (!authorized.ok) return authorized.response;

  try {
    return NextResponse.json(await getHomeownerDashboard(authorized.user.id));
  } catch (error) {
    const reference = logUnexpectedFailure("homeowner:dashboard", error);
    return NextResponse.json(
      { error: "We could not load your dashboard. Please try again.", reference },
      { status: 500 },
    );
  }
}
