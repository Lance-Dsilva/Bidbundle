import { describe, expect, it } from 'vitest';
import { recurringLineEntitlements, recurringLineRefundBalance, recurringRefundDelta } from '@/lib/recurring-financial-amounts';

describe('independent recurring line accounting',()=>{
 it('uses fixed cumulative refund oracles rather than rounding incremental refunds',()=>{
  const line=recurringLineEntitlements(1001,1000,500);
  expect(line).toEqual({grossCents:1001,feeCents:100,providerCents:901,hoaCents:50});
  for(const [refund,provider,hoa] of [[333,299,16],[666,599,33],[1000,900,49],[1001,901,50]]) {
   expect(recurringLineRefundBalance(line,refund)).toMatchObject({providerDebitCents:provider,hoaDebitCents:hoa});
  }
  expect(recurringRefundDelta(line,333,666)).toEqual({grossCents:333,providerCents:300,hoaCents:17});
  expect(recurringRefundDelta(line,1000,1001)).toEqual({grossCents:1,providerCents:1,hoaCents:1});
 });
 it('leaves the one-cent rounding liability with Bundleen',()=>{
  expect(recurringLineRefundBalance(recurringLineEntitlements(1001,1000,500),1000)).toEqual({providerDebitCents:900,hoaDebitCents:49,remainingGrossCents:1,providerRemainingCents:1,hoaRemainingCents:1,platformNetCents:-1,platformRoundingLiabilityCents:1});
 });
 it('preserves exact original entitlements across arbitrary refund partitions',()=>{
  for(const gross of [1,49,50,99,101,1001,10001])for(const hoaBps of [0,125,500,1000]) {
   const line=recurringLineEntitlements(gross,1000,hoaBps);
   const points=[0,Math.floor(gross/7),Math.floor(gross/3),Math.floor(gross*2/3),gross];
   const sum=points.slice(1).reduce((total,next,index)=>{
    const delta=recurringRefundDelta(line,points[index],next);
    return {gross:total.gross+delta.grossCents,provider:total.provider+delta.providerCents,hoa:total.hoa+delta.hoaCents};
   },{gross:0,provider:0,hoa:0});
   expect(sum).toEqual({gross,provider:line.providerCents,hoa:line.hoaCents});
   expect(recurringLineRefundBalance(line,gross)).toMatchObject({remainingGrossCents:0,providerRemainingCents:0,hoaRemainingCents:0,platformNetCents:0,platformRoundingLiabilityCents:0});
  }
 });
 it('keeps at least90percent provider entitlement for every remaining subset without aggregate remainder redistribution',()=>{
  const lines=[11,19,101,1001,2001].map(gross=>recurringLineEntitlements(gross,1000,500));
  for(let mask=1;mask<(1<<lines.length);mask++) {
   const selected=lines.filter((_line,index)=>mask&(1<<index));
   for(const refundRatio of [0,0.1,0.5,0.999,1]) {
    const remaining=selected.map(line=>recurringLineRefundBalance(line,Math.floor(line.grossCents*refundRatio)));
    const gross=remaining.reduce((n,v)=>n+v.remainingGrossCents,0),provider=remaining.reduce((n,v)=>n+v.providerRemainingCents,0);
    expect(provider*10).toBeGreaterThanOrEqual(gross*9);
   }
  }
  // Each11cent line owes1cent fee: aggregate floor22*10%=2, but
  // three19cent lines owe3, not aggregate floor57*10%=5.
  const small=[19,19,19].map(gross=>recurringLineEntitlements(gross,1000,500));
  expect(small.reduce((n,v)=>n+v.feeCents,0)).toBe(3);
  expect(small.reduce((n,v)=>n+v.providerCents,0)).toBe(54);
 });
 it('calculates large safe-integer proportions without floating-point multiplication loss',()=>{
  expect(recurringLineEntitlements(Number.MAX_SAFE_INTEGER,1000,500)).toEqual({grossCents:9007199254740991,feeCents:900719925474099,providerCents:8106479329266892,hoaCents:450359962737049});
 });
 it.each([-1,0.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1])('rejects invalid gross %s',gross=>{expect(()=>recurringLineEntitlements(gross,1000,500)).toThrow();});
 it.each([[1001,0],[1000,1001],[-1,0],[1.5,0],[1000,-1]])('rejects invalid fee/share %s %s',(fee,hoa)=>{expect(()=>recurringLineEntitlements(1001,fee,hoa)).toThrow();});
 it('rejects refund over cap, negative, fraction, and descending cumulative totals',()=>{
  const line=recurringLineEntitlements(1001,1000,500);
  for(const refund of [-1,1002,0.1,NaN,Infinity])expect(()=>recurringLineRefundBalance(line,refund)).toThrow();
  expect(()=>recurringRefundDelta(line,500,499)).toThrow('cannot decrease');
  expect(recurringRefundDelta(line,333,333)).toEqual({grossCents:0,providerCents:0,hoaCents:0});
 });
});

// Processor is entirely mocked. These tests exercise the real dispatcher with
// an existing durable reservation; they do not claim SQL reservation coverage.
const dispatchMocks=vi.hoisted(()=>{
 const table=()=>({findFirst:vi.fn(),findUnique:vi.fn(),findUniqueOrThrow:vi.fn(),findMany:vi.fn(),create:vi.fn(),createMany:vi.fn(),update:vi.fn(),updateMany:vi.fn()});
 const tx:any={$queryRaw:vi.fn(),recurringMonthlyBill:table(),recurringSubscription:table(),recurringPlan:table(),recurringBillLine:table(),recurringCharge:table(),recurringChargeLine:table(),serviceVisit:table(),user:table(),providerProfile:table(),community:table(),recurringChargeRefund:table(),serviceQualityClaim:table(),recurringChargeRecovery:table(),recurringRecoverySetup:table(),adminAuditLog:table()};
 return{tx,owner:vi.fn(),setupCreate:vi.fn(),setupList:vi.fn(),setupRetrieve:vi.fn(),refundCreate:vi.fn(),refundRetrieve:vi.fn(),refundList:vi.fn(),chargeRetrieve:vi.fn(),accountRetrieve:vi.fn(),transferCreate:vi.fn(),transferRetrieve:vi.fn(),transferList:vi.fn(),reversalCreate:vi.fn(),reversalRetrieve:vi.fn(),reversalList:vi.fn(),create:vi.fn(),retrieve:vi.fn(),confirm:vi.fn(),db:{$transaction:vi.fn(),recurringCharge:tx.recurringCharge,recurringChargeRefund:tx.recurringChargeRefund,recurringChargeRecovery:tx.recurringChargeRecovery,user:tx.user}};
});
vi.mock('server-only',()=>({}));
vi.mock('@/lib/server/db',()=>({db:dispatchMocks.db}));
vi.mock('@/lib/server/stripe-test-refunds',()=>({requireStripeRefundOwner:dispatchMocks.owner}));
vi.mock('stripe',()=>({default:class{static errors={StripeCardError:class extends Error{}};setupIntents={create:dispatchMocks.setupCreate,retrieve:dispatchMocks.setupRetrieve,list:dispatchMocks.setupList};refunds={create:dispatchMocks.refundCreate,retrieve:dispatchMocks.refundRetrieve,list:dispatchMocks.refundList};charges={retrieve:dispatchMocks.chargeRetrieve};accounts={retrieve:dispatchMocks.accountRetrieve};transfers={create:dispatchMocks.transferCreate,retrieve:dispatchMocks.transferRetrieve,list:dispatchMocks.transferList,createReversal:dispatchMocks.reversalCreate,retrieveReversal:dispatchMocks.reversalRetrieve,listReversals:dispatchMocks.reversalList};paymentIntents={create:dispatchMocks.create,retrieve:dispatchMocks.retrieve,confirm:dispatchMocks.confirm};}}));
import { beforeEach, vi } from 'vitest';
import { chargeRecurringSource, prepareRecurringCharge, getRecurringReceipt } from '@/lib/server/recurring-payments';
let durable:any;
const remote=(status='requires_confirmation',extra={})=>({id:'pi_owned',status,livemode:false,amount:1001,currency:'usd',customer:'cus_original',payment_method:'pm_original',receipt_email:'original@example.invalid',metadata:{bundleenRecurringChargeId:'charge'},latest_charge:null,...extra});
beforeEach(()=>{
 vi.clearAllMocks();vi.stubEnv('RECURRING_PLANS','1');vi.stubEnv('RECURRING_TEST_PAYMENTS','1');vi.stubEnv('STRIPE_TEST_PAYMENTS','1');vi.stubEnv('STRIPE_SECRET_KEY','sk_test_fake');
 durable={id:'charge',amountCents:1001,currency:'usd',customerId:'cus_original',paymentMethodId:'pm_original',receiptEmail:'original@example.invalid',stripePaymentIntentId:null,createAttemptedAt:null,confirmAttemptedAt:null,reconciliationHoldReason:null,paidAt:null};
 dispatchMocks.db.$transaction.mockImplementation((fn:any)=>fn(dispatchMocks.tx));
 dispatchMocks.tx.recurringMonthlyBill.findUnique.mockResolvedValue({id:'bill',subscriptionId:'sub'});
 dispatchMocks.tx.recurringSubscription.findUniqueOrThrow.mockResolvedValue({id:'sub',planId:'plan'});
 dispatchMocks.tx.recurringPlan.findUniqueOrThrow.mockResolvedValue({id:'plan',agreementId:'agreement'});
 dispatchMocks.tx.recurringBillLine.findMany.mockResolvedValue([{visitId:'visit'}]);
 dispatchMocks.tx.recurringChargeLine.findMany.mockResolvedValue([{visitId:'visit'}]);dispatchMocks.tx.recurringChargeRecovery.findMany.mockResolvedValue([]);
 dispatchMocks.tx.recurringCharge.findUnique.mockImplementation(async()=>({...durable}));
 dispatchMocks.tx.recurringCharge.findUniqueOrThrow.mockImplementation(async()=>({...durable}));
 dispatchMocks.tx.recurringCharge.update.mockImplementation(async({data}:any)=>Object.assign(durable,data));
 dispatchMocks.tx.recurringCharge.updateMany.mockImplementation(async({data}:any)=>{Object.assign(durable,data);return{count:1};});
 dispatchMocks.create.mockResolvedValue(remote());dispatchMocks.retrieve.mockResolvedValue(remote());dispatchMocks.confirm.mockResolvedValue(remote('succeeded',{latest_charge:'ch_owned'}));
});
describe('independent recurring dispatcher replay and ownership',()=>{
 it('creates without confirming, persists identity, then confirms the same intent with separate stable keys',async()=>{
  const result=await chargeRecurringSource({monthlyBillId:'bill'});expect(result.status).toBe('succeeded');
  expect(dispatchMocks.create).toHaveBeenCalledWith(expect.objectContaining({receipt_email:'original@example.invalid',customer:'cus_original',payment_method:'pm_original'}),{idempotencyKey:'recurring_create_charge'});
  expect(dispatchMocks.create.mock.calls[0][0]).not.toHaveProperty('confirm');
  expect(dispatchMocks.confirm).toHaveBeenCalledWith('pi_owned',{off_session:true},{idempotencyKey:'recurring_confirm_charge'});
  expect(durable.stripePaymentIntentId).toBe('pi_owned');expect(durable.confirmAttemptedAt).toBeInstanceOf(Date);
 });
 it('retries a lost creation response with the identical key and preserved first attempt clock',async()=>{
  dispatchMocks.create.mockRejectedValueOnce(new Error('synthetic lost response'));
  await expect(chargeRecurringSource({monthlyBillId:'bill'})).rejects.toThrow('synthetic lost response');const first=durable.createAttemptedAt;
  await chargeRecurringSource({monthlyBillId:'bill'});
  expect(dispatchMocks.create.mock.calls[0]).toEqual(dispatchMocks.create.mock.calls[1]);expect(durable.createAttemptedAt).toBe(first);
 });
 it('recovers a lost confirmation response by retrieving success without a second confirmation',async()=>{
  durable.stripePaymentIntentId='pi_owned';dispatchMocks.confirm.mockRejectedValueOnce(new Error('synthetic lost response'));
  await expect(chargeRecurringSource({monthlyBillId:'bill'})).rejects.toThrow('synthetic lost response');
  dispatchMocks.retrieve.mockResolvedValue(remote('succeeded',{latest_charge:'ch_owned'}));
  expect((await chargeRecurringSource({monthlyBillId:'bill'})).status).toBe('succeeded');expect(dispatchMocks.create).not.toHaveBeenCalled();expect(dispatchMocks.confirm).toHaveBeenCalledTimes(1);
 });
 it.each(['below_minimum','unknown_adjustment'])('never mutates processor for %s hold',async hold=>{
  durable.reconciliationHoldReason=hold;await expect(chargeRecurringSource({monthlyBillId:'bill'})).rejects.toThrow('billing review');expect(dispatchMocks.create).not.toHaveBeenCalled();expect(dispatchMocks.confirm).not.toHaveBeenCalled();
 });
 it('refuses stale uncertain creation rather than obtaining a new processor identity',async()=>{
  durable.createAttemptedAt=new Date(Date.now()-24*60*60*1000);await expect(chargeRecurringSource({monthlyBillId:'bill'})).rejects.toThrow('requires reconciliation');expect(dispatchMocks.create).not.toHaveBeenCalled();
 });
 it.each([{id:'pi_foreign'},{livemode:true},{amount:1002},{currency:'eur'},{customer:'cus_new_occupant'},{payment_method:'pm_foreign'},{receipt_email:'changed@example.invalid'},{metadata:{bundleenRecurringChargeId:'another'}}])('rejects authoritative processor identity mismatch %j',async change=>{
  durable.stripePaymentIntentId='pi_owned';dispatchMocks.retrieve.mockResolvedValue(remote('requires_confirmation',change));await expect(chargeRecurringSource({monthlyBillId:'bill'})).rejects.toThrow('identity mismatch');expect(dispatchMocks.confirm).not.toHaveBeenCalled();
 });
 it('records requires_action without creating a replacement intent or blindly confirming',async()=>{
  durable.stripePaymentIntentId='pi_owned';dispatchMocks.retrieve.mockResolvedValue(remote('requires_action'));
  expect((await chargeRecurringSource({monthlyBillId:'bill'})).status).toBe('requires_action');expect(dispatchMocks.create).not.toHaveBeenCalled();expect(dispatchMocks.confirm).not.toHaveBeenCalled();
 });
});

describe('independent new recurring reservation',()=>{
 const authorizedAt=new Date('2026-01-01'),completedAt=new Date('2026-01-10');
 function reservation(gross=1001){
  dispatchMocks.tx.recurringCharge.findUnique.mockResolvedValue(null);
  dispatchMocks.tx.recurringMonthlyBill.findUnique.mockResolvedValue({id:'bill',subscriptionId:'sub',month:'2026-01',amountCents:gross});
  dispatchMocks.tx.recurringSubscription.findUniqueOrThrow.mockResolvedValue({id:'sub',planId:'plan',payerUserId:'original',unitId:'unit',customerId:'cus_original',paymentMethodId:'pm_original',receiptEmail:'frozen@example.invalid',termsToken:'accepted-terms',acceptedAt:authorizedAt,cardVerifiedAt:authorizedAt});
  dispatchMocks.tx.recurringPlan.findUniqueOrThrow.mockResolvedValue({id:'plan',agreementId:'agreement',communityId:'community',providerUserId:'provider',acceptedAt:authorizedAt,billingMode:'monthly',currency:'usd'});
  dispatchMocks.tx.recurringBillLine.findMany.mockResolvedValue([{visitId:'visit',amountCents:gross}]);
  dispatchMocks.tx.serviceVisit.findMany.mockResolvedValue([{id:'visit',recurringSubscriptionId:'sub',unitId:'unit',billingPayerUserId:'original',redoOfVisitId:null,status:'completed',completedAt,allocatedVisitCents:gross,recurringMonth:'2026-01',occurrence:{recurringPlanId:'plan',agreementId:'agreement',recurringLocalDate:'2026-01-10'}}]);
  dispatchMocks.tx.user.findUniqueOrThrow.mockResolvedValue({isVerified:true,stripeTestCustomerId:'cus_original',email:'current@example.invalid'});
  dispatchMocks.tx.providerProfile.findUnique.mockResolvedValue({accountStatus:'active',stripeTestPayoutStatus:'active',stripeTestAccountId:'acct_original'});
  dispatchMocks.tx.community.findUniqueOrThrow.mockResolvedValue({hoaRevenueShareBps:500});
  dispatchMocks.tx.recurringCharge.create.mockImplementation(async({data}:any)=>({id:'new-charge',...data}));
 }
 it('freezes original receipt/card/account and line cents rather than current email',async()=>{
  reservation();const charge=await prepareRecurringCharge({monthlyBillId:'bill'});
  expect(charge).toMatchObject({payerUserId:'original',receiptEmail:'frozen@example.invalid',paymentMethodId:'pm_original',providerAccountId:'acct_original',amountCents:1001,platformFeeCents:100,providerAmountCents:901,hoaShareCents:50,monthlyBillId:'bill',sourceVisitId:null});
  expect(dispatchMocks.tx.recurringChargeLine.createMany).toHaveBeenCalledWith({data:[{chargeId:'new-charge',visitId:'visit',localDate:'2026-01-10',grossCents:1001,feeCents:100,providerCents:901,hoaCents:50}]});expect(dispatchMocks.create).not.toHaveBeenCalled();
 });
 it('holds a lawful subminimum monthly remainder without rounding it up',async()=>{reservation(49);expect(await prepareRecurringCharge({monthlyBillId:'bill'})).toMatchObject({amountCents:49,reconciliationHoldReason:'below_minimum'});expect(dispatchMocks.create).not.toHaveBeenCalled();});
 it.each([{billingPayerUserId:'new-occupant'},{recurringSubscriptionId:'other'},{unitId:'other'},{redoOfVisitId:'original-visit'},{status:'skipped'},{completedAt:new Date('2025-12-31')}])('rejects mismatched or pre-consent constituent %j',async change=>{
  reservation();const visits=await dispatchMocks.tx.serviceVisit.findMany();dispatchMocks.tx.serviceVisit.findMany.mockResolvedValue([{...visits[0],...change}]);await expect(prepareRecurringCharge({monthlyBillId:'bill'})).rejects.toThrow('does not match recurring authorization');expect(dispatchMocks.tx.recurringCharge.create).not.toHaveBeenCalled();
 });
 it('rejects source under monthly plan when invoked as per-visit',async()=>{reservation();dispatchMocks.tx.serviceVisit.findUnique.mockResolvedValue({id:'visit',recurringSubscriptionId:'sub'});await expect(prepareRecurringCharge({visitId:'visit'})).rejects.toThrow('authorization is incomplete');expect(dispatchMocks.tx.recurringCharge.create).not.toHaveBeenCalled();});
 it('rejects replacement of the original customer before first reservation',async()=>{reservation();dispatchMocks.tx.user.findUniqueOrThrow.mockResolvedValue({isVerified:true,stripeTestCustomerId:'cus_replacement'});await expect(prepareRecurringCharge({monthlyBillId:'bill'})).rejects.toThrow('Original payer customer');expect(dispatchMocks.tx.recurringCharge.create).not.toHaveBeenCalled();});
});

it.each([[333,'partially_refunded'],[1001,'refunded']] as const)('successful PI replay preserves settled refund status %s',async(refunded,status)=>{
 durable.stripePaymentIntentId='pi_owned';durable.refundedCents=refunded;durable.status=status;dispatchMocks.retrieve.mockResolvedValue(remote('succeeded',{latest_charge:'ch_owned'}));
 expect((await chargeRecurringSource({monthlyBillId:'bill'})).status).toBe(status);expect(dispatchMocks.confirm).not.toHaveBeenCalled();
});
it('successful PI replay preserves existing disputed status',async()=>{durable.stripePaymentIntentId='pi_owned';durable.status='disputed';dispatchMocks.retrieve.mockResolvedValue(remote('succeeded',{latest_charge:'ch_owned'}));expect((await chargeRecurringSource({monthlyBillId:'bill'})).status).toBe('disputed');expect(dispatchMocks.confirm).not.toHaveBeenCalled();});

import { requestRecurringRefund, processRecurringRefund } from '@/lib/server/recurring-refunds';
import { transferRecurringCharge } from '@/lib/server/recurring-transfers';
let operation:any,financialLine:any;
function financialFixture(refunded=0){
 Object.assign(durable,{status:'succeeded',stripePaymentIntentId:'pi_owned',stripeChargeId:'ch_owned',providerUserId:'provider',providerAccountId:'acct_original',providerAmountCents:901,refundedCents:refunded,providerReversedCents:0,transferAttemptedAt:null,stripeTransferId:null,transferAmountCents:null});
 financialLine={id:'line',chargeId:'charge',visitId:'visit',...recurringLineEntitlements(1001,1000,500),refundedCents:refunded};
 operation={id:'refund',chargeId:'charge',lineId:'line',actorUserId:'owner',reason:'service_quality',amountCents:333,previousLineRefundCents:refunded,providerDebitCents:299,hoaDebitCents:16,providerReversalCents:0,status:'pending',stripeRefundId:null,refundAttemptedAt:null,reversalAttemptedAt:null};
 dispatchMocks.owner.mockResolvedValue({});
 dispatchMocks.tx.recurringChargeLine.findMany.mockImplementation(async()=>[{...financialLine}]);
 dispatchMocks.tx.recurringChargeLine.findUnique.mockImplementation(async()=>({...financialLine}));
 dispatchMocks.tx.recurringChargeLine.findUniqueOrThrow.mockImplementation(async()=>({...financialLine}));
 dispatchMocks.tx.recurringChargeLine.update.mockImplementation(async({data}:any)=>Object.assign(financialLine,data));
 dispatchMocks.tx.recurringChargeRefund.findUnique.mockResolvedValue(null);
 dispatchMocks.tx.recurringChargeRefund.findFirst.mockResolvedValue(null);
 dispatchMocks.tx.recurringChargeRefund.findUniqueOrThrow.mockImplementation(async()=>({...operation}));
 dispatchMocks.tx.recurringChargeRefund.create.mockImplementation(async({data}:any)=>Object.assign(operation,data));
 dispatchMocks.tx.recurringChargeRefund.update.mockImplementation(async({data}:any)=>Object.assign(operation,data));
 dispatchMocks.tx.serviceQualityClaim.findFirst.mockResolvedValue(null);
 dispatchMocks.tx.providerProfile.findUnique.mockResolvedValue({accountStatus:'active',stripeTestPayoutStatus:'active',stripeTestAccountId:'acct_original'});
 dispatchMocks.chargeRetrieve.mockImplementation(async()=>({id:'ch_owned',livemode:false,paid:true,customer:'cus_original',amount:1001,currency:'usd',payment_intent:'pi_owned',amount_refunded:durable.refundedCents,disputed:false}));
 dispatchMocks.accountRetrieve.mockResolvedValue({id:'acct_original',metadata:{bundleenProviderUserId:'provider'},capabilities:{transfers:'active'},payouts_enabled:true});
 dispatchMocks.refundCreate.mockResolvedValue({id:'re_owned',amount:333,currency:'usd',charge:'ch_owned',payment_intent:'pi_owned',metadata:{bundleenRecurringRefundId:'refund'},status:'succeeded'});
 dispatchMocks.refundList.mockResolvedValue({data:[],has_more:false});
 dispatchMocks.transferList.mockResolvedValue({data:[],has_more:false});
 dispatchMocks.transferCreate.mockImplementation(async(data:any)=>({id:'tr_owned',livemode:false,amount_reversed:0,...data}));
}
describe('independent refund reservations and payout boundaries',()=>{
 it('reserves cumulative debit after earlier partial refund, never incremental floors',async()=>{financialFixture(333);expect(await requestRecurringRefund('owner','visit',{id:'second',amountCents:333,reason:'service_quality'})).toMatchObject({previousLineRefundCents:333,providerDebitCents:300,hoaDebitCents:17,providerReversalCents:0});});
 it('rejects insufficient remaining line gross even if aggregate charge has money',async()=>{financialFixture(900);await expect(requestRecurringRefund('owner','visit',{id:'new',amountCents:102,reason:'service_quality'})).rejects.toThrow('remaining paid amount');expect(dispatchMocks.tx.recurringChargeRefund.create).not.toHaveBeenCalled();});
 it('pending refund blocks another reservation even when balance alone suffices',async()=>{financialFixture();dispatchMocks.tx.recurringChargeRefund.findFirst.mockResolvedValue({id:'pending'});await expect(requestRecurringRefund('owner','visit',{id:'new',amountCents:1,reason:'service_quality'})).rejects.toThrow('Finish the existing refund');});
 it('enforces owner authority before any refund reservation',async()=>{financialFixture();dispatchMocks.owner.mockRejectedValueOnce(new Error('owner required'));await expect(requestRecurringRefund('resident','visit',{id:'new',amountCents:1,reason:'service_quality'})).rejects.toThrow('owner required');expect(dispatchMocks.tx.recurringChargeRefund.create).not.toHaveBeenCalled();});
 it('cannot reuse refund operation identity with a different amount',async()=>{financialFixture();dispatchMocks.tx.recurringChargeRefund.findUnique.mockResolvedValue({...operation});await expect(requestRecurringRefund('owner','visit',{id:'refund',amountCents:334,reason:'service_quality'})).rejects.toThrow('identity changed');});
 it('recovers lost refund response by owned remote metadata without a second refund',async()=>{
  financialFixture();dispatchMocks.refundCreate.mockRejectedValueOnce(new Error('lost refund response'));
  await expect(processRecurringRefund('refund')).rejects.toThrow('lost refund response');expect(operation.refundAttemptedAt).toBeInstanceOf(Date);
  dispatchMocks.refundList.mockResolvedValue({data:[{id:'re_owned',amount:333,currency:'usd',charge:'ch_owned',payment_intent:'pi_owned',metadata:{bundleenRecurringRefundId:'refund'},status:'succeeded'}],has_more:false});
  await processRecurringRefund('refund');expect(dispatchMocks.refundCreate).toHaveBeenCalledTimes(1);expect(financialLine.refundedCents).toBe(333);expect(durable.refundedCents).toBe(333);expect(operation.status).toBe('succeeded');
 });
 it('rejects ambiguous matching remote refunds instead of guessing ownership',async()=>{financialFixture();operation.refundAttemptedAt=new Date();dispatchMocks.refundList.mockResolvedValue({data:[{metadata:{bundleenRecurringRefundId:'refund'}},{metadata:{bundleenRecurringRefundId:'refund'}}],has_more:false});await expect(processRecurringRefund('refund')).rejects.toThrow('requires reconciliation');expect(dispatchMocks.refundCreate).not.toHaveBeenCalled();});
 it('freezes residual provider baseline after pre-transfer partial refund',async()=>{financialFixture(333);durable.status='partially_refunded';await transferRecurringCharge('charge');expect(durable.transferAmountCents).toBe(602);expect(durable.transferBaseProviderDebitCents).toBe(299);expect(dispatchMocks.transferCreate).toHaveBeenCalledWith(expect.objectContaining({amount:602,destination:'acct_original',source_transaction:'ch_owned'}),{idempotencyKey:'recurring_transfer_charge'});});
 it.each(['claim','refund','hold'])('blocks new transfer for unresolved %s',async kind=>{financialFixture();if(kind==='claim')dispatchMocks.tx.serviceQualityClaim.findFirst.mockResolvedValue({id:'claim'});if(kind==='refund')dispatchMocks.tx.recurringChargeRefund.findFirst.mockResolvedValue({id:'refund'});if(kind==='hold')durable.reconciliationHoldReason='unknown_adjustment';await expect(transferRecurringCharge('charge')).rejects.toThrow();expect(dispatchMocks.transferCreate).not.toHaveBeenCalled();});
 it('preserves original provider account rather than retargeting payout',async()=>{financialFixture();dispatchMocks.tx.providerProfile.findUnique.mockResolvedValue({accountStatus:'active',stripeTestPayoutStatus:'active',stripeTestAccountId:'acct_replacement'});await expect(transferRecurringCharge('charge')).rejects.toThrow('Original provider payout account');expect(dispatchMocks.transferCreate).not.toHaveBeenCalled();});
 it('post-transfer reservation assigns only incremental cumulative provider reversal',async()=>{financialFixture(333);durable.stripeTransferId='tr_owned';expect(await requestRecurringRefund('owner','visit',{id:'next',amountCents:333,reason:'service_quality'})).toMatchObject({providerReversalCents:300,providerDebitCents:300,hoaDebitCents:17});});
});
it('settles only incremental post-transfer reversal and replay does not debit twice',async()=>{
 financialFixture(333);Object.assign(durable,{status:'partially_refunded',stripeTransferId:'tr_owned',transferAmountCents:901,providerReversedCents:299});Object.assign(operation,{previousLineRefundCents:333,providerDebitCents:300,hoaDebitCents:17,providerReversalCents:300});
 dispatchMocks.transferRetrieve.mockImplementation(async()=>({id:'tr_owned',livemode:false,amount:901,currency:'usd',destination:'acct_original',source_transaction:'ch_owned',metadata:{bundleenRecurringChargeId:'charge'},amount_reversed:durable.providerReversedCents}));
 dispatchMocks.reversalCreate.mockResolvedValue({id:'trr_owned',amount:300,currency:'usd',transfer:'tr_owned',metadata:{bundleenRecurringRefundId:'refund'}});
 await processRecurringRefund('refund');expect(operation.status).toBe('succeeded');expect(financialLine.refundedCents).toBe(666);expect(durable.providerReversedCents).toBe(599);
 expect(dispatchMocks.reversalCreate).toHaveBeenCalledWith('tr_owned',{amount:300,metadata:{bundleenRecurringRefundId:'refund'}},{idempotencyKey:'recurring_reversal_refund'});
 await processRecurringRefund('refund');expect(dispatchMocks.refundCreate).toHaveBeenCalledTimes(1);expect(dispatchMocks.reversalCreate).toHaveBeenCalledTimes(1);expect(durable.providerReversedCents).toBe(599);
});

import { getRecurringRecovery, startRecurringRecoveryCard, retryRecurringPayment } from '@/lib/server/recurring-payment-recovery';
import { createHash } from 'node:crypto';
const recoveryTerms=()=>createHash('sha256').update(JSON.stringify(['recurring-recovery-exact-v1','charge','original','cus_original',1001,'usd'])).digest('hex');
let setupReservation:any;
const setupRemote=()=>({id:'seti_recovery',usage:'off_session',livemode:false,customer:'cus_original',client_secret:'synthetic_setup_secret',metadata:{bundleenRecurringSetupId:'setup-reservation',bundleenRecurringChargeId:'charge',bundleenRecoveryTerms:recoveryTerms(),bundleenRecoverySequence:'1'}});
function recoveryFixture(){
 setupReservation={id:'setup-reservation',chargeId:'charge',sequence:1,payerUserId:'original',customerId:'cus_original',termsToken:recoveryTerms(),attemptedAt:new Date(),setupIntentId:null};
 dispatchMocks.tx.recurringRecoverySetup.findUnique.mockImplementation(async()=>({...setupReservation}));
 dispatchMocks.tx.recurringRecoverySetup.create.mockImplementation(async()=>({...setupReservation}));
 dispatchMocks.tx.recurringRecoverySetup.update.mockImplementation(async({data}:any)=>Object.assign(setupReservation,data));
 dispatchMocks.tx.recurringChargeRecovery.findFirst.mockResolvedValue(null);
 dispatchMocks.setupList.mockResolvedValue({data:[],has_more:false});
 durable.payerUserId='original';durable.stripePaymentIntentId='pi_owned';
 dispatchMocks.tx.user.findUnique.mockResolvedValue({id:'original',isVerified:true});
 dispatchMocks.setupCreate.mockImplementation(async()=>setupRemote());
 dispatchMocks.setupRetrieve.mockResolvedValue({id:'seti_recovery',livemode:false,status:'succeeded',usage:'off_session',customer:'cus_original',metadata:{bundleenRecurringSetupId:'setup-reservation',bundleenRecurringChargeId:'charge',bundleenRecoveryTerms:recoveryTerms(),bundleenRecoverySequence:'1'},payment_method:{id:'pm_new',customer:'cus_original',type:'card',livemode:false}});
 dispatchMocks.retrieve.mockResolvedValue(remote('requires_payment_method',{payment_method:null}));
 dispatchMocks.tx.recurringChargeRecovery.findUnique.mockResolvedValue(null);
 dispatchMocks.tx.recurringChargeRecovery.create.mockImplementation(async({data}:any)=>{const a={id:'attempt',acceptedAt:new Date(),...data};dispatchMocks.tx.recurringChargeRecovery.findMany.mockResolvedValue([a]);return a;});
}
describe('independent original-payer recurring recovery',()=>{
 it('denies a new occupant without retrieving the intent or exposing a secret',async()=>{recoveryFixture();await expect(getRecurringRecovery('occupant','charge')).rejects.toThrow('Payment not found');expect(dispatchMocks.retrieve).not.toHaveBeenCalled();});
 it('denies unverified original payer',async()=>{recoveryFixture();dispatchMocks.tx.user.findUnique.mockResolvedValue({isVerified:false});await expect(getRecurringRecovery('original','charge')).rejects.toThrow('Payment not found');expect(dispatchMocks.retrieve).not.toHaveBeenCalled();});
 it('returns challenge secret only for original payer and only requires_action',async()=>{recoveryFixture();dispatchMocks.retrieve.mockResolvedValue(remote('requires_action',{client_secret:'synthetic_action_secret'}));expect((await getRecurringRecovery('original','charge')).clientSecret).toBe('synthetic_action_secret');dispatchMocks.retrieve.mockResolvedValue(remote('succeeded',{client_secret:'synthetic_action_secret'}));expect((await getRecurringRecovery('original','charge')).clientSecret).toBeNull();});
 it('withholds challenge secret on an existing reconciliation hold',async()=>{recoveryFixture();durable.reconciliationHoldReason='unknown_adjustment';dispatchMocks.retrieve.mockResolvedValue(remote('requires_action',{client_secret:'synthetic_action_secret'}));expect((await getRecurringRecovery('original','charge')).clientSecret).toBeNull();});
 it('rejects missing consent or changed exact amount terms before retrieving setup',async()=>{recoveryFixture();await expect(retryRecurringPayment('original','charge',{setupIntentId:'seti_recovery',accepted:false,termsToken:recoveryTerms()})).rejects.toThrow('Accept the exact');await expect(retryRecurringPayment('original','charge',{setupIntentId:'seti_recovery',accepted:true,termsToken:'foreign'})).rejects.toThrow('Accept the exact');expect(dispatchMocks.setupRetrieve).not.toHaveBeenCalled();});
 it('confirms the existing intent with an immutable replacement attempt and stable versioned key',async()=>{recoveryFixture();dispatchMocks.confirm.mockResolvedValue(remote('succeeded',{payment_method:'pm_new'}));const originalRetrieve=remote('requires_payment_method',{payment_method:null});dispatchMocks.retrieve.mockResolvedValueOnce(originalRetrieve).mockResolvedValueOnce(originalRetrieve).mockResolvedValue(remote('succeeded',{payment_method:'pm_new'}));await retryRecurringPayment('original','charge',{setupIntentId:'seti_recovery',accepted:true,termsToken:recoveryTerms()});expect(dispatchMocks.confirm).toHaveBeenCalledWith('pi_owned',{payment_method:'pm_new',off_session:true},{idempotencyKey:'recurring_recovery_confirm_attempt'});expect(dispatchMocks.create).not.toHaveBeenCalled();});
 it('does not release challenge secret if a hold appears during remote retrieval',async()=>{recoveryFixture();dispatchMocks.retrieve.mockImplementation(async()=>{durable.reconciliationHoldReason='new_hold';return remote('requires_action',{client_secret:'synthetic_action_secret'});});const response=await getRecurringRecovery('original','charge');expect(response.clientSecret).toBeNull();});
 it('does not release replacement setup secret after a concurrent hold',async()=>{recoveryFixture();dispatchMocks.setupCreate.mockImplementation(async()=>{durable.reconciliationHoldReason='new_hold';return setupRemote();});await expect(startRecurringRecoveryCard('original','charge')).rejects.toThrow('reconciliation');});
});
it('revoked payer verification during retrieval prevents challenge secret release',async()=>{recoveryFixture();dispatchMocks.retrieve.mockImplementation(async()=>{dispatchMocks.tx.user.findUnique.mockResolvedValue({id:'original',isVerified:false});return remote('requires_action',{client_secret:'synthetic_action_secret'});});await expect(getRecurringRecovery('original','charge')).rejects.toThrow();});
it('recovers lost setup response by exact reservation metadata without a second creation',async()=>{recoveryFixture();dispatchMocks.setupCreate.mockRejectedValueOnce(new Error('lost setup response'));await expect(startRecurringRecoveryCard('original','charge')).rejects.toThrow('lost setup response');const first=setupReservation.attemptedAt;dispatchMocks.setupList.mockResolvedValue({data:[setupRemote()],has_more:false});expect((await startRecurringRecoveryCard('original','charge')).clientSecret).toBe('synthetic_setup_secret');expect(dispatchMocks.setupCreate).toHaveBeenCalledTimes(1);expect(setupReservation.attemptedAt).toBe(first);expect(setupReservation.setupIntentId).toBe('seti_recovery');});
it('uncertain setup beyond23hours cannot create another authorization',async()=>{recoveryFixture();setupReservation.attemptedAt=new Date(Date.now()-24*60*60*1000);await expect(startRecurringRecoveryCard('original','charge')).rejects.toThrow('requires reconciliation');expect(dispatchMocks.setupCreate).not.toHaveBeenCalled();});
it('same setup reservation retries use identical processor arguments and idempotency key',async()=>{recoveryFixture();dispatchMocks.setupCreate.mockRejectedValueOnce(new Error('lost setup response'));await expect(startRecurringRecoveryCard('original','charge')).rejects.toThrow();await startRecurringRecoveryCard('original','charge');expect(dispatchMocks.setupCreate.mock.calls[0]).toEqual(dispatchMocks.setupCreate.mock.calls[1]);expect(dispatchMocks.setupCreate.mock.calls[1][1]).toEqual({idempotencyKey:'recurring_recovery_setup_setup-reservation'});});
it('ambiguous remote setup matches cannot release a secret or create a third setup',async()=>{recoveryFixture();dispatchMocks.setupList.mockResolvedValue({data:[setupRemote(),{...setupRemote(),id:'seti_second'}],has_more:false});await expect(startRecurringRecoveryCard('original','charge')).rejects.toThrow('requires reconciliation');expect(dispatchMocks.setupCreate).not.toHaveBeenCalled();});
it('stale setup sequence after remote creation cannot release its secret',async()=>{recoveryFixture();dispatchMocks.setupCreate.mockImplementation(async()=>{dispatchMocks.tx.recurringChargeRecovery.findFirst.mockResolvedValue({sequence:1});return setupRemote();});await expect(startRecurringRecoveryCard('original','charge')).rejects.toThrow('stale');});
it.each([{chargeId:'foreign'},{sequence:2},{id:'foreign-reservation'}])('rejects foreign or stale setup reservation on retry %j',async change=>{recoveryFixture();Object.assign(setupReservation,change);await expect(retryRecurringPayment('original','charge',{setupIntentId:'seti_recovery',accepted:true,termsToken:recoveryTerms()})).rejects.toThrow('reservation mismatch');expect(dispatchMocks.confirm).not.toHaveBeenCalled();});
it.each(['refunded','partially_refunded','disputed'])('recovery reports effective local %s rather than raw succeeded PI',async status=>{recoveryFixture();durable.status=status;durable.refundedCents=status==='refunded'?1001:status==='partially_refunded'?333:0;dispatchMocks.retrieve.mockResolvedValue(remote('succeeded'));expect((await getRecurringRecovery('original','charge')).status).toBe(status);});
it('recovery reports reconciliation hold instead of a misleading paid state',async()=>{recoveryFixture();durable.reconciliationHoldReason='unknown_adjustment';dispatchMocks.retrieve.mockResolvedValue(remote('succeeded'));expect((await getRecurringRecovery('original','charge')).status).toBe('billing_review');});
it('already-paid charge cannot create replacement card setup despite stale requires_payment_method',async()=>{recoveryFixture();durable.paidAt=new Date();durable.status='succeeded';await expect(startRecurringRecoveryCard('original','charge')).rejects.toThrow();expect(dispatchMocks.setupCreate).not.toHaveBeenCalled();});
it('setup secret is withheld when original intent succeeds during setup creation',async()=>{recoveryFixture();dispatchMocks.setupCreate.mockImplementation(async()=>{dispatchMocks.retrieve.mockResolvedValue(remote('succeeded'));return setupRemote();});await expect(startRecurringRecoveryCard('original','charge')).rejects.toThrow();});
it.each([{usage:'on_session'},{metadata:{bundleenRecurringSetupId:'setup-reservation',bundleenRecurringChargeId:'charge',bundleenRecoveryTerms:recoveryTerms(),bundleenRecoverySequence:'2'}}])('setup secret rejects inappropriate usage or sequence %j',async change=>{recoveryFixture();dispatchMocks.setupCreate.mockResolvedValue({...setupRemote(),...change});await expect(startRecurringRecoveryCard('original','charge')).rejects.toThrow();});
describe('independent original-payer receipt authority',()=>{
 function receiptFixture(){recoveryFixture();durable.stripeChargeId='ch_owned';dispatchMocks.chargeRetrieve.mockResolvedValue({id:'ch_owned',livemode:false,paid:true,payment_intent:'pi_owned',customer:'cus_original',amount:1001,currency:'usd',receipt_url:'https://pay.stripe.com/receipts/synthetic'});}
 it('returns only the verified processor-hosted receipt to original payer',async()=>{receiptFixture();expect(await getRecurringReceipt('original','charge')).toBe('https://pay.stripe.com/receipts/synthetic');});
 it('foreign occupant cannot retrieve the processor receipt',async()=>{receiptFixture();await expect(getRecurringReceipt('occupant','charge')).rejects.toThrow('Receipt not found');expect(dispatchMocks.chargeRetrieve).not.toHaveBeenCalled();});
 it.each([{id:'ch_foreign'},{livemode:true},{paid:false},{payment_intent:'pi_foreign'},{customer:'cus_foreign'},{amount:1002},{currency:'eur'}])('rejects authoritative receipt mismatch %j',async change=>{receiptFixture();const current=await dispatchMocks.chargeRetrieve();dispatchMocks.chargeRetrieve.mockResolvedValue({...current,...change});await expect(getRecurringReceipt('original','charge')).rejects.toThrow('billing review');});
 it.each(['http://pay.stripe.com/receipts/x','https://pay.stripe.com.evil.test/receipts/x','https://user@pay.stripe.com/receipts/x','https://pay.stripe.com:8443/receipts/x','https://pay.stripe.com/elsewhere'])('rejects unsafe receipt URL %s',async url=>{receiptFixture();const current=await dispatchMocks.chargeRetrieve();dispatchMocks.chargeRetrieve.mockResolvedValue({...current,receipt_url:url});await expect(getRecurringReceipt('original','charge')).rejects.toThrow('unavailable');});
 it('revoked verification during processor fetch prevents receipt release',async()=>{receiptFixture();const current=await dispatchMocks.chargeRetrieve();dispatchMocks.chargeRetrieve.mockImplementation(async()=>{dispatchMocks.tx.user.findUnique.mockResolvedValue({isVerified:false});return current;});await expect(getRecurringReceipt('original','charge')).rejects.toThrow('Receipt not found');});
});
