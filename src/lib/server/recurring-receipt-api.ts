import 'server-only';
import {authorizeRequest} from '@/lib/server/auth';
import {HoaWorkflowError} from '@/lib/server/hoa';
import {hoaErrorResponse} from '@/lib/server/hoa-api';
import {getRecurringReceipt} from '@/lib/server/recurring-payments';
const privateResponse=(response:Response)=>{response.headers.set('Cache-Control','private, no-store');response.headers.set('Referrer-Policy','no-referrer');response.headers.set('X-Content-Type-Options','nosniff');return response;};
export async function recurringReceipt(_request:Request,context:{params:Promise<{chargeId:string}>}){
 const auth=await authorizeRequest(['homeowner','hoa_staff','provider','admin']);
 if(!auth.ok)return privateResponse(auth.response);
 try{
  const {chargeId}=await context.params;
  if(!chargeId||chargeId.length>128)throw new HoaWorkflowError('Receipt not found.',404);
  const receipt=await getRecurringReceipt(auth.user.id,chargeId);
  // Defense in depth: never redirect an authenticated request to an arbitrary URL.
  const url=new URL(receipt);
  if(url.protocol!=='https:'||url.hostname!=='pay.stripe.com'||url.port||url.username||url.password||!url.pathname.startsWith('/receipts/'))throw new HoaWorkflowError('Receipt is unavailable.',409);
  return privateResponse(new Response(null,{status:302,headers:{Location:url.href}}));
 }catch(error){return privateResponse(hoaErrorResponse('Recurring receipt',error instanceof HoaWorkflowError?error:new HoaWorkflowError('Receipt is temporarily unavailable.',503)));}
}
