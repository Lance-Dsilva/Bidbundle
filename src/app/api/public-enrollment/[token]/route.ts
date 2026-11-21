import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireHoaMutation, readHoaBody, hoaErrorResponse } from "@/lib/server/hoa-api";
import { confirmSharedEnrollmentAddress, startSharedEnrollmentBilling, confirmSharedEnrollmentBilling, restartSharedEnrollmentBilling } from "@/lib/server/shared-enrollment";
import { SHARED_ENROLLMENT_COOKIE, sameOriginMutation, privateEnrollmentResponse as protect } from "@/lib/server/shared-enrollment-http";
export const runtime = "nodejs";
const address = z.strictObject({addressLine1:z.string().trim().min(1).max(200),locality:z.string().trim().min(1).max(100),region:z.string().trim().min(1).max(100),postalCode:z.string().trim().min(1).max(20),unitLabel:z.string().trim().max(100).optional()});
const schema = z.discriminatedUnion("action",[
 z.strictObject({action:z.literal("restart")}),
 z.strictObject({action:z.literal("address"),address}),
 z.strictObject({action:z.literal("start"),accepted:z.literal(true),termsToken:z.string().regex(/^[a-f0-9]{64}$/),savedCardReference:z.string().regex(/^[a-f0-9]{64}$/).optional()}),
 z.strictObject({action:z.literal("join"),setupIntentId:z.string().max(128).regex(/^seti_[A-Za-z0-9]+$/)})
]);
export async function POST(request:Request,context:{params:Promise<{token:string}>}){
 if(!sameOriginMutation(request))return protect(NextResponse.json({error:"Refresh the service page before continuing."},{status:403}));
 const gate=await requireHoaMutation();if(!gate.ok)return protect(gate.response);
 const {token}=await context.params;
 if(!/^[A-Za-z0-9_-]{32}$/.test(token)||(await cookies()).get(SHARED_ENROLLMENT_COOKIE)?.value!==token)return protect(NextResponse.json({error:"Open the service link again to continue."},{status:403}));
 const body=await readHoaBody(request);if(!body.ok)return protect(body.response);
 const parsed=schema.safeParse(body.value);if(!parsed.success)return protect(NextResponse.json({error:"Check the enrollment details."},{status:400}));
 try{
  const d=parsed.data;
  const result=d.action==="restart"?await restartSharedEnrollmentBilling(gate.user.id,token):d.action==="address"?await confirmSharedEnrollmentAddress(gate.user.id,token,d.address):d.action==="start"?await startSharedEnrollmentBilling(gate.user.id,token,d):await confirmSharedEnrollmentBilling(gate.user.id,token,d.setupIntentId);
  return protect(NextResponse.json(result));
 }catch(error){return protect(hoaErrorResponse("Shared enrollment",error));}
}
