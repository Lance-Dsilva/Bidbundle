import "server-only";
import { db } from "@/lib/server/db";
import { enqueueNotifications } from "@/lib/server/notifications";
export async function notifyRecurringPaymentProblem(id:string){
 if(process.env.RECURRING_TEST_PAYMENTS!=="1")return;
 const c=await db.recurringCharge.findUnique({where:{id}});
 if(!c||!["failed","requires_action"].includes(c.status))return;
 const [payer,admins,attempt]=await Promise.all([db.user.findUnique({where:{id:c.payerUserId},select:{id:true,email:true}}),db.user.findMany({where:{role:"admin",adminAccess:{status:"active"}},select:{id:true,email:true}}),db.recurringChargeRecovery.findFirst({where:{chargeId:id},orderBy:{sequence:"desc"},select:{sequence:true}})]);
 const version=attempt?.sequence??0;
 await enqueueNotifications([
  ...(payer?[{userId:payer.id,email:payer.email,kind:"account" as const,emailLinkOrigin:"stripe_test" as const,emailPolicy:"required" as const,title:"Recurring sandbox payment needs attention",body:c.status==="requires_action"?"Your bank needs you to verify this test payment. Sign in to continue.":"Your recurring test payment did not complete. Sign in to review the original amount and choose another test card.",linkPath:`/app/recurring-plans/${encodeURIComponent(c.planId)}`,dedupeKey:`recurring-payment:${id}:${version}:${c.status}:${payer.id}`}]:[]),
  ...admins.map(a=>({userId:a.id,email:a.email,kind:"account" as const,emailLinkOrigin:"stripe_test" as const,emailPolicy:"required" as const,title:"Recurring sandbox payment needs attention",body:"A recurring test payment requires follow-up. This notice does not authorize a provider transfer.",linkPath:"/app/admin",dedupeKey:`recurring-payment:${id}:${version}:${c.status}:${a.id}`}))
 ]);
}
