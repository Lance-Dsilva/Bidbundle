import "server-only";
import type Stripe from "stripe";
import { db } from "@/lib/server/db";
import { HoaWorkflowError } from "@/lib/server/hoa";
import { lockRecurringCharge, recurringTestClient, recordRecurringIntent } from "@/lib/server/recurring-payments";
import { recordRecurringRefundSnapshot } from "@/lib/server/recurring-refunds";
const objectId=(v:string|{id:string}|null)=>typeof v==="string"?v:v?.id??null;
/** Returns false only for an event with no recurring owner; never creates money from an event. */
export async function reconcileRecurringFinancialEvent(eventId:string){
 if(process.env.RECURRING_TEST_PAYMENTS!=="1"||process.env.RECURRING_PLANS!=="1"||process.env.STRIPE_TEST_PAYMENTS!=="1")return false;
 const stripe=recurringTestClient();const event=await db.stripeTestEvent.findUniqueOrThrow({where:{id:eventId}});
 if(event.accountId)return false;
 if(event.processedAt)return true;
 let chargeId:string|null=null;let intentId:string|null=null;let eventTransfer:Stripe.Transfer|null=null;let dispute:Stripe.Dispute|null=null;
 if(event.eventType.startsWith("payment_intent."))intentId=event.objectId;
 else if(event.eventType==="charge.refunded")chargeId=event.objectId;
 else if(event.eventType.startsWith("refund.")){const refund=await stripe.refunds.retrieve(event.objectId);chargeId=objectId(refund.charge);const op=refund.metadata?.bundleenRecurringRefundId?await db.recurringChargeRefund.findUnique({where:{id:refund.metadata.bundleenRecurringRefundId}}):null;if(op){
 const owned=await db.recurringCharge.findUniqueOrThrow({where:{id:op.chargeId}});
 if(refund.id!==event.objectId||objectId(refund.charge)!==owned.stripeChargeId||objectId(refund.payment_intent)!==owned.stripePaymentIntentId||refund.amount!==op.amountCents||refund.currency!==owned.currency||(op.stripeRefundId&&op.stripeRefundId!==refund.id))throw new HoaWorkflowError("Recurring refund event ownership mismatch.",409);
 const original=await stripe.charges.retrieve(owned.stripeChargeId!);
 if(original.id!==owned.stripeChargeId||original.livemode!==false||original.amount!==owned.amountCents||original.currency!==owned.currency||objectId(original.payment_intent)!==owned.stripePaymentIntentId)throw new HoaWorkflowError("Recurring refund source mismatch.",409);
 await recordRecurringRefundSnapshot(op,refund);
 }}
 else if(event.eventType.startsWith("charge.dispute.")){dispute=await stripe.disputes.retrieve(event.objectId);chargeId=objectId(dispute.charge);}
 else if(event.eventType.startsWith("transfer.")){const transfer=await stripe.transfers.retrieve(event.objectId);eventTransfer=transfer;const owner=await db.recurringCharge.findUnique({where:{stripeTransferId:transfer.id}});chargeId=owner?.stripeChargeId??objectId(transfer.source_transaction);}
 else return false;
 let owner=intentId?await db.recurringCharge.findUnique({where:{stripePaymentIntentId:intentId}}):chargeId?await db.recurringCharge.findUnique({where:{stripeChargeId:chargeId}}):null;
 if(!owner&&chargeId){const charge=await stripe.charges.retrieve(chargeId);if(charge.id!==chargeId)throw new HoaWorkflowError("Recurring source charge identity mismatch.",409);intentId=objectId(charge.payment_intent);if(intentId)owner=await db.recurringCharge.findUnique({where:{stripePaymentIntentId:intentId}});}
 if(!owner)return false;

 await db.$transaction(async tx=>{
  const c=await lockRecurringCharge(tx,owner!.id);
  const currentEvent=await tx.stripeTestEvent.findUniqueOrThrow({where:{id:eventId}});if(currentEvent.processedAt)return;
  if(!c.stripePaymentIntentId)throw new HoaWorkflowError("Missing recurring intent identity.",409);
  const intent=await stripe.paymentIntents.retrieve(c.stripePaymentIntentId);
  const updated=await recordRecurringIntent(tx,c,intent);
  if(eventTransfer){eventTransfer=await stripe.transfers.retrieve(event.objectId);if(eventTransfer.id!==event.objectId)throw new HoaWorkflowError("Recurring transfer event identity mismatch.",409);}
  if(dispute){dispute=await stripe.disputes.retrieve(event.objectId);if(dispute.id!==event.objectId||objectId(dispute.charge)!==updated.stripeChargeId)throw new HoaWorkflowError("Recurring dispute event identity mismatch.",409);}
  const eventTransferOwned=!eventTransfer||(!!updated.transferAttemptedAt&&eventTransfer.livemode===false&&eventTransfer.amount===updated.transferAmountCents&&eventTransfer.currency===updated.currency&&objectId(eventTransfer.destination)===updated.providerAccountId&&objectId(eventTransfer.source_transaction)===updated.stripeChargeId&&eventTransfer.transfer_group===`recurring_${updated.id}`&&eventTransfer.metadata.bundleenRecurringChargeId===updated.id&&(!updated.stripeTransferId||updated.stripeTransferId===eventTransfer.id));

  if(updated.stripeChargeId){
   const charge=await stripe.charges.retrieve(updated.stripeChargeId);
   if(charge.id!==updated.stripeChargeId||charge.livemode!==false||charge.amount!==c.amountCents||charge.currency!==c.currency||objectId(charge.customer)!==c.customerId||objectId(charge.payment_intent)!==c.stripePaymentIntentId)throw new HoaWorkflowError("Recurring financial source mismatch.",409);
   let reason=charge.disputed?"processor_dispute":charge.amount_refunded!==updated.refundedCents?"unknown_refund":eventTransfer&&!eventTransferOwned?"unknown_transfer":null;
   let reversed=updated.observedReversedCents;
   if(updated.stripeTransferId||(eventTransfer&&eventTransferOwned)){const transfer=updated.stripeTransferId?await stripe.transfers.retrieve(updated.stripeTransferId):eventTransfer!;if(transfer.id!==(updated.stripeTransferId??event.objectId)||transfer.livemode!==false||transfer.amount!==updated.transferAmountCents||transfer.currency!==updated.currency||objectId(transfer.destination)!==updated.providerAccountId||objectId(transfer.source_transaction)!==updated.stripeChargeId||transfer.metadata.bundleenRecurringChargeId!==updated.id||transfer.transfer_group!==`recurring_${updated.id}`)throw new HoaWorkflowError("Recurring transfer source mismatch.",409);if(!updated.stripeTransferId){if(!updated.transferAttemptedAt)throw new HoaWorkflowError("Unreserved recurring transfer requires reconciliation.",409);await tx.recurringCharge.update({where:{id:c.id},data:{stripeTransferId:transfer.id}});}reversed=transfer.amount_reversed;if(reversed!==updated.providerReversedCents)reason??="unknown_reversal";}
   const hold=reason??updated.reconciliationHoldReason;
   await tx.recurringCharge.update({where:{id:c.id},data:{observedRefundedCents:charge.amount_refunded,observedReversedCents:reversed,reconciliationHoldReason:hold,...(charge.disputed?{status:"disputed"}: {})}});
  }
  const observed=await tx.recurringCharge.findUniqueOrThrow({where:{id:c.id}});
  await tx.recurringFinancialObservation.create({data:{eventId,chargeId:c.id,eventType:event.eventType,objectId:event.objectId,processorChargeId:observed.stripeChargeId,processorTransferId:observed.stripeTransferId,refundedCents:observed.observedRefundedCents,reversedCents:observed.observedReversedCents,disputed:observed.status==="disputed",disputeId:dispute?.id??null,disputeStatus:dispute?.status??null,holdReason:observed.reconciliationHoldReason}});
  await tx.stripeTestEvent.update({where:{id:eventId},data:{processedAt:new Date()}});
 },{timeout:25000});
 return true;
}
