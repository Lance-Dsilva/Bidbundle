import "server-only";
import {z} from "zod";
import {authorizeRequest} from "@/lib/server/auth";
import {guardHoaMutation,guardFailureResponse} from "@/lib/server/auth-guard";
import {readHoaBody,hoaErrorResponse} from "@/lib/server/hoa-api";
import {HoaWorkflowError} from "@/lib/server/hoa";
import {listRecurringPlans,getRecurringPlanView,getRecurringOffer,proposeRecurringPlan,acceptRecurringPlan,startRecurringSubscription,confirmRecurringSubscription,abandonRecurringEnrollment,requestRecurringStop,endRecurringPlan} from "@/lib/server/recurring-plans";
const id=z.string().min(1).max(128),date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const action=z.discriminatedUnion("action",[
 z.strictObject({action:z.literal("offer")}),
 z.strictObject({action:z.literal("accept"),termsToken:id}),
 z.strictObject({action:z.literal("start"),id:z.string().uuid(),startDate:date,termsToken:id,accepted:z.literal(true)}),
 z.strictObject({action:z.literal("confirm"),subscriptionId:id,setupIntentId:z.string().regex(/^seti_[A-Za-z0-9]+$/)}),
 z.strictObject({action:z.literal("abandon"),subscriptionId:id}),
 z.strictObject({action:z.literal("stop"),subscriptionId:id,kind:z.enum(["pause","cancel"])}),
 z.strictObject({action:z.literal("end")}),
]);
const proposal=z.strictObject({id:z.string().uuid(),agreementId:id,monthlyPriceCents:z.number().int().min(50).max(10000000),billingMode:z.enum(["monthly","per_visit"]),anchorDate:date,cadenceDays:z.number().int().min(1).max(31)});
const privateResponse=(r:Response)=>{r.headers.set("Cache-Control","private, no-store");r.headers.set("X-Content-Type-Options","nosniff");return r;};
const failure=(e:unknown)=>privateResponse(hoaErrorResponse("Recurring plans",e instanceof HoaWorkflowError?e:new HoaWorkflowError("Recurring service is temporarily unavailable. Refresh before retrying.",503)));
async function gate(write:boolean){const g=await authorizeRequest(["homeowner","hoa_staff","provider","admin"]);if(!g.ok)return g;if(write){const limited=await guardHoaMutation(g.user.id);if(limited)return{ok:false as const,response:guardFailureResponse(limited)};}return g;}
type Context={params:Promise<{planId:string}>};
export async function getRecurringPlan(_request:Request,context:Context){const g=await gate(false);if(!g.ok)return privateResponse(g.response);try{return privateResponse(Response.json(await getRecurringPlanView(g.user.id,(await context.params).planId)));}catch(e){return failure(e);}}
export async function mutateRecurringPlan(request:Request,context:Context){const g=await gate(true);if(!g.ok)return privateResponse(g.response);const body=await readHoaBody(request);if(!body.ok)return privateResponse(body.response);const parsed=action.safeParse(body.value);if(!parsed.success)return privateResponse(Response.json({error:"Review the recurring service action."},{status:400}));
 try{const planId=(await context.params).planId,actor=g.user.id,data=parsed.data;
  // Resolve current plan scope before any mutation; domain methods recheck authority.
  const view=await getRecurringPlanView(actor,planId);
  if(data.action==="offer")return privateResponse(Response.json(await getRecurringOffer(actor,planId)));
  if(data.action==="start")return privateResponse(Response.json(await startRecurringSubscription(actor,planId,data)));
  if(data.action==="accept")await acceptRecurringPlan(actor,planId,data.termsToken);
  else if(data.action==="confirm")await confirmRecurringSubscription(actor,planId,data.subscriptionId,data.setupIntentId);
  else if(data.action==="end")await endRecurringPlan(actor,planId);
  else {if(!view.subscriptions.some(s=>s.id===data.subscriptionId))throw new HoaWorkflowError("Enrollment not found.",404);if(data.action==="abandon")await abandonRecurringEnrollment(actor,data.subscriptionId);else await requestRecurringStop(actor,data.subscriptionId,data.kind);}
  // Never serialize raw subscription records containing payment/customer identifiers.
  return privateResponse(Response.json(await getRecurringPlanView(actor,planId)));
 }catch(e){return failure(e);}}
export async function createRecurringPlan(request:Request){const g=await gate(true);if(!g.ok)return privateResponse(g.response);const body=await readHoaBody(request);if(!body.ok)return privateResponse(body.response);const parsed=proposal.safeParse(body.value);if(!parsed.success)return privateResponse(Response.json({error:"Review the recurring plan price, dates and billing mode."},{status:400}));try{const p=await proposeRecurringPlan(g.user.id,parsed.data);return privateResponse(Response.json(await getRecurringPlanView(g.user.id,p.id)));}catch(e){return failure(e);}}

export async function listRecurringPlanViews(request:Request){const g=await gate(false);if(!g.ok)return privateResponse(g.response);const query=z.strictObject({communityId:id.optional()}).safeParse(Object.fromEntries(new URL(request.url).searchParams));if(!query.success)return privateResponse(Response.json({error:"Review the community filter."},{status:400}));try{return privateResponse(Response.json(await listRecurringPlans(g.user.id,query.data.communityId)));}catch(e){return failure(e);}}
