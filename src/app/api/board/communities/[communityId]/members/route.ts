import { NextResponse } from "next/server";
import { boardRoute, readBoardBody } from "@/lib/server/board-api";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
import { z } from "zod";
import { db } from "@/lib/server/db";
import { requireBoardViewer } from "@/lib/server/board-review";
import { HoaWorkflowError, inviteHoaBoard, serializeInvitation } from "@/lib/server/hoa";
const schema = z.object({ email: z.string().trim().email().max(254), fullName: z.string().trim().min(1).max(120) }).strict();
type Context = { params: Promise<{ communityId: string }> };
export const GET = boardRoute("board members", async (_request, context: Context, user) => {
 const communityId = (await context.params).communityId;
 if (!(await requireBoardViewer(user.id, communityId)).canManage) throw new HoaWorkflowError("Only the manager can manage board invitations.",403);
 const invitations = await db.communityInvitation.findMany({where:{communityId,role:"hoa_board"},orderBy:{invitedAt:"desc"},take:100});
 return NextResponse.json({invitations:invitations.map(serializeInvitation)});
});
export const POST = boardRoute("invite board member", async (request, context: Context, user) => {
 const body=await readBoardBody(request,schema);
 return NextResponse.json({invitation:await inviteHoaBoard({...body,actorUserId:user.id,actorEmail:user.email,communityId:(await context.params).communityId,requestUrl:request.url})},{status:201});
});
