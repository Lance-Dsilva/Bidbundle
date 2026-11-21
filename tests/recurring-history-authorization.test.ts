import {beforeEach, afterEach, expect, it, vi} from 'vitest';
const db=vi.hoisted(()=>({user:{findUnique:vi.fn()},recurringPlan:{findUnique:vi.fn()},recurringSubscription:{findFirst:vi.fn()},recurringCharge:{findMany:vi.fn()},recurringChargeLine:{findMany:vi.fn()}}));
vi.mock('@/lib/server/db',()=>({db}));
vi.mock('@/lib/server/hoa',()=>({HoaWorkflowError:class extends Error {constructor(message:string,public status:number){super(message);}}}));
import {getRecurringPaymentHistory} from '@/lib/server/recurring-payments';
const charge={id:'charge',planId:'plan',monthlyBillId:'bill',localMonth:'2026-11',status:'partially_refunded',amountCents:1001,currency:'usd',refundedCents:1000,stripeChargeId:'ch_private',customerId:'cus_private',paymentMethodId:'pm_private',providerAccountId:'acct_private',receiptEmail:'private@example.test',reconciliationHoldReason:'private_processor_reason'};
beforeEach(()=>{
 vi.clearAllMocks();
 for(const name of ['RECURRING_PLANS','RECURRING_TEST_PAYMENTS','STRIPE_TEST_PAYMENTS'])vi.stubEnv(name,'1');
 db.user.findUnique.mockResolvedValue({id:'payer',role:'homeowner',isVerified:true});
 db.recurringPlan.findUnique.mockResolvedValue({id:'plan',providerUserId:'provider'});
 db.recurringSubscription.findFirst.mockResolvedValue({id:'old-subscription',status:'cancelled'});
 db.recurringCharge.findMany.mockResolvedValue([charge]);
 db.recurringChargeLine.findMany.mockResolvedValue([{visitId:'visit',localDate:'2026-11-05',grossCents:1001,feeCents:100,providerCents:901,hoaCents:50,refundedCents:1000}]);
});
afterEach(()=>vi.unstubAllEnvs());
it('rejects unverified actors before querying payment records',async()=>{
 db.user.findUnique.mockResolvedValue({isVerified:false});
 await expect(getRecurringPaymentHistory('payer','plan')).rejects.toMatchObject({status:403});
 expect(db.recurringCharge.findMany).not.toHaveBeenCalled();
});
it('rejects a new occupant or manager without original payer ownership',async()=>{
 db.recurringSubscription.findFirst.mockResolvedValue(null);
 await expect(getRecurringPaymentHistory('other','plan')).rejects.toMatchObject({status:404});
 expect(db.recurringSubscription.findFirst).toHaveBeenCalledWith({where:{planId:'plan',payerUserId:'other'}});
 expect(db.recurringCharge.findMany).not.toHaveBeenCalled();
});
it('keeps historical payments accessible to the original payer after cancellation and projects no processor secrets',async()=>{
 const rows=await getRecurringPaymentHistory('payer','plan');
 expect(db.recurringCharge.findMany.mock.calls[0][0].where).toEqual({planId:'plan',payerUserId:'payer'});
 expect(rows[0]).toMatchObject({amountCents:1001,refundedCents:1000,providerNetCents:null,holdReason:'billing_review',canRecover:false});
 for(const secret of ['cus_private','pm_private','acct_private','ch_private','private@example.test','private_processor_reason'])expect(JSON.stringify(rows)).not.toContain(secret);
});
it('limits provider history to their own charges and computes net entitlement after settled refunds',async()=>{
 db.user.findUnique.mockResolvedValue({id:'provider',role:'provider',isVerified:true});
 const rows=await getRecurringPaymentHistory('provider','plan');
 expect(db.recurringCharge.findMany.mock.calls[0][0].where).toEqual({planId:'plan',providerUserId:'provider'});
 expect(rows[0].providerNetCents).toBe(1);
});
it('does not query financial records while the adapter is disabled',async()=>{
 vi.stubEnv('RECURRING_TEST_PAYMENTS','0');
 await expect(getRecurringPaymentHistory('payer','plan')).rejects.toMatchObject({status:503});
 expect(db.recurringCharge.findMany).not.toHaveBeenCalled();
});
it.each(['failed','requires_action'])('grants recovery only for the original unpaid payer in %s',async status=>{
 db.recurringCharge.findMany.mockResolvedValue([{...charge,payerUserId:'payer',status,paidAt:null,refundedCents:0,reconciliationHoldReason:null}]);
 expect((await getRecurringPaymentHistory('payer','plan'))[0].canRecover).toBe(true);
});
it.each([{paidAt:new Date()},{refundedCents:1},{reconciliationHoldReason:'unknown_refund'},{status:'succeeded'},{status:'processing'},{status:'disputed'}])('suppresses recovery for ineligible financial state %j',async override=>{
 db.recurringCharge.findMany.mockResolvedValue([{...charge,payerUserId:'payer',status:'failed',paidAt:null,refundedCents:0,reconciliationHoldReason:null,...override}]);
 expect((await getRecurringPaymentHistory('payer','plan'))[0].canRecover).toBe(false);
});
it('does not give the awarded provider payer recovery or receipts',async()=>{
 db.user.findUnique.mockResolvedValue({id:'provider',role:'provider',isVerified:true});
 db.recurringCharge.findMany.mockResolvedValue([{...charge,payerUserId:'payer',status:'failed',paidAt:null,refundedCents:0,reconciliationHoldReason:null}]);
 const row=(await getRecurringPaymentHistory('provider','plan'))[0];
 expect(row.canRecover).toBe(false);expect(row.receiptAvailable).toBe(false);
});
