import "server-only";
import { createHash } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/server/db";
import { HoaWorkflowError } from "@/lib/server/hoa";
import { publicSharingEnabled, PUBLIC_REQUEST_STATUSES, canonicalShareUrl } from "@/lib/server/public-request-sharing";
import { CATEGORY_LABELS, normalizeServiceCategory } from "@/lib/service-categories";
import { isEmailConfigured } from "@/lib/server/email";
import { buildPreferenceAwareNotificationOps, scheduleOutboxDrain } from "@/lib/server/notifications";
import { buildAuditEntry } from "@/lib/server/audit";

async function snapshot(tx: Prisma.TransactionClient, userId: string, requestId: string, lockAudience = false) {
  if (!publicSharingEnabled()) throw new HoaWorkflowError("Request sharing is unavailable.",404);
  await tx.$queryRaw`SELECT "id" FROM "HoaServiceRequest" WHERE "id"=${requestId} FOR UPDATE`;
  const request = await tx.hoaServiceRequest.findUnique({ where: { id:requestId }, include: { publicShare:true, community:{include:{publicShare:true}} } });
  if (!request || request.kind!=="optional_group" || !(PUBLIC_REQUEST_STATUSES as readonly string[]).includes(request.status)) throw new HoaWorkflowError("Shared request unavailable.",404);
  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id"=${userId} FOR SHARE`;
  await tx.$queryRaw`SELECT "id" FROM "Community" WHERE "id"=${request.communityId} FOR SHARE`;
  await tx.$queryRaw`SELECT "id" FROM "CommunityStaffAssignment" WHERE "userId"=${userId} AND "communityId"=${request.communityId} FOR SHARE`;
  const actor=await tx.user.findUnique({where:{id:userId},select:{isVerified:true,role:true}});
  const assignment=await tx.communityStaffAssignment.findFirst({where:{userId,communityId:request.communityId,status:"active",role:{in:["hoa_manager","hoa_team"]},community:{status:"active",type:"hoa"}},select:{id:true}});
  if (!assignment || !actor?.isVerified || actor.role!=="hoa_staff") throw new HoaWorkflowError("You do not manage this HOA.",403);
  if (!request.publicShare?.enabled || !request.community.publicShare) throw new HoaWorkflowError("Enable request sharing before emailing residents.",409);
  const audienceQuery = {where:{communityId:request.communityId,status:"active" as const,unitId:{not:null},unit:{occupancyStatus:"occupied" as const},user:{role:"homeowner" as const,isVerified:true}},select:{id:true,unitId:true,user:{select:{id:true,email:true,homeownerProfile:{select:{notifyEmail:true}}}}},orderBy:{userId:"asc" as const}};
  let rows=await tx.communityMembership.findMany(audienceQuery);
  if (lockAudience && rows.length) {
    const userIds=rows.map(row=>row.user.id).sort(), unitIds=rows.map(row=>row.unitId!).sort(), membershipIds=rows.map(row=>row.id).sort();
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id"=ANY(${userIds}::text[]) ORDER BY "id" FOR SHARE`;
    await tx.$queryRaw`SELECT "id" FROM "CommunityUnit" WHERE "id"=ANY(${unitIds}::text[]) ORDER BY "id" FOR SHARE`;
    await tx.$queryRaw`SELECT "id" FROM "CommunityMembership" WHERE "id"=ANY(${membershipIds}::text[]) ORDER BY "id" FOR SHARE`;
    await tx.$queryRaw`SELECT "userId" FROM "HomeownerProfile" WHERE "userId"=ANY(${userIds}::text[]) ORDER BY "userId" FOR SHARE`;
    const current=await tx.communityMembership.findMany(audienceQuery);
    if (current.some(row=>!membershipIds.includes(row.id) || !userIds.includes(row.user.id) || !unitIds.includes(row.unitId!))) throw new HoaWorkflowError("The audience changed. Preview the message again.",409);
    rows=current;
  }
  const path=`/c/${request.community.publicShare.token}/r/${request.publicShare.token}`;
  const category=normalizeServiceCategory(request.category), service=category?CATEGORY_LABELS[category]:"Community service";
  const subject=`Join a community ${service.toLowerCase()} request`;
  const body=`Your HOA has shared a community service request. Review the provider commitment, maximum price and current sign-up deadline before deciding whether to join.\n\n${canonicalShareUrl(path)}\n\nJoining requires confirming your home and explicitly accepting the payment terms. You are receiving this because you are a resident of this HOA.`;
  const recipients=rows.map(row=>row.user);
  const previewToken=createHash("sha256").update(JSON.stringify([requestId,userId,path,subject,body,Math.floor(Date.now()/600000),recipients.map(r=>[r.id,r.email,r.homeownerProfile?.notifyEmail!==false])])).digest("hex");
  return {request,recipients,path,subject,body,previewToken,enabled:isEmailConfigured(),recipientCount:recipients.length,emailCount:recipients.filter(r=>r.homeownerProfile?.notifyEmail!==false).length};
}
export async function previewSharedRequestBroadcast(userId:string,requestId:string) {
  return db.$transaction(async tx=>{const {request: _request,recipients: _recipients,...result}=await snapshot(tx,userId,requestId);return result;});
}
export async function sendSharedRequestBroadcast(userId:string,requestId:string,previewToken:string) {
  const result=await db.$transaction(async tx=>{
    const s=await snapshot(tx,userId,requestId,true);
    if (!s.enabled) throw new HoaWorkflowError("Resident email delivery is not configured.",503);
    if (s.previewToken!==previewToken) throw new HoaWorkflowError("The request or audience changed. Preview the message again.",409);
    const ops=await buildPreferenceAwareNotificationOps(s.recipients.map(r=>({userId:r.id,email:r.email,emailPolicy:"respect_preference" as const,kind:"account" as const,title:s.subject,body:s.body,linkPath:s.path,dedupeKey:`shared-request:${s.previewToken}:${r.id}`})),tx);
    await Promise.all(ops);
    await tx.adminAuditLog.create({data:buildAuditEntry({actorUserId:userId,action:"broadcast_sent",targetType:"community",targetId:s.request.communityId,communityId:s.request.communityId,metadata:{unitCount:s.recipientCount,category:"shared_request"}})});
    return {queued:true,recipientCount:s.recipientCount,emailCount:s.emailCount};
  });
  scheduleOutboxDrain();
  return result;
}
