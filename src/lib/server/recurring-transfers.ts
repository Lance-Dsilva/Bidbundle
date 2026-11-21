import "server-only";
import { db } from "@/lib/server/db";
import { HoaWorkflowError } from "@/lib/server/hoa";
import { lockRecurringCharge, recurringTestClient } from "@/lib/server/recurring-payments";
import { recurringLineRefundBalance } from "@/lib/recurring-financial-amounts";
import type { Prisma, RecurringCharge } from "@/generated/prisma/client";
import type Stripe from "stripe";
const WINDOW=23*60*60*1000;
const remoteId=(v:string|{id:string}|null)=>typeof v==="string"?v:v?.id??null;
async function eligibility(tx:Prisma.TransactionClient,c:RecurringCharge){
 if(c.reconciliationHoldReason || !["succeeded","partially_refunded"].includes(c.status) || !c.stripeChargeId || !c.stripePaymentIntentId)throw new HoaWorkflowError("Recurring payout requires a reconciled paid charge.",409);
 const lines=await tx.recurringChargeLine.findMany({where:{chargeId:c.id}});
 if(await tx.serviceQualityClaim.findFirst({select:{id:true},where:{visitId:{in:lines.map(l=>l.visitId)},resolution:{in:["reported","redo_pending","refund_pending"]}}}))throw new HoaWorkflowError("Resolve the service claim before provider payout.",409);
 if(await tx.recurringChargeRefund.findFirst({where:{chargeId:c.id,status:{not:"succeeded"}}}))throw new HoaWorkflowError("Finish the pending recurring refund first.",409);
 await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id"=${c.providerUserId} FOR SHARE`;
 await tx.$queryRaw`SELECT "userId" FROM "ProviderProfile" WHERE "userId"=${c.providerUserId} FOR SHARE`;
 const profile=await tx.providerProfile.findUnique({where:{userId:c.providerUserId}});
 if(profile?.accountStatus!=="active"||profile.stripeTestPayoutStatus!=="active"||profile.stripeTestAccountId!==c.providerAccountId)throw new HoaWorkflowError("Original provider payout account requires review.",409);
 return lines.reduce((n,l)=>n+recurringLineRefundBalance(l,l.refundedCents).providerRemainingCents,0);
}
function verify(t:Stripe.Transfer,c:RecurringCharge){
 if(t.livemode!==false||t.amount!==c.transferAmountCents||t.currency!==c.currency||remoteId(t.destination)!==c.providerAccountId||remoteId(t.source_transaction)!==c.stripeChargeId||t.transfer_group!==`recurring_${c.id}`||t.metadata.bundleenRecurringChargeId!==c.id||t.amount_reversed!==c.providerReversedCents)throw new HoaWorkflowError("Recurring transfer identity requires reconciliation.",409);
}
export async function transferRecurringCharge(id:string){
 const stripe=recurringTestClient();
 let c=await db.recurringCharge.findUniqueOrThrow({where:{id}});
 if(c.stripeTransferId)return;
 // Read-only recovery always precedes new eligibility checks, including new holds.
 if(c.transferAttemptedAt){
  const list=await stripe.transfers.list({transfer_group:`recurring_${c.id}`,limit:100});
  const matches=list.data.filter(t=>t.metadata.bundleenRecurringChargeId===c.id);
  if(list.has_more||matches.length>1)throw new HoaWorkflowError("Recurring transfer needs reconciliation.",409);
  if(matches.length){verify(matches[0],c);await db.$transaction(async tx=>{const current=await lockRecurringCharge(tx,id);verify(matches[0],current);await tx.recurringCharge.update({where:{id},data:{stripeTransferId:matches[0].id}});});return;}
 }
 c=await db.$transaction(async tx=>{
  const current=await lockRecurringCharge(tx,id);
  if(current.stripeTransferId)return current;
  const amount=await eligibility(tx,current);
  if(amount===0)return current;
  const remoteCharge=await stripe.charges.retrieve(current.stripeChargeId!);
  if(remoteCharge.livemode!==false||!remoteCharge.paid||remoteId(remoteCharge.customer)!==current.customerId||remoteCharge.amount!==current.amountCents||remoteCharge.currency!==current.currency||remoteId(remoteCharge.payment_intent)!==current.stripePaymentIntentId||remoteCharge.amount_refunded!==current.refundedCents||remoteCharge.disputed)throw new HoaWorkflowError("Recurring charge requires reconciliation before payout.",409);
  const account=await stripe.accounts.retrieve(current.providerAccountId);
  if(account.id!==current.providerAccountId||account.metadata?.bundleenProviderUserId!==current.providerUserId||account.capabilities?.transfers!=="active"||!account.payouts_enabled)throw new HoaWorkflowError("Provider sandbox payouts are unavailable.",409);
  if(current.transferAttemptedAt){if(Date.now()-current.transferAttemptedAt.getTime()>WINDOW)throw new HoaWorkflowError("Recurring transfer attempt requires reconciliation.",409);return current;}
  return tx.recurringCharge.update({where:{id},data:{transferAttemptedAt:new Date(),transferAmountCents:amount,transferBaseProviderDebitCents:current.providerAmountCents-amount}});
 },{timeout:20000});
 if(c.stripeTransferId||!c.transferAttemptedAt||!c.transferAmountCents)return;
 await db.$transaction(async tx=>{
  const current=await lockRecurringCharge(tx,id);
  if(current.stripeTransferId)return;
  await eligibility(tx,current);
  if(!current.transferAttemptedAt||Date.now()-current.transferAttemptedAt.getTime()>WINDOW)throw new HoaWorkflowError("Recurring payout requires reconciliation.",409);
  const freshCharge=await stripe.charges.retrieve(current.stripeChargeId!);
  const freshAccount=await stripe.accounts.retrieve(current.providerAccountId);
  if(freshCharge.livemode!==false||!freshCharge.paid||freshCharge.amount!==current.amountCents||freshCharge.currency!==current.currency||remoteId(freshCharge.customer)!==current.customerId||remoteId(freshCharge.payment_intent)!==current.stripePaymentIntentId||freshCharge.amount_refunded!==current.refundedCents||freshCharge.disputed||freshAccount.id!==current.providerAccountId||freshAccount.metadata?.bundleenProviderUserId!==current.providerUserId||freshAccount.capabilities?.transfers!=="active"||!freshAccount.payouts_enabled)throw new HoaWorkflowError("Recurring payout requires fresh financial reconciliation.",409);
  const transfer=await stripe.transfers.create({amount:current.transferAmountCents!,currency:current.currency,destination:current.providerAccountId,source_transaction:current.stripeChargeId!,transfer_group:`recurring_${current.id}`,metadata:{bundleenRecurringChargeId:current.id}},{idempotencyKey:`recurring_transfer_${current.id}`});
  verify(transfer,current);
  await tx.recurringCharge.update({where:{id},data:{stripeTransferId:transfer.id}});
 },{timeout:20000});
}
