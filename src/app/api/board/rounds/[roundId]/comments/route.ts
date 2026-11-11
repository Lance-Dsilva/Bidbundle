import { NextResponse } from "next/server";
import { boardRoute, readBoardBody } from "@/lib/server/board-api";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
import { addBoardComment } from "@/lib/server/board-review";
import { boardCommentSchema } from "@/lib/validation/board";
type Context = {params:Promise<{roundId:string} >};
export const POST=boardRoute("board comments",async (request,context:Context,user)=>NextResponse.json(await addBoardComment(user.id,(await context.params).roundId,await readBoardBody(request,boardCommentSchema))));
