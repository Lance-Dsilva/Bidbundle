import { NextResponse } from "next/server";
import { boardRoute, readBoardBody } from "@/lib/server/board-api";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
import { castBoardVote } from "@/lib/server/board-review";
import { boardVoteSchema } from "@/lib/validation/board";
type Context = {params:Promise<{roundId:string} >};
export const PUT=boardRoute("board votes",async (request,context:Context,user)=>NextResponse.json(await castBoardVote(user.id,(await context.params).roundId,await readBoardBody(request,boardVoteSchema))));
