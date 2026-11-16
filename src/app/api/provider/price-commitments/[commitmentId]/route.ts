import { NextResponse } from "next/server";
import { requireProviderMutation, readHoaBody, hoaErrorResponse } from "@/lib/server/hoa-api";
import { acceptPriceLadder } from "@/lib/server/price-ladder";
export async function POST(request:Request,context:{params:Promise<{commitmentId:string}>}) {
 const gate=await requireProviderMutation();if(!gate.ok)return gate.response;
 const body=await readHoaBody(request);if(!body.ok)return body.response;
 if(!body.value || typeof body.value!=="object" || (body.value as {acceptTerms?:unknown}).acceptTerms!==true) return NextResponse.json({error:"Accept the full-term prices and retained discounts."},{status:400});
 try{return NextResponse.json(await acceptPriceLadder(gate.user.id,(await context.params).commitmentId));}catch(e){return hoaErrorResponse("provider price commitment",e);}
}
