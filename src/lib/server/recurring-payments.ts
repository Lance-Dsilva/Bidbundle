import "server-only";
import Stripe from "stripe";
import type { Prisma, RecurringCharge } from "@/generated/prisma/client";
import { db } from "@/lib/server/db";
import { HoaWorkflowError } from "@/lib/server/hoa";
import { recurringLineEntitlements, recurringLineRefundBalance } from "@/lib/recurring-financial-amounts";

function enabled() {
  if (process.env.RECURRING_PLANS !== "1" || process.env.RECURRING_TEST_PAYMENTS !== "1" || process.env.STRIPE_TEST_PAYMENTS !== "1") throw new HoaWorkflowError("Recurring sandbox payments are unavailable.",503);
}
/** Immutable source reservation only: no processor calls and no dispatch until SQL gates exist. */
export async function prepareRecurringCharge(source: { monthlyBillId: string } | { visitId: string }) {
  enabled();
  return db.$transaction(async tx => {
    const bill = "monthlyBillId" in source ? await tx.recurringMonthlyBill.findUnique({where:{id:source.monthlyBillId}}) : null;
    const sourceVisit = "visitId" in source ? await tx.serviceVisit.findUnique({where:{id:source.visitId}}) : null;
    const subscriptionId = bill?.subscriptionId ?? sourceVisit?.recurringSubscriptionId;
    if (!subscriptionId) throw new HoaWorkflowError("Recurring billing source not found.",404);
    const initialSub = await tx.recurringSubscription.findUniqueOrThrow({where:{id:subscriptionId}});
    const initialPlan = await tx.recurringPlan.findUniqueOrThrow({where:{id:initialSub.planId}});
    const billLines = bill ? await tx.recurringBillLine.findMany({where:{billId:bill.id,amountCents:{gt:0}},orderBy:{visitId:"asc"}}) : null;
    const visitIds = billLines?.map(l=>l.visitId) ?? [sourceVisit!.id];
    if (!visitIds.length) throw new HoaWorkflowError("No completed billable service exists.",409);
    // Completion and quality claims already lock Visit before Agreement.
    for (const id of visitIds) await tx.$queryRaw`SELECT "id" FROM "ServiceVisit" WHERE "id"=${id} FOR UPDATE`;

    await tx.$queryRaw`SELECT "id" FROM "ServiceAgreement" WHERE "id"=${initialPlan.agreementId} FOR UPDATE`;
    await tx.$queryRaw`SELECT "id" FROM "RecurringPlan" WHERE "id"=${initialPlan.id} FOR UPDATE`;
    const plan = await tx.recurringPlan.findUniqueOrThrow({where:{id:initialPlan.id}});
    const sub = await tx.recurringSubscription.findUniqueOrThrow({where:{id:subscriptionId}});
    const where = "monthlyBillId" in source ? {monthlyBillId:source.monthlyBillId} : {sourceVisitId:source.visitId};
    const existing = await tx.recurringCharge.findUnique({where});
    if (existing) return existing;
    if (!plan.acceptedAt || !sub.customerId || !sub.paymentMethodId || !sub.cardVerifiedAt ||
        (bill ? plan.billingMode !== "monthly" : plan.billingMode !== "per_visit")) throw new HoaWorkflowError("Recurring payment authorization is incomplete.",409);
    const visits = await tx.serviceVisit.findMany({where:{id:{in:visitIds}},include:{occurrence:true},orderBy:{id:"asc"}});
    if (visits.length !== visitIds.length || visits.some(v=>v.recurringSubscriptionId!==sub.id || v.unitId!==sub.unitId || v.billingPayerUserId!==sub.payerUserId || v.redoOfVisitId || v.status!=="completed" || !v.completedAt || sub.acceptedAt>v.completedAt || sub.cardVerifiedAt!>v.completedAt || v.occurrence.recurringPlanId!==plan.id || v.occurrence.agreementId!==plan.agreementId || !v.allocatedVisitCents || (bill && (v.recurringMonth!==bill.month || billLines!.find(l=>l.visitId===v.id)?.amountCents!==v.allocatedVisitCents)))) throw new HoaWorkflowError("Completed service does not match recurring authorization.",409);
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id"=${sub.payerUserId} FOR SHARE`;
    const payer=await tx.user.findUniqueOrThrow({where:{id:sub.payerUserId}});
    if (!payer.isVerified || payer.stripeTestCustomerId!==sub.customerId) throw new HoaWorkflowError("Original payer customer requires review.",409);
    await tx.$queryRaw`SELECT "userId" FROM "ProviderProfile" WHERE "userId"=${plan.providerUserId} FOR SHARE`;
    const provider=await tx.providerProfile.findUnique({where:{userId:plan.providerUserId}});
    if (provider?.accountStatus!=="active" || provider.stripeTestPayoutStatus!=="active" || !provider.stripeTestAccountId) throw new HoaWorkflowError("Provider sandbox payouts must be active.",409);
    await tx.$queryRaw`SELECT "id" FROM "Community" WHERE "id"=${plan.communityId} FOR UPDATE`;
    const community=await tx.community.findUniqueOrThrow({where:{id:plan.communityId}});
    const feeBps=Number(process.env.PLATFORM_FEE_BPS??"1000");
    const lines=visits.map(v=>({visitId:v.id,localDate:v.occurrence.recurringLocalDate!,...recurringLineEntitlements(v.allocatedVisitCents!,feeBps,community.hoaRevenueShareBps)}));
    const sum=(field:"grossCents"|"feeCents"|"providerCents"|"hoaCents")=>lines.reduce((n,l)=>n+l[field],0);
    if (bill && sum("grossCents")!==bill.amountCents) throw new HoaWorkflowError("Sealed monthly total changed.",409);
    const charge=await tx.recurringCharge.create({data:{monthlyBillId:bill?.id??null,sourceVisitId:bill?null:sourceVisit!.id,planId:plan.id,subscriptionId:sub.id,agreementId:plan.agreementId,communityId:plan.communityId,payerUserId:sub.payerUserId,providerUserId:plan.providerUserId,unitId:sub.unitId,localMonth:bill?.month??visits[0].recurringMonth!,customerId:sub.customerId,paymentMethodId:sub.paymentMethodId,receiptEmail:sub.receiptEmail,providerAccountId:provider.stripeTestAccountId,termsToken:sub.termsToken,currency:plan.currency,amountCents:sum("grossCents"),platformFeeCents:sum("feeCents"),providerAmountCents:sum("providerCents"),hoaShareCents:sum("hoaCents"),feeBps,hoaBps:community.hoaRevenueShareBps,reconciliationHoldReason:sum("grossCents")<50?"below_minimum":null}});
    await tx.recurringChargeLine.createMany({data:lines.map(({grossCents,feeCents,providerCents,hoaCents,visitId,localDate})=>({chargeId:charge.id,visitId,localDate,grossCents,feeCents,providerCents,hoaCents}))});
    return charge;
  });
}

export async function getRecurringPaymentHistory(actor: string, planId: string) {
  enabled();
  const user=await db.user.findUnique({where:{id:actor}});
  if (!user?.isVerified) throw new HoaWorkflowError("Sign in with a verified account.",403);
  const plan=await db.recurringPlan.findUnique({where:{id:planId}});
  if (!plan || (plan.providerUserId!==actor && !await db.recurringSubscription.findFirst({where:{planId,payerUserId:actor}}))) throw new HoaWorkflowError("Plan not found.",404);
  const provider=user.role==="provider"&&plan.providerUserId===actor;
  const charges=await db.recurringCharge.findMany({where:{planId,...(provider?{providerUserId:actor}:{payerUserId:actor})},orderBy:{createdAt:"desc"},take:100});
  return Promise.all(charges.map(async c=>{
    const lines=await db.recurringChargeLine.findMany({where:{chargeId:c.id},orderBy:{localDate:"asc"}});
    const providerNetCents=provider?lines.reduce((sum,l)=>sum+recurringLineRefundBalance(l,l.refundedCents).providerRemainingCents,0):null;
    return {id:c.id,planId:c.planId,sourceKind:c.monthlyBillId?"monthly" as const:"per_visit" as const,localMonth:c.localMonth,status:c.status,amountCents:c.amountCents,currency:c.currency,refundedCents:c.refundedCents,providerNetCents,receiptAvailable:c.payerUserId===actor&&!!c.stripeChargeId,holdReason:c.reconciliationHoldReason?"billing_review":null,canRecover:c.payerUserId===actor&&process.env.RECURRING_PLANS==="1"&&process.env.RECURRING_TEST_PAYMENTS==="1"&&process.env.STRIPE_TEST_PAYMENTS==="1"&&["failed","requires_action"].includes(c.status)&&!c.paidAt&&c.refundedCents===0&&!c.reconciliationHoldReason,lines:lines.map(l=>({visitId:l.visitId,localDate:l.localDate,grossCents:l.grossCents,refundedCents:l.refundedCents}))};
  }));
}

export function recurringTestClient() {
  enabled();
  const key=process.env.STRIPE_SECRET_KEY;
  if (!key || !/^(sk|rk)_test_[A-Za-z0-9]+$/.test(key)) throw new HoaWorkflowError("Recurring sandbox payments are unavailable.",503);
  return new Stripe(key,{timeout:8000,maxNetworkRetries:0});
}
export function recurringIntentMatches(intent: Stripe.PaymentIntent, charge: RecurringCharge, methods: string[] = []) {
  if ((charge.stripePaymentIntentId && intent.id!==charge.stripePaymentIntentId) || intent.livemode!==false || intent.amount!==charge.amountCents || intent.currency!==charge.currency || intent.customer!==charge.customerId || intent.receipt_email!==charge.receiptEmail || intent.metadata.bundleenRecurringChargeId!==charge.id || (intent.payment_method!==charge.paymentMethodId && !methods.includes(String(intent.payment_method)) && !(intent.payment_method===null && intent.status==="requires_payment_method"))) throw new HoaWorkflowError("Recurring processor identity mismatch.",409);
}
export async function lockRecurringCharge(tx: Prisma.TransactionClient,id:string) {
  // Every subsequent financial path takes constituent visits before charge.
  const lines=await tx.recurringChargeLine.findMany({where:{chargeId:id},orderBy:{visitId:"asc"}});
  for(const line of lines) await tx.$queryRaw`SELECT "id" FROM "ServiceVisit" WHERE "id"=${line.visitId} FOR UPDATE`;
  await tx.$queryRaw`SELECT "id" FROM "RecurringCharge" WHERE "id"=${id} FOR UPDATE`;
  return tx.recurringCharge.findUniqueOrThrow({where:{id}});
}
function remoteStatus(intent:Stripe.PaymentIntent) {
  return intent.status==="succeeded"?"succeeded":intent.status==="requires_action"?"requires_action":intent.status==="requires_payment_method"?"failed":intent.status==="canceled"?"canceled":"processing";
}
export async function recordRecurringIntent(tx:Prisma.TransactionClient,charge:RecurringCharge,intent:Stripe.PaymentIntent) {
  const recoveries=await tx.recurringChargeRecovery.findMany({where:{chargeId:charge.id}});
  recurringIntentMatches(intent,charge,recoveries.map(r=>r.paymentMethodId));
  return tx.recurringCharge.update({where:{id:charge.id},data:{status:charge.status==="disputed"||charge.reconciliationHoldReason==="processor_dispute"?"disputed":charge.refundedCents===charge.amountCents?"refunded":charge.refundedCents>0?"partially_refunded":remoteStatus(intent),stripeChargeId:typeof intent.latest_charge==="string"?intent.latest_charge:intent.latest_charge?.id??null,failureCode:intent.status==="requires_payment_method"?"payment_failed":null,...(intent.status==="succeeded"&&!charge.paidAt?{paidAt:new Date()}: {})}});
}
/** No caller may dispatch until the adapter feature gate and all SQL guards are installed. */
export async function chargeRecurringSource(source:{monthlyBillId:string}|{visitId:string}) {
  const stripe=recurringTestClient();
  let charge=await prepareRecurringCharge(source);
  if (charge.reconciliationHoldReason) throw new HoaWorkflowError("Recurring payment requires billing review.",409);
  if (!charge.stripePaymentIntentId) {
    charge=await db.$transaction(async tx=>{
      const c=await lockRecurringCharge(tx,charge.id);
      if(c.stripePaymentIntentId)return c;
      if(c.reconciliationHoldReason)throw new HoaWorkflowError("Recurring payment requires billing review.",409);
      if(c.createAttemptedAt && Date.now()-c.createAttemptedAt.getTime()>23*60*60*1000) throw new HoaWorkflowError("Recurring payment creation requires reconciliation.",409);
      return c.createAttemptedAt?c:tx.recurringCharge.update({where:{id:c.id},data:{createAttemptedAt:new Date()}});
    });
    if(!charge.stripePaymentIntentId){
      const intent=await stripe.paymentIntents.create({amount:charge.amountCents,currency:charge.currency,customer:charge.customerId,payment_method:charge.paymentMethodId,receipt_email:charge.receiptEmail,allowed_payment_method_types:["card"],transfer_group:`recurring_${charge.id}`,metadata:{bundleenRecurringChargeId:charge.id}},{idempotencyKey:`recurring_create_${charge.id}`});
      recurringIntentMatches(intent,charge);
      if(intent.status!=="requires_confirmation")throw new HoaWorkflowError("Unexpected unconfirmed recurring intent.",409);
      await db.recurringCharge.updateMany({where:{id:charge.id,stripePaymentIntentId:null},data:{stripePaymentIntentId:intent.id}});
    }
  }
  // The attempt timestamp must survive a network exception/transaction rollback.
  await db.$transaction(async tx=>{
    const c=await lockRecurringCharge(tx,charge.id);
    if(!c.stripePaymentIntentId)throw new HoaWorkflowError("Missing recurring processor identity.",409);
    const intent=await stripe.paymentIntents.retrieve(c.stripePaymentIntentId);
    const attempts=await tx.recurringChargeRecovery.findMany({where:{chargeId:c.id}});
    recurringIntentMatches(intent,c,attempts.map(a=>a.paymentMethodId));
    if(attempts.length || intent.status!=="requires_confirmation") {await recordRecurringIntent(tx,c,intent);return;}
    if(c.reconciliationHoldReason)throw new HoaWorkflowError("Recurring payment requires billing review.",409);
    if(!c.confirmAttemptedAt)await tx.recurringCharge.update({where:{id:c.id},data:{confirmAttemptedAt:new Date()}});
  });
  return db.$transaction(async tx=>{
    const c=await lockRecurringCharge(tx,charge.id);
    if(!c.stripePaymentIntentId)throw new HoaWorkflowError("Missing recurring processor identity.",409);
    let intent=await stripe.paymentIntents.retrieve(c.stripePaymentIntentId);
    const attempts=await tx.recurringChargeRecovery.findMany({where:{chargeId:c.id}});
    recurringIntentMatches(intent,c,attempts.map(a=>a.paymentMethodId));
    if(intent.status==="requires_confirmation" && !attempts.length) {
      if(c.reconciliationHoldReason || !c.confirmAttemptedAt || Date.now()-c.confirmAttemptedAt.getTime()>23*60*60*1000)throw new HoaWorkflowError("Recurring confirmation requires reconciliation.",409);
      try { intent=await stripe.paymentIntents.confirm(intent.id,{off_session:true},{idempotencyKey:`recurring_confirm_${c.id}`}); }
      catch(error) {if(!(error instanceof Stripe.errors.StripeCardError))throw error;intent=await stripe.paymentIntents.retrieve(intent.id);}
    }
    return recordRecurringIntent(tx,c,intent);
  },{timeout:20000});
}

export async function getRecurringReceipt(actor:string,id:string){
 const stripe=recurringTestClient();
 const user=await db.user.findUnique({where:{id:actor}});
 const c=await db.recurringCharge.findUnique({where:{id}});
 if(!user?.isVerified||!c||c.payerUserId!==actor||!c.stripeChargeId||!c.stripePaymentIntentId)throw new HoaWorkflowError("Receipt not found.",404);
 const charge=await stripe.charges.retrieve(c.stripeChargeId);
 if(charge.id!==c.stripeChargeId||charge.livemode!==false||!charge.paid||charge.payment_intent!==c.stripePaymentIntentId||charge.customer!==c.customerId||charge.amount!==c.amountCents||charge.currency!==c.currency||!charge.receipt_url)throw new HoaWorkflowError("Receipt requires billing review.",409);
 let url:URL;try{url=new URL(charge.receipt_url);}catch{throw new HoaWorkflowError("Receipt is unavailable.",409);}
 if(url.protocol!=="https:"||url.hostname!=="pay.stripe.com"||url.port||url.username||url.password||!url.pathname.startsWith("/receipts/"))throw new HoaWorkflowError("Receipt is unavailable.",409);
 const current=await db.user.findUnique({where:{id:actor}});
 if(!current?.isVerified)throw new HoaWorkflowError("Receipt not found.",404);
 return url.href;
}
