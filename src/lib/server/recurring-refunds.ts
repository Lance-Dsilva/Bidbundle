import "server-only";
import type Stripe from "stripe";
import type { Prisma, RecurringChargeRefund } from "@/generated/prisma/client";
import { db } from "@/lib/server/db";
import { HoaWorkflowError } from "@/lib/server/hoa";
import { requireStripeRefundOwner } from "@/lib/server/stripe-test-refunds";
import { lockRecurringCharge, recurringTestClient } from "@/lib/server/recurring-payments";
import { recurringRefundDelta } from "@/lib/recurring-financial-amounts";
export type RecurringRefundInput={id:string;amountCents:number;reason:"service_quality"|"duplicate"|"requested_by_customer"};
/** Caller may bind a quality decision in this same transaction. */
export async function reserveRecurringRefund(tx:Prisma.TransactionClient,actor:string,visitId:string,input:RecurringRefundInput) {
  recurringTestClient();
  if(!Number.isSafeInteger(input.amountCents)||input.amountCents<1)throw new HoaWorkflowError("Enter a positive refund amount.",400);
  const initial=await tx.recurringChargeLine.findUnique({where:{visitId}});
  if(!initial)throw new HoaWorkflowError("Recurring payment not found.",404);
  const charge=await lockRecurringCharge(tx,initial.chargeId);
  await requireStripeRefundOwner(tx,actor);
  const existing=await tx.recurringChargeRefund.findUnique({where:{id:input.id}});
  if(existing){if(existing.lineId!==initial.id||existing.actorUserId!==actor||existing.amountCents!==input.amountCents||existing.reason!==input.reason)throw new HoaWorkflowError("Refund identity changed.",409);return existing;}
  if(!["succeeded","partially_refunded"].includes(charge.status)||!charge.stripeChargeId||!charge.stripePaymentIntentId||charge.reconciliationHoldReason)throw new HoaWorkflowError("A reconciled paid charge is required.",409);
  if(charge.transferAttemptedAt&&!charge.stripeTransferId)throw new HoaWorkflowError("Reconcile the pending provider transfer first.",409);
  if(await tx.recurringChargeRefund.findFirst({where:{chargeId:charge.id,status:{not:"succeeded"}}}))throw new HoaWorkflowError("Finish the existing refund first.",409);
  const line=await tx.recurringChargeLine.findUniqueOrThrow({where:{id:initial.id}});
  if(input.amountCents>line.grossCents-line.refundedCents)throw new HoaWorkflowError("Refund exceeds this service's remaining paid amount.",409);
  const delta=recurringRefundDelta(line,line.refundedCents,line.refundedCents+input.amountCents);
  const op=await tx.recurringChargeRefund.create({data:{id:input.id,chargeId:charge.id,lineId:line.id,actorUserId:actor,reason:input.reason,amountCents:input.amountCents,previousLineRefundCents:line.refundedCents,providerDebitCents:delta.providerCents,hoaDebitCents:delta.hoaCents,providerReversalCents:charge.stripeTransferId?delta.providerCents:0}});
  await tx.adminAuditLog.create({data:{actorUserId:actor,communityId:charge.communityId,action:"marketplace_recovery_action",targetType:"service_visit",targetId:visitId,metadata:{operation:"recurring_refund_reserved",refundId:op.id,chargeId:charge.id,amountCents:op.amountCents}}});
  return op;
}
export async function requestRecurringRefund(actor:string,visitId:string,input:RecurringRefundInput){return db.$transaction(tx=>reserveRecurringRefund(tx,actor,visitId,input));}

const objectId=(value:string|{id:string}|null)=>typeof value==="string"?value:value?.id??null;
const WINDOW=23*60*60*1000;
export async function processRecurringRefund(id:string){
 const stripe=recurringTestClient();
 let op=await db.recurringChargeRefund.findUniqueOrThrow({where:{id}});
 let charge=await db.recurringCharge.findUniqueOrThrow({where:{id:op.chargeId}});
 if(op.status==="succeeded")return;
 if(!charge.stripeChargeId||!charge.stripePaymentIntentId)throw new HoaWorkflowError("Missing original recurring payment identity.",409);
 const remoteCharge=await stripe.charges.retrieve(charge.stripeChargeId);
 if(remoteCharge.livemode!==false||remoteCharge.amount!==charge.amountCents||remoteCharge.currency!==charge.currency||objectId(remoteCharge.payment_intent)!==charge.stripePaymentIntentId)throw new HoaWorkflowError("Original recurring charge mismatch.",409);
 let refund:Stripe.Refund|null=op.stripeRefundId?await stripe.refunds.retrieve(op.stripeRefundId):null;
 if(!refund&&op.refundAttemptedAt){const prior=await stripe.refunds.list({charge:charge.stripeChargeId,limit:100});const matches=prior.data.filter(r=>r.metadata?.bundleenRecurringRefundId===id);if(prior.has_more||matches.length>1)throw new HoaWorkflowError("Recurring refund requires reconciliation.",409);refund=matches[0]??null;}
 if(!refund){
  op=await db.$transaction(async tx=>{const c=await lockRecurringCharge(tx,op.chargeId);const current=await tx.recurringChargeRefund.findUniqueOrThrow({where:{id}});if(current.stripeRefundId)return current;if(c.reconciliationHoldReason)throw new HoaWorkflowError("Recurring refund requires reconciliation.",409);if(current.refundAttemptedAt&&Date.now()-current.refundAttemptedAt.getTime()>WINDOW)throw new HoaWorkflowError("Recurring refund attempt requires reconciliation.",409);return current.refundAttemptedAt?current:tx.recurringChargeRefund.update({where:{id},data:{refundAttemptedAt:new Date()}});});
  if(op.stripeRefundId)refund=await stripe.refunds.retrieve(op.stripeRefundId);
  else refund=await db.$transaction(async tx=>{const c=await lockRecurringCharge(tx,op.chargeId);const current=await tx.recurringChargeRefund.findUniqueOrThrow({where:{id}});if(current.stripeRefundId)return stripe.refunds.retrieve(current.stripeRefundId);if(c.reconciliationHoldReason||!current.refundAttemptedAt||Date.now()-current.refundAttemptedAt.getTime()>WINDOW)throw new HoaWorkflowError("Recurring refund requires reconciliation.",409);await requireStripeRefundOwner(tx,current.actorUserId);
 const fresh=await stripe.charges.retrieve(c.stripeChargeId!);
 if(fresh.livemode!==false||!fresh.paid||fresh.amount!==c.amountCents||fresh.currency!==c.currency||objectId(fresh.customer)!==c.customerId||objectId(fresh.payment_intent)!==c.stripePaymentIntentId||fresh.amount_refunded!==c.refundedCents||fresh.disputed)throw new HoaWorkflowError("Recurring refund needs financial reconciliation.",409);
 return stripe.refunds.create({charge:c.stripeChargeId!,amount:current.amountCents,metadata:{bundleenRecurringRefundId:id}},{idempotencyKey:`recurring_refund_${id}`});},{timeout:20000});
 }
 if(refund.amount!==op.amountCents||refund.currency!==charge.currency||objectId(refund.charge)!==charge.stripeChargeId||objectId(refund.payment_intent)!==charge.stripePaymentIntentId||refund.metadata?.bundleenRecurringRefundId!==id)throw new HoaWorkflowError("Recurring refund identity mismatch.",409);
 await recordRecurringRefundSnapshot(op,refund);
 op=await db.recurringChargeRefund.findUniqueOrThrow({where:{id}});
 if(op.status!=="reversal_pending")return;
 charge=await db.recurringCharge.findUniqueOrThrow({where:{id:op.chargeId}});
 if(!charge.stripeTransferId||charge.transferAmountCents===null)throw new HoaWorkflowError("Missing recurring transfer identity.",409);
 const transfer=await stripe.transfers.retrieve(charge.stripeTransferId);
 if(transfer.livemode!==false||transfer.amount!==charge.transferAmountCents||transfer.currency!==charge.currency||objectId(transfer.destination)!==charge.providerAccountId||objectId(transfer.source_transaction)!==charge.stripeChargeId||transfer.metadata.bundleenRecurringChargeId!==charge.id)throw new HoaWorkflowError("Recurring transfer identity mismatch.",409);
 let reversal:Stripe.TransferReversal|null=op.stripeReversalId?await stripe.transfers.retrieveReversal(transfer.id,op.stripeReversalId):null;
 if(!reversal&&op.reversalAttemptedAt){const prior=await stripe.transfers.listReversals(transfer.id,{limit:100});const matches=prior.data.filter(r=>r.metadata?.bundleenRecurringRefundId===id);if(prior.has_more||matches.length>1)throw new HoaWorkflowError("Recurring reversal requires reconciliation.",409);reversal=matches[0]??null;}
 if(!reversal){
  op=await db.$transaction(async tx=>{await lockRecurringCharge(tx,op.chargeId);const current=await tx.recurringChargeRefund.findUniqueOrThrow({where:{id}});if(current.reversalAttemptedAt&&Date.now()-current.reversalAttemptedAt.getTime()>WINDOW)throw new HoaWorkflowError("Recurring reversal attempt requires reconciliation.",409);return current.reversalAttemptedAt?current:tx.recurringChargeRefund.update({where:{id},data:{reversalAttemptedAt:new Date()}});});
  reversal=await db.$transaction(async tx=>{const c=await lockRecurringCharge(tx,op.chargeId);const current=await tx.recurringChargeRefund.findUniqueOrThrow({where:{id}});if(current.stripeReversalId)return stripe.transfers.retrieveReversal(c.stripeTransferId!,current.stripeReversalId);if(!current.reversalAttemptedAt||Date.now()-current.reversalAttemptedAt.getTime()>WINDOW)throw new HoaWorkflowError("Recurring reversal requires reconciliation.",409);await requireStripeRefundOwner(tx,current.actorUserId);
 const fresh=await stripe.transfers.retrieve(c.stripeTransferId!);
 if(fresh.livemode!==false||fresh.amount!==c.transferAmountCents||fresh.currency!==c.currency||objectId(fresh.destination)!==c.providerAccountId||objectId(fresh.source_transaction)!==c.stripeChargeId||fresh.amount_reversed!==c.providerReversedCents)throw new HoaWorkflowError("Recurring reversal needs financial reconciliation.",409);
 return stripe.transfers.createReversal(c.stripeTransferId!,{amount:current.providerReversalCents,metadata:{bundleenRecurringRefundId:id}},{idempotencyKey:`recurring_reversal_${id}`});},{timeout:20000});
 }
 if(reversal.amount!==op.providerReversalCents||reversal.currency!==charge.currency||objectId(reversal.transfer)!==charge.stripeTransferId||reversal.metadata?.bundleenRecurringRefundId!==id)throw new HoaWorkflowError("Recurring reversal identity mismatch.",409);
 await db.$transaction(async tx=>{const c=await lockRecurringCharge(tx,op.chargeId);const current=await tx.recurringChargeRefund.findUniqueOrThrow({where:{id}});if(current.status==="succeeded")return;if(current.stripeReversalId&&current.stripeReversalId!==reversal!.id)throw new HoaWorkflowError("Recurring reversal identity changed.",409);await tx.recurringCharge.update({where:{id:c.id},data:{providerReversedCents:c.providerReversedCents+current.providerReversalCents}});await tx.recurringChargeRefund.update({where:{id},data:{stripeReversalId:reversal!.id,status:"succeeded"}});});
}

/** Record an already retrieved processor refund; never creates financial operations. */
export async function recordRecurringRefundSnapshot(op:RecurringChargeRefund,refund:Stripe.Refund){
 const charge=await db.recurringCharge.findUniqueOrThrow({where:{id:op.chargeId}});
 if(refund.amount!==op.amountCents||refund.currency!==charge.currency||objectId(refund.charge)!==charge.stripeChargeId||objectId(refund.payment_intent)!==charge.stripePaymentIntentId||refund.metadata?.bundleenRecurringRefundId!==op.id)throw new HoaWorkflowError("Recurring refund identity mismatch.",409);
 const id=op.id;
 await db.$transaction(async tx=>{
  const c=await lockRecurringCharge(tx,op.chargeId);const current=await tx.recurringChargeRefund.findUniqueOrThrow({where:{id}});
  if(current.stripeRefundId&&current.stripeRefundId!==refund.id)throw new HoaWorkflowError("Recurring refund identity changed.",409);
  if(["succeeded","reversal_pending"].includes(current.status))return;
  if(refund.status!=="succeeded"){await tx.recurringChargeRefund.update({where:{id},data:{stripeRefundId:refund.id,status:refund.status==="failed"||refund.status==="canceled"?"reconciliation_required":"pending"}});return;}
  const line=await tx.recurringChargeLine.findUniqueOrThrow({where:{id:current.lineId}});
  if(line.refundedCents!==current.previousLineRefundCents)throw new HoaWorkflowError("Recurring refund balance changed.",409);
  await tx.recurringChargeLine.update({where:{id:line.id},data:{refundedCents:line.refundedCents+current.amountCents}});
  const refundedCents=c.refundedCents+current.amountCents;
  await tx.recurringCharge.update({where:{id:c.id},data:{refundedCents,status:c.status==="disputed"?"disputed":refundedCents===c.amountCents?"refunded":"partially_refunded"}});
  await tx.recurringChargeRefund.update({where:{id},data:{stripeRefundId:refund.id,status:current.providerReversalCents>0?"reversal_pending":"succeeded"}});
 });
}
