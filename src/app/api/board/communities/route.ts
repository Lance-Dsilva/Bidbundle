import { NextResponse } from "next/server";
import { boardRoute, readBoardBody } from "@/lib/server/board-api";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
import { listBoardCommunities } from "@/lib/server/board-review";
export const GET = boardRoute("board communities", async (_request, _context, user) => NextResponse.json({ communities: await listBoardCommunities(user.id) }));
