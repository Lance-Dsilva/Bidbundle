import "server-only";
import { createHash } from "node:crypto";
import Stripe from "stripe";
import { db } from "@/lib/server/db";
import { HoaWorkflowError } from "@/lib/server/hoa";
import { lockRecurringCharge, recurringTestClient, recurringIntentMatches, recordRecurringIntent } from "@/lib/server/recurring-payments";
import type { Prisma, RecurringCharge } from "@/generated/prisma/client";
const terms=(c:RecurringCharge)=>createHash("sha256").update(JSON.stringify(["recurring-recovery-exact-v1",c.id,c.payerUserId,c.customerId,c.amountCents,c.currency])).digest("hex");
async function owner(actor:string,id:string){
 const c=await db.recurringCharge.findUnique({where:{id}});const u=await db.user.findUnique({where:{id:actor}});
 if(!u?.isVerified||!c||c.payerUserId!==actor)throw new HoaWorkflowError("Payment not found.",404);
 if(!c.stripePaymentIntentId)throw new HoaWorkflowError("Payment identity is not ready.",409);
 return c;
}
async function lockedOwner(tx:Prisma.TransactionClient,actor:string,id:string){
 const c=await lockRecurringCharge(tx,id);
 await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id"=${actor} FOR SHARE`;
 const u=await tx.user.findUnique({where:{id:actor}});
 if(!u?.isVerified||c.payerUserId!==actor)throw new HoaWorkflowError("Payment not found.",404);
 if(!c.stripePaymentIntentId)throw new HoaWorkflowError("Payment identity is not ready.",409);
 return c;
}
const blocked=(c:RecurringCharge)=>!!c.paidAt||c.status==="succeeded"||!!c.reconciliationHoldReason||c.refundedCents>0||["disputed","refunded","partially_refunded","canceled"].includes(c.status);
export async function getRecurringRecovery(actor:string,id:string){
 const stripe=recurringTestClient();await owner(actor,id);
 return db.$transaction(async tx=>{
  const c=await lockedOwner(tx,actor,id);
  const attempts=await tx.recurringChargeRecovery.findMany({where:{chargeId:id}});
  const intent=await stripe.paymentIntents.retrieve(c.stripePaymentIntentId!);
  recurringIntentMatches(intent,c,attempts.map(a=>a.paymentMethodId));
  const current=await lockedOwner(tx,actor,id);
  await recordRecurringIntent(tx,current,intent);
  return {id,amountCents:c.amountCents,currency:c.currency,termsToken:terms(c),status:current.reconciliationHoldReason?"billing_review":blocked(current)?current.status:intent.status,clientSecret:intent.status==="requires_action"&&!blocked(current)?intent.client_secret:null};
 },{timeout:20000});
}
export async function startRecurringRecoveryCard(actor:string,id:string){
 const stripe=recurringTestClient();await owner(actor,id);
 const reservation=await db.$transaction(async tx=>{
  const c=await lockedOwner(tx,actor,id);
  if(blocked(c))throw new HoaWorkflowError("Payment requires reconciliation.",409);
  const attempts=await tx.recurringChargeRecovery.findMany({where:{chargeId:id},orderBy:{sequence:"desc"}});
  const intent=await stripe.paymentIntents.retrieve(c.stripePaymentIntentId!);
  recurringIntentMatches(intent,c,attempts.map(a=>a.paymentMethodId));
  if(!["requires_payment_method","requires_confirmation"].includes(intent.status))throw new HoaWorkflowError("This payment does not need a replacement card.",409);
  const sequence=(attempts[0]?.sequence??0)+1;
  const prior=await tx.recurringRecoverySetup.findUnique({where:{chargeId_sequence:{chargeId:id,sequence}}});
  return {charge:c,setup:prior??await tx.recurringRecoverySetup.create({data:{chargeId:id,sequence,payerUserId:actor,customerId:c.customerId,termsToken:terms(c)}})};
 },{timeout:20000});
 const {charge:c,setup:reserved}=reservation;
 let setup:Stripe.SetupIntent|null=reserved.setupIntentId?await stripe.setupIntents.retrieve(reserved.setupIntentId):null;
 if(!setup){
  const previous=await stripe.setupIntents.list({customer:c.customerId,limit:100});
  const matches=previous.data.filter(s=>s.metadata?.bundleenRecurringSetupId===reserved.id);
  if(previous.has_more||matches.length>1)throw new HoaWorkflowError("Recovery setup requires reconciliation.",409);
  setup=matches[0]??null;
 }
 if(!setup){
  if(Date.now()-reserved.attemptedAt.getTime()>23*60*60*1000)throw new HoaWorkflowError("Recovery setup attempt requires reconciliation.",409);
  setup=await stripe.setupIntents.create({customer:c.customerId,usage:"off_session",allowed_payment_method_types:["card"],metadata:{bundleenRecurringSetupId:reserved.id,bundleenRecurringChargeId:id,bundleenRecoveryTerms:terms(c),bundleenRecoverySequence:String(reserved.sequence)}},{idempotencyKey:`recurring_recovery_setup_${reserved.id}`});
 }
 if(setup.livemode!==false||setup.usage!=="off_session"||setup.metadata?.bundleenRecoverySequence!==String(reserved.sequence)||setup.customer!==c.customerId||setup.metadata?.bundleenRecurringSetupId!==reserved.id||setup.metadata?.bundleenRecurringChargeId!==id||setup.metadata?.bundleenRecoveryTerms!==terms(c)||!setup.client_secret)throw new HoaWorkflowError("Recovery setup identity changed.",409);
 return db.$transaction(async tx=>{
  const current=await lockedOwner(tx,actor,id);
  if(blocked(current))throw new HoaWorkflowError("Payment requires reconciliation.",409);
  const attempts=await tx.recurringChargeRecovery.findMany({where:{chargeId:id}});
  const intent=await stripe.paymentIntents.retrieve(current.stripePaymentIntentId!);
  recurringIntentMatches(intent,current,attempts.map(a=>a.paymentMethodId));
  if(!["requires_payment_method","requires_confirmation"].includes(intent.status))throw new HoaWorkflowError("Payment no longer needs a replacement card.",409);
  const latest=await tx.recurringChargeRecovery.findFirst({where:{chargeId:id},orderBy:{sequence:"desc"}});
  if((latest?.sequence??0)+1!==reserved.sequence)throw new HoaWorkflowError("Recovery setup is stale.",409);
  await tx.recurringRecoverySetup.update({where:{id:reserved.id},data:{setupIntentId:setup!.id}});
  return {clientSecret:setup!.client_secret,termsToken:terms(current),amountCents:current.amountCents,currency:current.currency};
 });
}
export async function retryRecurringPayment(actor:string,id:string,input:{setupIntentId:string;accepted:boolean;termsToken:string}){
 const stripe=recurringTestClient();const c=await owner(actor,id);
 if(input.accepted!==true||input.termsToken!==terms(c))throw new HoaWorkflowError("Accept the exact original payment amount.",400);
 const setup=await stripe.setupIntents.retrieve(input.setupIntentId,{expand:["payment_method"]});const method=setup.payment_method;
 if(setup.livemode!==false||setup.status!=="succeeded"||setup.usage!=="off_session"||setup.customer!==c.customerId||setup.metadata?.bundleenRecurringChargeId!==id||setup.metadata?.bundleenRecoveryTerms!==terms(c)||!method||typeof method==="string"||method.livemode!==false||method.type!=="card"||method.customer!==c.customerId)throw new HoaWorkflowError("Verified recovery card identity mismatch.",409);
 await db.$transaction(async tx=>{
  const current=await lockedOwner(tx,actor,id);
  if(blocked(current))throw new HoaWorkflowError("Payment requires reconciliation.",409);
  const attempts=await tx.recurringChargeRecovery.findMany({where:{chargeId:id},orderBy:{sequence:"desc"}});
  const intent=await stripe.paymentIntents.retrieve(current.stripePaymentIntentId!);
  recurringIntentMatches(intent,current,attempts.map(a=>a.paymentMethodId));
  if(!["requires_payment_method","requires_confirmation"].includes(intent.status)){await recordRecurringIntent(tx,current,intent);return;}
  const existing=await tx.recurringChargeRecovery.findUnique({where:{setupIntentId:setup.id}});
  if(existing){if(existing.chargeId!==id||existing.payerUserId!==actor||existing.paymentMethodId!==method.id)throw new HoaWorkflowError("Recovery identity changed.",409);return;}
  const sequence=(attempts[0]?.sequence??0)+1;
  const setupReservation=await tx.recurringRecoverySetup.findUnique({where:{setupIntentId:setup.id}});
  if(!setupReservation||setupReservation.chargeId!==id||setupReservation.sequence!==sequence||setup.metadata?.bundleenRecurringSetupId!==setupReservation.id)throw new HoaWorkflowError("Recovery setup reservation mismatch.",409);
  if(setup.metadata?.bundleenRecoverySequence!==String(sequence))throw new HoaWorkflowError("Recovery attempt is stale.",409);
  await tx.recurringChargeRecovery.create({data:{chargeId:id,sequence,payerUserId:actor,paymentMethodId:method.id,setupIntentId:setup.id,termsToken:terms(current)}});
 });
 await db.$transaction(async tx=>{
  const current=await lockedOwner(tx,actor,id);const attempts=await tx.recurringChargeRecovery.findMany({where:{chargeId:id},orderBy:{sequence:"desc"}});
  let intent=await stripe.paymentIntents.retrieve(current.stripePaymentIntentId!);
  recurringIntentMatches(intent,current,attempts.map(a=>a.paymentMethodId));
  const attempt=attempts[0];
  if(!attempt||attempt.setupIntentId!==setup.id||!["requires_payment_method","requires_confirmation"].includes(intent.status))return recordRecurringIntent(tx,current,intent);
  if(blocked(current)||Date.now()-attempt.acceptedAt.getTime()>23*60*60*1000)throw new HoaWorkflowError("Recovery attempt requires reconciliation.",409);
  // Same PaymentIntent, versioned confirmation key; never a replacement charge.
  try{intent=await stripe.paymentIntents.confirm(intent.id,{payment_method:attempt.paymentMethodId,off_session:true},{idempotencyKey:`recurring_recovery_confirm_${attempt.id}`});}
  catch(error){if(!(error instanceof Stripe.errors.StripeCardError))throw error;intent=await stripe.paymentIntents.retrieve(intent.id);}
  return recordRecurringIntent(tx,current,intent);
 },{timeout:20000});
 return getRecurringRecovery(actor,id);
}
