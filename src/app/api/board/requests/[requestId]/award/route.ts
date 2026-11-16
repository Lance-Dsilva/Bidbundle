import { NextResponse } from "next/server";
import { boardRoute, readBoardBody } from "@/lib/server/board-api";
import { getBoardReview } from "@/lib/server/board-review";
import { HoaWorkflowError } from "@/lib/server/hoa";
import { awardBid } from "@/lib/server/hoa-market";
import { awardSchema } from "@/lib/validation/hoa";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ requestId: string }> };
export const POST = boardRoute<Context>("board award", async (request, context, user) => {
  const requestId = (await context.params).requestId;
  const view = await getBoardReview(user.id, requestId);
  if (!view.canManage) throw new HoaWorkflowError("Only the HOA manager can confirm an award.", 403);
  const input = await readBoardBody(request, awardSchema);
  const agreementId = await awardBid(user.id, requestId, input);
  return NextResponse.json({ agreementId }, { status: 201 });
});
