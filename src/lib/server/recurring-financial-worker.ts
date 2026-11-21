import { notifyRecurringPaymentProblem } from "@/lib/server/recurring-payment-notifications";
import "server-only";
import { db } from "@/lib/server/db";
import { sealRecurringMonth } from "@/lib/server/recurring-plans";
import { chargeRecurringSource } from "@/lib/server/recurring-payments";
import { transferRecurringCharge } from "@/lib/server/recurring-transfers";
import { processRecurringRefund } from "@/lib/server/recurring-refunds";
type Candidate={key:string;planId:string;subscriptionId:string;month:string;visitId:string|null};
/** Bounded fair scan: durable cursor advances even for a source needing intervention. */
async function candidates(){return db.$transaction(async tx=>{
 await tx.recurringFinancialCursor.upsert({where:{id:"sources"},create:{id:"sources"},update:{}});
 await tx.$queryRaw`SELECT id FROM "RecurringFinancialCursor" WHERE id='sources' FOR UPDATE`;
 const cursor=await tx.recurringFinancialCursor.findUniqueOrThrow({where:{id:"sources"}});
 const page=(after:string)=>tx.$queryRaw<Candidate[]>`
 WITH sources AS (
  SELECT DISTINCT 'monthly:'||p.id||':'||s.id||':'||v."recurringMonth" AS key,p.id AS "planId",s.id AS "subscriptionId",v."recurringMonth" AS month,NULL::text AS "visitId"
  FROM "ServiceVisit" v JOIN "RecurringSubscription" s ON s.id=v."recurringSubscriptionId" JOIN "RecurringPlan" p ON p.id=s."planId"
  WHERE p."billingMode"='monthly' AND v."redoOfVisitId" IS NULL AND v."recurringMonth"<to_char(clock_timestamp() AT TIME ZONE p.timezone,'YYYY-MM')
   AND NOT EXISTS(SELECT 1 FROM "RecurringMonthlyBill" b WHERE b."planId"=p.id AND b."subscriptionId"=s.id AND b.month=v."recurringMonth" AND b."amountCents"=0)
   AND NOT EXISTS(SELECT 1 FROM "RecurringMonthlyBill" b JOIN "RecurringCharge" c ON c."monthlyBillId"=b.id WHERE b."planId"=p.id AND b."subscriptionId"=s.id AND b.month=v."recurringMonth")
  UNION ALL
  SELECT 'visit:'||v.id,p.id,s.id,v."recurringMonth",v.id FROM "ServiceVisit" v JOIN "RecurringSubscription" s ON s.id=v."recurringSubscriptionId" JOIN "RecurringPlan" p ON p.id=s."planId"
  WHERE p."billingMode"='per_visit' AND v.status='completed' AND v."completedAt" IS NOT NULL AND v."redoOfVisitId" IS NULL AND NOT EXISTS(SELECT 1 FROM "RecurringCharge" c WHERE c."sourceVisitId"=v.id)
 ) SELECT * FROM sources WHERE key>${after} ORDER BY key LIMIT 10`;
 let rows=await page(cursor.lastKey??"");if(!rows.length&&cursor.lastKey)rows=await page("");
 await tx.recurringFinancialCursor.update({where:{id:"sources"},data:{lastKey:rows.at(-1)?.key??null}});
 return rows;
});}
export async function runRecurringFinancialWorker(){
 const result={prepared:0,reconciled:0,transferred:0,refunded:0,failed:0};
 if(process.env.RECURRING_PLANS!=="1"||process.env.RECURRING_TEST_PAYMENTS!=="1"||process.env.STRIPE_TEST_PAYMENTS!=="1")return result;
 for(const source of await candidates()){
  try{if(source.visitId)await chargeRecurringSource({visitId:source.visitId});else{const bill=await sealRecurringMonth(source.planId,source.subscriptionId,source.month);if(bill.amountCents>0)await chargeRecurringSource({monthlyBillId:bill.id});}result.prepared++;}catch{result.failed++;}
 }
 const pending=await db.recurringCharge.findMany({where:{status:{in:["pending","processing","failed","requires_action"]},reconciliationHoldReason:null},orderBy:{updatedAt:"asc"},take:10});
 for(const c of pending){try{await chargeRecurringSource(c.monthlyBillId?{monthlyBillId:c.monthlyBillId}:{visitId:c.sourceVisitId!});await notifyRecurringPaymentProblem(c.id);result.reconciled++;}catch{result.failed++;}finally{await db.recurringCharge.update({where:{id:c.id},data:{updatedAt:new Date()}});}}
 const refunds=await db.recurringChargeRefund.findMany({where:{status:{in:["pending","reversal_pending"]}},orderBy:{updatedAt:"asc"},take:10});
 for(const r of refunds){try{await processRecurringRefund(r.id);result.refunded++;}catch{result.failed++;}finally{await db.recurringChargeRefund.update({where:{id:r.id},data:{updatedAt:new Date()}});}}
 const unpaid=await db.recurringCharge.findMany({where:{stripeTransferId:null,status:{in:["succeeded","partially_refunded"]}},orderBy:{updatedAt:"asc"},take:10});
 for(const c of unpaid){try{await transferRecurringCharge(c.id);result.transferred++;}catch{result.failed++;}finally{await db.recurringCharge.update({where:{id:c.id},data:{updatedAt:new Date()}});}}
 return result;
}
