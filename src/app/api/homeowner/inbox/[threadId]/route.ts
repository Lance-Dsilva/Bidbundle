import { NextResponse } from "next/server";

import { getConversation } from "@/lib/server/conversations";
import { hoaErrorResponse, requireHoaUser } from "@/lib/server/hoa-api";
import {
  MAX_MESSAGE_PAGE_SIZE,
  MESSAGE_PAGE_SIZE,
  readPagination,
} from "@/lib/validation/provider-console";

/**
 * One conversation's transcript, from the customer's side.
 *
 * `threadId` is the only thing the caller supplies, and it widens nothing: the
 * service resolves it with the participant test inside the `where`, so a
 * thread belonging to another customer comes back as "does not exist".
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ threadId: string }> };

export async function GET(request: Request, context: RouteContext): Promise<NextResponse> {
  const gate = await requireHoaUser();
  if (!gate.ok) return gate.response;

  const { threadId } = await context.params;
  const { limit, offset } = readPagination(new URL(request.url).searchParams, {
    limit: MESSAGE_PAGE_SIZE,
    maxLimit: MAX_MESSAGE_PAGE_SIZE,
  });

  try {
    return NextResponse.json(await getConversation(gate.user.id, threadId, { limit, offset }));
  } catch (error) {
    return hoaErrorResponse("customer conversation", error);
  }
}
