import "server-only";
import { createHash, randomUUID } from "node:crypto";
import Stripe from "stripe";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/server/db";
import { HoaWorkflowError } from "@/lib/server/hoa";
import { requireStripeRefundOwner } from "@/lib/server/stripe-test-refunds";
import { parseDateKey, zonedDateKey } from "@/lib/server/timezone";
import { recurringMonthBounds, recurringMonthSchedule, recurringNoticeDate } from "@/lib/server/recurring-calendar";
type Tx=Prisma.TransactionClient;
export const RECURRING_TERMS_VERSION="recurring-monthly-cap-v1";
const subscriptionView=(s:{id:string;unitId:string;status:string;startDate:string;stopKind:string|null;stopEffectiveDate:string|null;monthlyCapCents:number},own=true)=>({id:s.id,unitId:s.unitId,status:s.status,startDate:s.startDate,stopKind:s.stopKind,stopEffectiveDate:s.stopEffectiveDate,monthlyCapCents:s.monthlyCapCents,canStop:own&&s.status==="active"&&!s.stopKind,canAbandon:own&&s.status==="pending"});
const hash=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
function enabled(){if(process.env.RECURRING_PLANS!=="1")throw new HoaWorkflowError("Recurring plans are unavailable.",503);}
function client(){enabled();const key=process.env.STRIPE_SECRET_KEY;if(process.env.STRIPE_TEST_PAYMENTS!=="1"||!key||!/^(sk|rk)_test_[A-Za-z0-9]+$/.test(key))throw new HoaWorkflowError("Recurring sandbox cards are unavailable.",503);return new Stripe(key,{timeout:8000,maxNetworkRetries:0});}
async function manager(tx:Tx,actor:string,communityId:string){
 await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id"=${actor} FOR SHARE`;
 const user=await tx.user.findUnique({where:{id:actor}});
 if(user?.role==="admin")return requireStripeRefundOwner(tx,actor);
 await tx.$queryRaw`SELECT "id" FROM "CommunityStaffAssignment" WHERE "communityId"=${communityId} AND "userId"=${actor} FOR SHARE`;
 if(!user?.isVerified||!await tx.communityStaffAssignment.findFirst({where:{communityId,userId:actor,role:"hoa_manager",status:"active"}}))throw new HoaWorkflowError("An assigned HOA manager is required.",403);
}
async function lockPlan(tx:Tx,id:string){const initial=await tx.recurringPlan.findUnique({where:{id}});if(!initial)throw new HoaWorkflowError("Plan not found.",404);
 await tx.$queryRaw`SELECT "id" FROM "ServiceAgreement" WHERE "id"=${initial.agreementId} FOR UPDATE`;
 await tx.$queryRaw`SELECT "id" FROM "RecurringPlan" WHERE "id"=${id} FOR UPDATE`;
 return tx.recurringPlan.findUniqueOrThrow({where:{id}});
}
async function audit(tx:Tx,actor:string|null,communityId:string,planId:string,operation:string,extra:Record<string,string|number>={}){
 await tx.adminAuditLog.create({data:{actorUserId:actor,communityId,action:"marketplace_recovery_action",targetType:"community",targetId:planId,metadata:{operation,...extra}}});
}
export async function proposeRecurringPlan(actor:string,input:{id:string;agreementId:string;monthlyPriceCents:number;billingMode:"monthly"|"per_visit";anchorDate:string;cadenceDays:number}){
 enabled();if(!parseDateKey(input.anchorDate)||!Number.isInteger(input.monthlyPriceCents)||input.monthlyPriceCents<50||input.monthlyPriceCents>10000000||!Number.isInteger(input.cadenceDays)||input.cadenceDays<1||input.cadenceDays>31||!["monthly","per_visit"].includes(input.billingMode))throw new HoaWorkflowError("Review recurring price, cadence and start date.",400);
 return db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT "id" FROM "ServiceAgreement" WHERE "id"=${input.agreementId} FOR UPDATE`;
  const source=await tx.serviceAgreement.findUnique({where:{id:input.agreementId},include:{request:true,community:{include:{hoaProfile:true}}}});
  if(!source||source.community.type!=="hoa"||source.community.status!=="active"||source.request.kind!=="optional_group"||source.status==="cancelled")throw new HoaWorkflowError("An awarded optional HOA agreement is required.",409);
  await manager(tx,actor,source.communityId);
  const timezone=source.community.hoaProfile?.timezone;if(!timezone)throw new HoaWorkflowError("HOA timezone is required.",409);
  if(input.anchorDate<zonedDateKey(new Date(),timezone))throw new HoaWorkflowError("A recurring plan cannot start in the past.",409);
  const last=await tx.serviceOccurrence.findFirst({where:{agreementId:source.id,recurringPlanId:null},orderBy:{serviceDate:"desc"}});
  if(last&&input.anchorDate<=zonedDateKey(last.serviceDate,timezone))throw new HoaWorkflowError("Recurring coverage must begin after all finite service dates.",409);
  const terms={...input,requestId:source.requestId,communityId:source.communityId,providerUserId:source.providerUserId,scope:source.scope,timezone,currency:"usd",requiresAfterPhoto:source.request.requiresAfterPhoto,termsVersion:RECURRING_TERMS_VERSION};
  const old=await tx.recurringPlan.findUnique({where:{id:input.id}});const termsToken=hash(terms);if(old){if(old.termsToken!==termsToken)throw new HoaWorkflowError("Plan proposal identity changed.",409);return{id:old.id};}
  const plan=await tx.recurringPlan.create({data:{...terms,createdByUserId:actor,termsToken}});await audit(tx,actor,source.communityId,plan.id,"recurring_proposed");return{id:plan.id};
 });
}
export async function acceptRecurringPlan(providerId:string,planId:string,termsToken:string){enabled();return db.$transaction(async tx=>{
 const plan=await lockPlan(tx,planId);await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id"=${providerId} FOR SHARE`;
 await tx.$queryRaw`SELECT "userId" FROM "ProviderProfile" WHERE "userId"=${providerId} FOR SHARE`;
 const provider=await tx.user.findUnique({where:{id:providerId},include:{providerProfile:true}});
 if(plan.providerUserId!==providerId||provider?.role!=="provider"||provider.providerProfile?.accountStatus!=="active")throw new HoaWorkflowError("Only the active awarded provider can accept this plan.",403);
 if(plan.termsToken!==termsToken)throw new HoaWorkflowError("Review current recurring terms.",409);if(plan.status==="active")return{id:plan.id};if(plan.status!=="proposed")throw new HoaWorkflowError("This plan cannot be accepted.",409);
 const updated=await tx.recurringPlan.update({where:{id:planId},data:{status:"active",acceptedAt:new Date()}});
 await tx.serviceAgreement.update({where:{id:plan.agreementId},data:{status:"active"}});
 await tx.hoaServiceRequest.update({where:{id:plan.requestId},data:{status:"in_progress"}});
 await audit(tx,providerId,plan.communityId,planId,"recurring_provider_accepted");return{id:updated.id};
 });}
async function resident(tx:Tx,payerId:string,planId:string){const plan=await lockPlan(tx,planId);
 await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id"=${payerId} FOR SHARE`;
 await tx.$queryRaw`SELECT "id" FROM "Community" WHERE "id"=${plan.communityId} FOR SHARE`;
 await tx.$queryRaw`SELECT "id" FROM "CommunityMembership" WHERE "communityId"=${plan.communityId} AND "userId"=${payerId} FOR SHARE`;
 const payer=await tx.user.findUnique({where:{id:payerId}});const membership=await tx.communityMembership.findFirst({where:{communityId:plan.communityId,userId:payerId,status:"active"}});
 const community=await tx.community.findUnique({where:{id:plan.communityId}});
 if(!payer?.isVerified||payer.role!=="homeowner"||!membership?.unitId||community?.status!=="active")throw new HoaWorkflowError("An active resident and verified account are required.",403);
 if(plan.status!=="active"||!plan.acceptedAt)throw new HoaWorkflowError("This plan is not accepting enrollments.",409);
 return{plan,payer,membership};
}
const consentToken=(planToken:string,payer:string,membership:string,unit:string,start:string,cap:number)=>hash([RECURRING_TERMS_VERSION,planToken,payer,membership,unit,start,cap]);
export async function getRecurringOffer(payerId:string,planId:string){enabled();return db.$transaction(async tx=>{const {plan,payer,membership}=await resident(tx,payerId,planId);const startDate=[plan.anchorDate,zonedDateKey(new Date(),plan.timezone)].sort().at(-1)!;
 return{planId,scope:plan.scope,monthlyCapCents:plan.monthlyPriceCents,currency:plan.currency,billingMode:plan.billingMode,timezone:plan.timezone,cadenceDays:plan.cadenceDays,startDate,noticeDays:30,termsVersion:RECURRING_TERMS_VERSION,termsToken:consentToken(plan.termsToken,payer.id,membership.id,membership.unitId!,startDate,plan.monthlyPriceCents)};});}
export async function startRecurringSubscription(payerId:string,planId:string,input:{id:string;startDate:string;termsToken:string;accepted:boolean}){
 const stripe=client();if(input.accepted!==true)throw new HoaWorkflowError("Accept the recurring monthly maximum and notice terms.",400);
 const subscription=await db.$transaction(async tx=>{const {plan,payer,membership}=await resident(tx,payerId,planId);
  const existing=await tx.recurringSubscription.findUnique({where:{id:input.id}});
  if(!parseDateKey(input.startDate)||input.startDate<plan.anchorDate||(!existing&&input.startDate<zonedDateKey(new Date(),plan.timezone)))throw new HoaWorkflowError("Review the enrollment start date.",409);
  const token=consentToken(plan.termsToken,payerId,membership.id,membership.unitId!,input.startDate,plan.monthlyPriceCents);if(token!==input.termsToken)throw new HoaWorkflowError("Review current recurring terms.",409);
  if(existing){if(existing.planId!==planId||existing.payerUserId!==payerId||existing.termsToken!==token||existing.status!=="pending")throw new HoaWorkflowError("Enrollment identity changed.",409);return existing;}
  const email=payer.email.trim().toLowerCase();if(!z.string().email().max(254).safeParse(email).success)throw new HoaWorkflowError("A verified receipt email is required.",409);
  return tx.recurringSubscription.create({data:{id:input.id,planId,payerUserId:payerId,unitId:membership.unitId!,membershipId:membership.id,startDate:input.startDate,monthlyCapCents:plan.monthlyPriceCents,currency:plan.currency,termsVersion:RECURRING_TERMS_VERSION,termsToken:token,receiptEmail:email}});
 });
 let payer=await db.user.findUniqueOrThrow({where:{id:payerId}});
 if(!payer.stripeTestCustomerId){const customer=await stripe.customers.create({},{idempotencyKey:`bundleen-test-customer:${hash([payerId])}`});if(customer.livemode!==false)throw new HoaWorkflowError("Sandbox customer is required.",409);await db.user.updateMany({where:{id:payerId,stripeTestCustomerId:null},data:{stripeTestCustomerId:customer.id}});payer=await db.user.findUniqueOrThrow({where:{id:payerId}});}
 if(!payer.stripeTestCustomerId)throw new HoaWorkflowError("Sandbox customer is unavailable.",409);
 const setup=await stripe.setupIntents.create({customer:payer.stripeTestCustomerId,usage:"off_session",allowed_payment_method_types:["card"],metadata:{bundleenRecurringSubscriptionId:subscription.id,bundleenTermsToken:subscription.termsToken}},{idempotencyKey:`recurring_setup_${subscription.id}`});
 if(setup.livemode!==false||setup.customer!==payer.stripeTestCustomerId||!setup.client_secret)throw new HoaWorkflowError("Sandbox card setup identity changed.",409);
 await db.$transaction(async tx=>{const current=await resident(tx,payerId,planId);const sub=await tx.recurringSubscription.findUniqueOrThrow({where:{id:subscription.id}});if(sub.status!=="pending"||current.membership.id!==sub.membershipId||current.membership.unitId!==sub.unitId||current.payer.stripeTestCustomerId!==setup.customer)throw new HoaWorkflowError("Enrollment changed; restart card setup.",409);});
 return{clientSecret:setup.client_secret,subscriptionId:subscription.id};
}
export async function confirmRecurringSubscription(payerId:string,planId:string,subscriptionId:string,setupIntentId:string){const stripe=client();
 const prepared=await db.recurringSubscription.findUnique({where:{id:subscriptionId}});if(!prepared||prepared.payerUserId!==payerId||prepared.planId!==planId)throw new HoaWorkflowError("Enrollment not found.",404);
 const setup=await stripe.setupIntents.retrieve(setupIntentId,{expand:["payment_method"]});const card=setup.payment_method;
 if(setup.livemode!==false||setup.status!=="succeeded"||setup.usage!=="off_session"||setup.metadata?.bundleenRecurringSubscriptionId!==subscriptionId||setup.metadata?.bundleenTermsToken!==prepared.termsToken||!card||typeof card==="string"||card.type!=="card"||card.livemode!==false||!card.card||setup.customer!==card.customer)throw new HoaWorkflowError("A verified recurring sandbox card is required.",409);
 return db.$transaction(async tx=>{const s=await resident(tx,payerId,planId);await tx.$queryRaw`SELECT "id" FROM "RecurringSubscription" WHERE "id"=${subscriptionId} FOR UPDATE`;const sub=await tx.recurringSubscription.findUniqueOrThrow({where:{id:subscriptionId}});
  if(sub.membershipId!==s.membership.id||sub.unitId!==s.membership.unitId||s.payer.stripeTestCustomerId!==setup.customer||sub.termsToken!==consentToken(s.plan.termsToken,payerId,sub.membershipId,sub.unitId,sub.startDate,sub.monthlyCapCents))throw new HoaWorkflowError("Recurring card ownership or terms changed.",409);
  if(sub.status==="active"&&sub.setupIntentId===setupIntentId)return subscriptionView(sub);if(sub.status!=="pending")throw new HoaWorkflowError("This enrollment cannot be activated.",409);
  const result=await tx.recurringSubscription.update({where:{id:subscriptionId},data:{status:"active",customerId:setup.customer as string,paymentMethodId:card.id,setupIntentId,cardVerifiedAt:new Date()}});await audit(tx,payerId,s.plan.communityId,planId,"recurring_enrolled",{subscriptionId});return subscriptionView(result);
 });
}
export async function requestRecurringStop(payerId:string,subscriptionId:string,kind:"pause"|"cancel"){
 enabled();if(!["pause","cancel"].includes(kind))throw new HoaWorkflowError("Invalid subscription action.",400);
 return db.$transaction(async tx=>{const found=await tx.recurringSubscription.findUnique({where:{id:subscriptionId}});if(!found||found.payerUserId!==payerId)throw new HoaWorkflowError("Subscription not found.",404);const plan=await lockPlan(tx,found.planId);await tx.$queryRaw`SELECT "id" FROM "RecurringSubscription" WHERE "id"=${subscriptionId} FOR UPDATE`;const sub=await tx.recurringSubscription.findUniqueOrThrow({where:{id:subscriptionId}});
  // The original payer retains cancellation rights after moving out; never substitute the new occupant.
  if(sub.stopKind){if(sub.stopKind!==kind)throw new HoaWorkflowError("A notice is already recorded.",409);return subscriptionView(sub);}
  if(sub.status!=="active")throw new HoaWorkflowError("Only an active subscription can give notice.",409);
  const stopEffectiveDate=recurringNoticeDate(plan.timezone);const updated=await tx.recurringSubscription.update({where:{id:subscriptionId},data:{stopKind:kind,stopRequestedAt:new Date(),stopEffectiveDate}});
  await cancelFuture(tx,sub.id,stopEffectiveDate);await audit(tx,payerId,plan.communityId,plan.id,`recurring_${kind}_notice`,{subscriptionId,effectiveDate:stopEffectiveDate});return subscriptionView(updated);
 });
}
async function cancelFuture(tx:Tx,subscriptionId:string,date:string){const visits=await tx.serviceVisit.findMany({where:{recurringSubscriptionId:subscriptionId,occurrence:{recurringLocalDate:{gte:date}},status:{notIn:["completed","cancelled","skipped","blocked"]}},select:{id:true}});if(visits.length)await tx.serviceVisit.updateMany({where:{id:{in:visits.map(v=>v.id)}},data:{status:"cancelled",statusChangedAt:new Date()}});}
export async function endRecurringPlan(providerId:string,planId:string){enabled();return db.$transaction(async tx=>{const plan=await lockPlan(tx,planId);if(plan.providerUserId!==providerId)throw new HoaWorkflowError("Only the awarded provider can end this plan.",403);if(plan.endEffectiveDate)return{id:plan.id};if(plan.status!=="active")throw new HoaWorkflowError("This plan is not active.",409);
 const endEffectiveDate=recurringNoticeDate(plan.timezone);const updated=await tx.recurringPlan.update({where:{id:planId},data:{status:"ending",endRequestedAt:new Date(),endEffectiveDate}});for(const sub of await tx.recurringSubscription.findMany({where:{planId,status:"active"}}))await cancelFuture(tx,sub.id,endEffectiveDate);await audit(tx,providerId,plan.communityId,planId,"recurring_provider_end_notice",{effectiveDate:endEffectiveDate});return{id:updated.id};});}
export async function generateRecurringMonth(planId:string,month:string){enabled();return db.$transaction(async tx=>{const plan=await lockPlan(tx,planId);if(!["active","ending"].includes(plan.status)||!plan.acceptedAt)return{created:0};const bounds=recurringMonthBounds(month,plan.timezone);const today=zonedDateKey(new Date(),plan.timezone);if(bounds.next<=today)throw new HoaWorkflowError("Cannot generate a past service month.",409);
 const subscriptions=await tx.recurringSubscription.findMany({where:{planId,status:"active"}});const last=await tx.serviceOccurrence.findFirst({where:{agreementId:plan.agreementId},orderBy:{sequence:"desc"}});let sequence=last?.sequence??0,created=0;
 for(const date of recurringMonthSchedule(plan,month)){
  if(date.localDate<plan.anchorDate||date.localDate<today||(plan.endEffectiveDate&&date.localDate>=plan.endEffectiveDate))continue;
  const eligible=subscriptions.filter(sub=>sub.startDate<=date.localDate&&(!sub.stopEffectiveDate||date.localDate<sub.stopEffectiveDate));if(!eligible.length)continue;
  let occurrence=await tx.serviceOccurrence.findUnique({where:{recurringPlanId_recurringLocalDate:{recurringPlanId:planId,recurringLocalDate:date.localDate}}});
  if(occurrence&&["completed","cancelled"].includes(occurrence.status))continue;
  if(!occurrence)occurrence=await tx.serviceOccurrence.create({data:{agreementId:plan.agreementId,sequence:++sequence,serviceDate:date.serviceDate,recurringPlanId:planId,recurringLocalDate:date.localDate}});
  for(const sub of eligible){const old=await tx.serviceVisit.findFirst({where:{occurrenceId:occurrence.id,unitId:sub.unitId,recurringSubscriptionId:sub.id}});if(old){if(old.recurringSubscriptionId!==sub.id)throw new HoaWorkflowError("This unit already has another enrollment for that service day.",409);continue;}
   await tx.serviceVisit.create({data:{occurrenceId:occurrence.id,unitId:sub.unitId,billingPayerUserId:sub.payerUserId,allocatedVisitCents:date.allocatedCents,requiresAfterPhoto:plan.requiresAfterPhoto,recurringSubscriptionId:sub.id,recurringMonth:month}});created++;
  }
 }
 await tx.recurringPlan.update({where:{id:planId},data:{lastGeneratedMonth:month}});return{created};},{timeout:30000});}
export async function sealRecurringMonth(planId:string,subscriptionId:string,month:string){enabled();return db.$transaction(async tx=>{const plan=await lockPlan(tx,planId);if(plan.billingMode!=="monthly")throw new HoaWorkflowError("This plan uses per-visit billing.",409);const bounds=recurringMonthBounds(month,plan.timezone);if(bounds.endInstant>new Date())throw new HoaWorkflowError("The HOA local service month has not ended.",409);const sub=await tx.recurringSubscription.findUnique({where:{id:subscriptionId}});if(!sub||sub.planId!==planId)throw new HoaWorkflowError("Subscription not found.",404);
 const id=`recurring_${hash([planId,subscriptionId,sub.unitId,month])}`;const old=await tx.recurringMonthlyBill.findUnique({where:{id}});if(old)return old;
 const visits=await tx.serviceVisit.findMany({where:{recurringSubscriptionId:subscriptionId,recurringMonth:month,redoOfVisitId:null},orderBy:{id:"asc"}});
 if(visits.some(v=>!["completed","skipped","cancelled","blocked"].includes(v.status)))throw new HoaWorkflowError("Resolve every service visit before monthly billing.",409);
 const amountCents=visits.reduce((sum,v)=>sum+(v.status==="completed"?v.allocatedVisitCents??0:0),0);if(amountCents>sub.monthlyCapCents)throw new HoaWorkflowError("Monthly charges exceed accepted maximum.",409);
 const bill=await tx.recurringMonthlyBill.create({data:{id,planId,subscriptionId,unitId:sub.unitId,payerUserId:sub.payerUserId,month,timezone:plan.timezone,currency:plan.currency,amountCents}});
 for(const visit of visits)await tx.recurringBillLine.create({data:{id:`${id}:${visit.id}`,billId:id,visitId:visit.id,allocatedCents:visit.allocatedVisitCents??0,amountCents:visit.status==="completed"?visit.allocatedVisitCents??0:0,statusAtSeal:visit.status,completedAt:visit.completedAt}});
 return bill;});}
export async function abandonRecurringEnrollment(payerId:string,subscriptionId:string){enabled();return db.$transaction(async tx=>{const sub=await tx.recurringSubscription.findUnique({where:{id:subscriptionId}});if(!sub||sub.payerUserId!==payerId)throw new HoaWorkflowError("Enrollment not found.",404);await lockPlan(tx,sub.planId);if(sub.status==="cancelled")return subscriptionView(sub);if(sub.status!=="pending")throw new HoaWorkflowError("Active service requires notice.",409);return subscriptionView(await tx.recurringSubscription.update({where:{id:subscriptionId},data:{status:"cancelled",stoppedAt:new Date()}}));});}
export async function getRecurringPlanView(actor:string,planId:string){enabled();return db.$transaction(async tx=>{const plan=await lockPlan(tx,planId);const user=await tx.user.findUnique({where:{id:actor}});if(!user?.isVerified)throw new HoaWorkflowError("Verified account required.",403);
 let isManager=false;if(user.role==="admin"||await tx.communityStaffAssignment.findFirst({where:{communityId:plan.communityId,userId:actor,role:"hoa_manager",status:"active"}})){await manager(tx,actor,plan.communityId);isManager=true;}
 const own=await tx.recurringSubscription.findMany({where:{planId,payerUserId:actor},orderBy:{createdAt:"desc"}});
 const provider=user.role==="provider"&&plan.providerUserId===actor;
 if(!isManager&&!provider&&!own.length&&!await tx.communityMembership.findFirst({where:{communityId:plan.communityId,userId:actor,status:"active"}}))throw new HoaWorkflowError("Plan not found.",404);
 const membership=await tx.communityMembership.findFirst({where:{communityId:plan.communityId,userId:actor,status:"active"}});
 const subscriptions=isManager?await tx.recurringSubscription.findMany({where:{planId},orderBy:{createdAt:"desc"}}):own;
 return{id:plan.id,agreementId:plan.agreementId,communityId:plan.communityId,scope:plan.scope,monthlyPriceCents:plan.monthlyPriceCents,currency:plan.currency,billingMode:plan.billingMode,timezone:plan.timezone,cadenceDays:plan.cadenceDays,anchorDate:plan.anchorDate,status:plan.status,endEffectiveDate:plan.endEffectiveDate,noticeDays:30,termsToken:provider&&plan.status==="proposed"?plan.termsToken:null,activeSubscribers:await tx.recurringSubscription.count({where:{planId,status:"active"}}),subscriptions:subscriptions.map(s=>subscriptionView(s,s.payerUserId===actor)),canEnroll:user.role==="homeowner"&&Boolean(membership?.unitId)&&plan.status==="active"&&!await tx.recurringSubscription.findFirst({where:{planId,unitId:membership?.unitId??"",status:{in:["pending","active"]}}}),canManage:isManager,canProviderAccept:provider&&plan.status==="proposed",canProviderEnd:provider&&plan.status==="active"};});}
export async function runRecurringPlanLifecycle(){if(process.env.RECURRING_PLANS!=="1")return{processed:0,generated:0,failed:0};const plans=await db.recurringPlan.findMany({where:{status:{in:["active","ending"]}},orderBy:{updatedAt:"asc"},take:25});let processed=0,generated=0,failed=0;
 for(const row of plans){try{
  const plan=await db.$transaction(async tx=>{const p=await lockPlan(tx,row.id);const today=zonedDateKey(new Date(),p.timezone);for(const sub of await tx.recurringSubscription.findMany({where:{planId:p.id,status:"active",stopEffectiveDate:{lte:today}}}))await tx.recurringSubscription.update({where:{id:sub.id},data:{status:sub.stopKind==="pause"?"paused":"cancelled",stoppedAt:new Date()}});
   if(p.status==="ending"&&p.endEffectiveDate&&p.endEffectiveDate<=today){const ended=await tx.recurringPlan.update({where:{id:p.id},data:{status:"ended",endedAt:new Date()}});await tx.recurringSubscription.updateMany({where:{planId:p.id,status:"active"},data:{status:"cancelled",stoppedAt:new Date()}});return ended;}return p;});
  if(["active","ending"].includes(plan.status)){const month=zonedDateKey(new Date(),plan.timezone).slice(0,7);const next=recurringMonthBounds(month,plan.timezone).next.slice(0,7);generated+=(await generateRecurringMonth(plan.id,month)).created;generated+=(await generateRecurringMonth(plan.id,next)).created;
   const year=Number(month.slice(0,4));const today=zonedDateKey(new Date(),plan.timezone);if(year>Number(plan.anchorDate.slice(0,4))&&today.slice(5)>=plan.anchorDate.slice(5)&&(plan.lastReminderYear??0)<year){const {enqueueNotifications}=await import("@/lib/server/notifications");const managers=await db.communityStaffAssignment.findMany({where:{communityId:plan.communityId,role:"hoa_manager",status:"active"},include:{user:true}});
    await enqueueNotifications(managers.map(m=>({userId:m.userId,email:m.user.email,kind:"reminder" as const,title:"Review your recurring service price",body:"This recurring service has reached its annual review. Compare providers and create a new community request to re-bid; existing service remains under its current notice terms.",linkPath:"/app/hoa/dashboard",dedupeKey:`recurring-rebid:${plan.id}:${year}:${m.userId}`})));
    await db.recurringPlan.update({where:{id:plan.id},data:{lastReminderYear:year}});
   }
  }processed++;
 }catch{failed++;}finally{await db.recurringPlan.update({where:{id:row.id},data:{updatedAt:new Date()}});}}
 return{processed,generated,failed};}

export async function listRecurringPlans(actor:string,communityId?:string){enabled();const user=await db.user.findUnique({where:{id:actor}});if(!user?.isVerified)throw new HoaWorkflowError("Verified account required.",403);
 let where:Prisma.RecurringPlanWhereInput={...(communityId?{communityId}:{})};
 if(user.role==="admin")await db.$transaction(tx=>requireStripeRefundOwner(tx,actor));
 else{const [staff,memberships,subscriptions]=await Promise.all([db.communityStaffAssignment.findMany({where:{userId:actor,role:"hoa_manager",status:"active"},select:{communityId:true}}),db.communityMembership.findMany({where:{userId:actor,status:"active"},select:{communityId:true}}),db.recurringSubscription.findMany({where:{payerUserId:actor},select:{planId:true}})]);
  where={...where,OR:[{communityId:{in:[...staff,...memberships].map(x=>x.communityId)}},{id:{in:subscriptions.map(x=>x.planId)}},...(user.role==="provider"?[{providerUserId:actor}]:[])]};
 }
 const rows=await db.recurringPlan.findMany({where,orderBy:{createdAt:"desc"},take:100,select:{id:true}});const result=[];
 for(const row of rows){try{result.push(await getRecurringPlanView(actor,row.id));}catch(error){if(!(error instanceof HoaWorkflowError&&[403,404].includes(error.status)))throw error;}}
 return result;
}
