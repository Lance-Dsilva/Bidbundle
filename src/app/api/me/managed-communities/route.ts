import { NextResponse } from "next/server";

import { authorizeRequest } from "@/lib/server/auth";
import { listManagedCommunities } from "@/lib/server/communities";
import { internalErrorResponse } from "@/lib/server/profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The communities the signed-in homeowner manages.
 *
 * Restricted to `homeowner` because scoped community roles only ever sit on a
 * homeowner account. There is no community id in the request: the server reads
 * the caller's own active assignments and answers about those, so there is
 * nothing here for a caller to point at a community they do not manage.
 */
export async function GET(): Promise<NextResponse> {
  const authorized = await authorizeRequest(["homeowner"]);
  if (!authorized.ok) return authorized.response;

  try {
    return NextResponse.json({ communities: await listManagedCommunities(authorized.user.id) });
  } catch (error) {
    return internalErrorResponse("managed communities", error);
  }
}
