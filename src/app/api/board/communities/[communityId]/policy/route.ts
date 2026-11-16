import { NextResponse } from "next/server";
import { boardRoute, readBoardBody } from "@/lib/server/board-api";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
import { setBoardPolicy } from "@/lib/server/board-review";
import { boardPolicySchema } from "@/lib/validation/board";
type Context = { params: Promise<{ communityId: string }> };
export const PUT = boardRoute("board policy", async (request, context: Context, user) => NextResponse.json(await setBoardPolicy(user.id, (await context.params).communityId, await readBoardBody(request, boardPolicySchema))));
