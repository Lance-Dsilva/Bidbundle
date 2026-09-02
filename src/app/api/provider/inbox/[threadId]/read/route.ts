import { NextResponse } from "next/server";

import { markConversationRead } from "@/lib/server/conversations";
import { hoaErrorResponse } from "@/lib/server/hoa-api";
import { requireProviderConsoleMutation } from "@/lib/server/provider-api";

/**
 * Marks everything the other party sent in this thread as read.
 *
 * A caller can only ever clear their own unread state: the update matches
 * `senderUserId != me`, so nobody can forge a read receipt on their own
 * messages, and a non-participant's thread id matches no rows at all.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ threadId: string }> };

export async function POST(_request: Request, context: RouteContext): Promise<NextResponse> {
  const gate = await requireProviderConsoleMutation();
  if (!gate.ok) return gate.response;

  const { threadId } = await context.params;

  try {
    return NextResponse.json(await markConversationRead(gate.user.id, threadId));
  } catch (error) {
    return hoaErrorResponse("mark conversation read", error);
  }
}
