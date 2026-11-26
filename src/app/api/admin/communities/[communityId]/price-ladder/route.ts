import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminOwner, requireAdminOwnerMutation, readAdminBody, adminErrorResponse, validationErrorResponse } from "@/lib/server/admin-api";
import { commitPriceLadder } from "@/lib/server/price-ladder";
import { validatePriceLadder } from "@/lib/price-ladder";
import { db } from "@/lib/server/db";
import { fieldErrors } from "@/lib/validation/profile";
export const runtime = "nodejs";
const schema = z.object({ requestId: z.string().min(1).max(64), providerUserId: z.string().min(1).max(64), scope: z.string().trim().min(1).max(2000), providerAgreementConfirmed: z.literal(true), tiers: z.unknown().transform((value, ctx) => { try { return validatePriceLadder(value); } catch (e) { ctx.addIssue({ code: "custom", message: e instanceof Error ? e.message : "Invalid tiers" }); return z.NEVER; } }) }).strict();
export async function POST(request: Request, context: { params: Promise<{ communityId: string }> }) {
 const gate=await requireAdminOwnerMutation(); if(!gate.ok) return gate.response;
 const body=await readAdminBody(request,8192); if(!body.ok) return body.response;
 const parsed=schema.safeParse(body.value); if(!parsed.success) return validationErrorResponse(fieldErrors(parsed.error));
 try { const {communityId}=await context.params; const result=await commitPriceLadder(gate.user.id,communityId,parsed.data); return NextResponse.json({id:result.id},{status:201}); }
 catch(error){return adminErrorResponse("price commitment",error);}
}

export async function GET(_request:Request,context:{params:Promise<{communityId:string}>}) {
 const gate=await requireAdminOwner();if(!gate.ok)return gate.response;
 try {const {communityId}=await context.params;const [requests,providers]=await Promise.all([
 db.hoaServiceRequest.findMany({where:{communityId,community:{status:"active"},kind:"optional_group",status:{in:["draft","collecting_interest"]},participations:{none:{}},priceCommitment:{is:null}},select:{id:true,title:true},take:100}),
 db.user.findMany({where:{role:"provider",providerProfile:{accountStatus:"active"}},select:{id:true,fullName:true,providerProfile:{select:{companyName:true}}},take:100})
 ]);return NextResponse.json({requests,providers:providers.map(p=>({id:p.id,name:p.providerProfile?.companyName||p.fullName}))},{headers:{"Cache-Control":"private, no-store"}});}catch(e){return adminErrorResponse("price commitment choices",e);}
}
