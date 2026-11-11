import { NextResponse } from "next/server";
import { boardRoute, readBoardBody } from "@/lib/server/board-api";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
import { revokeBoardMember } from "@/lib/server/board-review";
type Context = { params: Promise<{communityId:string;memberId:string}> };
export const DELETE=boardRoute("revoke board member",async (_request,context:Context,user)=>{const p=await context.params;await revokeBoardMember(user.id,p.communityId,p.memberId);return NextResponse.json({revoked:true});});
