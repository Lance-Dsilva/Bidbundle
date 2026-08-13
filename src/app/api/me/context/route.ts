import { NextResponse } from "next/server";

import { authorizeRequest } from "@/lib/server/auth";
import { resolveViewerContext } from "@/lib/server/communities";
import { internalErrorResponse } from "@/lib/server/profile";

export const runtime = "nodejs";
/**
 * Never cached. A Bundleen admin changing someone's role has to show up on
 * that person's next revalidation without them signing in again, which a
 * cached identity payload would quietly prevent.
 */
export const dynamic = "force-dynamic";

/**
 * The role context behind the top-right identity area.
 *
 * Backs the label a customer sees about themselves, resolved from live
 * `CommunityStaffAssignment` and `CommunityMembership` rows. It is a *display*
 * source: every management read and write re-derives the same assignments
 * server-side, so a client that lies about this response gains nothing.
 */
export async function GET(): Promise<NextResponse> {
  const authorized = await authorizeRequest();
  if (!authorized.ok) return authorized.response;

  try {
    return NextResponse.json(await resolveViewerContext(authorized.user));
  } catch (error) {
    return internalErrorResponse("viewer context", error);
  }
}
