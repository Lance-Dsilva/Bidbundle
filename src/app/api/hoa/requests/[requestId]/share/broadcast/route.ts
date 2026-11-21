import { NextResponse } from "next/server";
import { z } from "zod";
import { requireHoaMutation, readHoaBody, hoaErrorResponse } from "@/lib/server/hoa-api";
import { previewSharedRequestBroadcast, sendSharedRequestBroadcast } from "@/lib/server/shared-request-broadcast";
import { sameOriginMutation, privateEnrollmentResponse as protect } from "@/lib/server/shared-enrollment-http";
export const runtime="nodejs";
const schema=z.discriminatedUnion("action",[z.strictObject({action:z.literal("preview")}),z.strictObject({action:z.literal("send"),previewToken:z.string().min(1).max(256)})]);
export async function POST(request:Request,context:{params:Promise<{requestId:string}>}){
 if(!sameOriginMutation(request))return protect(NextResponse.json({error:"Refresh this page before continuing."},{status:403}));
 const gate=await requireHoaMutation();if(!gate.ok)return protect(gate.response);
 const body=await readHoaBody(request);if(!body.ok)return protect(body.response);
 const parsed=schema.safeParse(body.value);if(!parsed.success)return protect(NextResponse.json({error:"Review the resident message before sending."},{status:400}));
 const {requestId}=await context.params;
 try{return protect(NextResponse.json(parsed.data.action==="preview"?await previewSharedRequestBroadcast(gate.user.id,requestId):await sendSharedRequestBroadcast(gate.user.id,requestId,parsed.data.previewToken)));}
 catch(error){return protect(hoaErrorResponse("Shared request message",error));}
}
