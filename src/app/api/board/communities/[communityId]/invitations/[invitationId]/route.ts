import { NextResponse } from "next/server";
import { boardRoute, readBoardBody } from "@/lib/server/board-api";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
import { revokeHoaBoardInvitation } from "@/lib/server/hoa";
type Context = { params: Promise<{communityId:string;invitationId:string}> };
export const DELETE=boardRoute("revoke board invitation",async (_request,context:Context,user)=>{await revokeHoaBoardInvitation({...await context.params,actorUserId:user.id});return NextResponse.json({revoked:true});});
