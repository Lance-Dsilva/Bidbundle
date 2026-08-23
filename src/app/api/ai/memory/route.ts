import { NextResponse } from "next/server";

import { requireAiUser } from "@/lib/server/ai/gate";
import { db } from "@/lib/server/db";

export const runtime = "nodejs";

const CONTEXT_KEY = "general";

/** Clears the caller's own assistant conversation history. Starts a fresh thread. */
export async function DELETE(): Promise<NextResponse> {
  const gate = await requireAiUser();
  if (!gate.ok) return gate.response;

  const conversation = await db.aiConversation.findUnique({
    where: { userId_contextKey: { userId: gate.user.id, contextKey: CONTEXT_KEY } },
    select: { id: true },
  });

  if (conversation) {
    await db.aiMessage.deleteMany({ where: { conversationId: conversation.id } });
  }

  return NextResponse.json({ ok: true });
}
