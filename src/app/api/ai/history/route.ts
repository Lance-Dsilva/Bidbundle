import { NextResponse } from "next/server";

import { requireAiUser } from "@/lib/server/ai/gate";
import { db } from "@/lib/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CONTEXT_KEY = "general";
const MAX_HISTORY = 50;

export async function GET(): Promise<NextResponse> {
  const gate = await requireAiUser();
  if (!gate.ok) return gate.response;

  const conversation = await db.aiConversation.findUnique({
    where: { userId_contextKey: { userId: gate.user.id, contextKey: CONTEXT_KEY } },
    select: { id: true },
  });

  if (!conversation) {
    return NextResponse.json({ messages: [] });
  }

  const rows = await db.aiMessage.findMany({
    where: { conversationId: conversation.id },
    orderBy: { createdAt: "desc" },
    take: MAX_HISTORY,
    select: { id: true, role: true, content: true, createdAt: true },
  });

  return NextResponse.json({
    messages: rows.reverse().map((row) => ({
      id: row.id,
      role: row.role,
      content: row.content,
      createdAt: row.createdAt.toISOString(),
    })),
  });
}
