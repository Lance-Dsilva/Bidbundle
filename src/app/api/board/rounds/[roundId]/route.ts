import { NextResponse } from "next/server";
import { boardRoute } from "@/lib/server/board-api";
import { cancelBoardReview } from "@/lib/server/board-review";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ roundId: string }> };
export const DELETE = boardRoute<Context>("cancel board review", async (_request, context, user) => {
  await cancelBoardReview(user.id, (await context.params).roundId);
  return NextResponse.json({ cancelled: true });
});
