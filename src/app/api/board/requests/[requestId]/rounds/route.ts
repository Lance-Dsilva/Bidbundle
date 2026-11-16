import { NextResponse } from "next/server";
import { boardRoute, readBoardBody } from "@/lib/server/board-api";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
import { openBoardReview } from "@/lib/server/board-review";
import { boardOpenSchema } from "@/lib/validation/board";
type Context = {params:Promise<{requestId:string}>};
export const POST=boardRoute("open board vote",async (request,context:Context,user)=>NextResponse.json(await openBoardReview(user.id,(await context.params).requestId,await readBoardBody(request,boardOpenSchema)),{status:201}));
