import 'server-only';
import {z} from 'zod';
import {authorizeRequest} from '@/lib/server/auth';
import {guardHoaMutation,guardFailureResponse} from '@/lib/server/auth-guard';
import {readHoaBody,hoaErrorResponse} from '@/lib/server/hoa-api';
import {HoaWorkflowError} from '@/lib/server/hoa';
import {getRecurringRecovery,startRecurringRecoveryCard,retryRecurringPayment} from '@/lib/server/recurring-payment-recovery';
const bodySchema=z.discriminatedUnion('action',[
 z.strictObject({action:z.literal('status')}),
 z.strictObject({action:z.literal('start_card')}),
 z.strictObject({action:z.literal('retry'),setupIntentId:z.string().regex(/^seti_[A-Za-z0-9]+$/),termsToken:z.string().min(1).max(128),accepted:z.literal(true)}),
]);
const privateResponse=(response:Response)=>{response.headers.set('Cache-Control','private, no-store');response.headers.set('X-Content-Type-Options','nosniff');return response;};
export async function recurringRecoveryAction(request:Request,context:{params:Promise<{chargeId:string}>}){
 const auth=await authorizeRequest(['homeowner','hoa_staff','provider','admin']);
 if(!auth.ok)return privateResponse(auth.response);
 const limited=await guardHoaMutation(auth.user.id);
 if(limited)return privateResponse(guardFailureResponse(limited));
 const body=await readHoaBody(request);if(!body.ok)return privateResponse(body.response);
 const parsed=bodySchema.safeParse(body.value);
 if(!parsed.success)return privateResponse(Response.json({error:'Review the payment recovery action.'},{status:400}));
 try{
  const {chargeId}=await context.params;
  if(!chargeId||chargeId.length>128)return privateResponse(Response.json({error:'Payment not found.'},{status:404}));
  const actor=auth.user.id,data=parsed.data;
  const result=data.action==='status'?await getRecurringRecovery(actor,chargeId):data.action==='start_card'?await startRecurringRecoveryCard(actor,chargeId):await retryRecurringPayment(actor,chargeId,data);
  return privateResponse(Response.json({id:chargeId,amountCents:result.amountCents,currency:result.currency,termsToken:result.termsToken,clientSecret:result.clientSecret,...('status' in result?{status:result.status}:{})}));
 }catch(error){
  return privateResponse(hoaErrorResponse('Recurring payment recovery',error instanceof HoaWorkflowError?error:new HoaWorkflowError('Payment recovery is temporarily unavailable. Refresh before retrying.',503)));
 }
}
