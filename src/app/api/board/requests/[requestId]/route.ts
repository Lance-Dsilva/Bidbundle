import { NextResponse } from "next/server";
import { boardRoute, readBoardBody } from "@/lib/server/board-api";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
import { getBoardReview } from "@/lib/server/board-review";
type Context = {params:Promise<{requestId:string}>};
export const GET=boardRoute("board proposal review",async (_request,context:Context,user)=>NextResponse.json(await getBoardReview(user.id,(await context.params).requestId)));
