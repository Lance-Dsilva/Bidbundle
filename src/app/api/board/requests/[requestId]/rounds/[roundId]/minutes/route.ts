import { NextResponse } from "next/server";
import { boardRoute, readBoardBody } from "@/lib/server/board-api";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
import { getBoardReview } from "@/lib/server/board-review";
import { renderBoardMinutes } from "@/lib/server/board-minutes";
type Context={params:Promise<{requestId:string;roundId:string}>};
export const GET=boardRoute("board minutes export",async (_request,context:Context,user)=>{const p=await context.params;const view=await getBoardReview(user.id,p.requestId);const bytes=await renderBoardMinutes(view,p.roundId);return new Response(new Uint8Array(bytes),{headers:{"Content-Type":"application/pdf","Content-Disposition":"attachment; filename=board-review-minutes.pdf","Content-Security-Policy":"sandbox"}});});
