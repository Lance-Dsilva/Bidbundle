import { afterEach, beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ payment: {} as Record<string, any>, op: {} as Record<string, any>, remote: null as any,
  owner: vi.fn(), tx: vi.fn(), charge: vi.fn(), refundList: vi.fn(), refundCreate: vi.fn(), refundGet: vi.fn(), transferGet: vi.fn(), reverseList: vi.fn(), reverseCreate: vi.fn(), reverseGet: vi.fn(), audit: vi.fn(), writes: [] as string[] }));
vi.mock("stripe", () => ({ default: class { charges={retrieve:m.charge}; refunds={list:m.refundList,create:m.refundCreate,retrieve:m.refundGet}; transfers={retrieve:m.transferGet,listReversals:m.reverseList,createReversal:m.reverseCreate,retrieveReversal:m.reverseGet}; } }));
vi.mock("@/lib/server/db", () => {
  const tx = { $queryRaw: vi.fn(), user:{findUnique:m.owner}, adminAuditLog:{create:m.audit},
    stripeTestPayment:{findUnique:async()=>structuredClone(m.payment),findUniqueOrThrow:async()=>structuredClone(m.payment),update:async({data}:any)=>{Object.assign(m.payment,data);return structuredClone(m.payment);}},
    stripeTestRefund:{findUnique:async()=>m.op.id?structuredClone(m.op):null,findUniqueOrThrow:async()=>structuredClone(m.op),
      findFirst:async()=>m.op.id&&!['succeeded','failed'].includes(m.op.state)?structuredClone(m.op):null,
      findMany:async()=>[],create:async({data}:any)=>{m.op={...data,state:'pending'};return structuredClone(m.op);},
      update:async({data}:any)=>{Object.assign(m.op,data);return structuredClone(m.op);},
      updateMany:async({data}:any)=>{m.writes.push('attempt');for(const [key,value]of Object.entries(data))if(m.op[key]==null)m.op[key]=value;return{count:1};}},
  };
  return{db:{...tx,$transaction:(fn:any)=>m.tx.mock.calls.length>=0?m.tx(fn,tx):fn(tx)}};
});
import { processStripeTestRefund, requestStripeTestRefund } from "@/lib/server/stripe-test-refunds";
const refund = () => ({id:'re_1',amount:100,currency:'usd',charge:'ch_1',payment_intent:'pi_1',metadata:{bundleenRefundId:'refund1'},status:'succeeded'});
beforeEach(()=>{
  vi.resetAllMocks();vi.stubEnv('STRIPE_TEST_REFUNDS','1');vi.stubEnv('STRIPE_SECRET_KEY','sk_test_fixture');m.writes=[];
  m.payment={visitId:'visit',communityId:'community',providerUserId:'provider',residentUserId:'payer',amountCents:1000,amountRefundedCents:0,providerAmountCents:900,providerReversedCents:0,currency:'usd',customerId:'cus_1',providerAccountId:'acct_1',stripeChargeId:'ch_1',stripePaymentIntentId:'pi_1',stripeTransferId:'tr_1',status:'succeeded'};
  m.op={id:'refund1',visitId:'visit',actorUserId:'admin',reason:'requested_by_customer',amountCents:100,refundedBeforeCents:0,cumulativeRefundCents:100,reversedBeforeCents:0,reversalCents:90,chargeId:'ch_1',transferId:'tr_1',state:'pending',stripeRefundId:null,stripeReversalId:null,refundAttemptedAt:null,reversalAttemptedAt:null};
  m.remote=null;m.tx.mockImplementation((fn,tx)=>fn(tx));
  m.owner.mockResolvedValue({role:'admin',isVerified:true,email:'owner@example.invalid',adminAccess:{status:'active',level:'owner',isStaffAccount:false,email:'owner@example.invalid'}});
  m.charge.mockResolvedValue({livemode:false,paid:true,disputed:false,amount:1000,amount_captured:1000,amount_refunded:0,currency:'usd',customer:'cus_1',payment_intent:'pi_1'});
  m.refundList.mockImplementation(async()=>({data:m.remote?[m.remote]:[],has_more:false}));
  m.refundCreate.mockImplementation(async()=>{m.writes.push('refund');m.remote=refund();return m.remote;});m.refundGet.mockImplementation(async()=>m.remote??refund());
  m.transferGet.mockResolvedValue({livemode:false,amount:900,currency:'usd',destination:'acct_1',source_transaction:'ch_1',amount_reversed:0});
  m.reverseList.mockResolvedValue({data:[],has_more:false});m.reverseCreate.mockImplementation(async()=>{m.writes.push('reverse');return{id:'trr_1',amount:90,currency:'usd',transfer:'tr_1',metadata:{bundleenRefundId:'refund1'}};});
});
afterEach(()=>vi.unstubAllEnvs());
it('records refund and proportional reversal separately with stable identities',async()=>{
  expect((await processStripeTestRefund('refund1')).state).toBe('succeeded');
  expect(m.payment).toMatchObject({amountRefundedCents:100,providerReversedCents:90,status:'partially_refunded'});
  expect(m.writes).toEqual(['attempt','refund','attempt','reverse']);
  expect(m.refundCreate).toHaveBeenCalledWith(expect.objectContaining({charge:'ch_1',amount:100}),{idempotencyKey:'refund_refund1'});
  expect(m.reverseCreate).toHaveBeenCalledWith('tr_1',expect.objectContaining({amount:90}),{idempotencyKey:'reverse_refund_refund1'});
  await processStripeTestRefund('refund1');expect(m.refundCreate).toHaveBeenCalledTimes(1);expect(m.reverseCreate).toHaveBeenCalledTimes(1);
});
it('preserves successful resident refund when reversal fails and retries only reversal',async()=>{
  m.reverseCreate.mockRejectedValueOnce(new Error('offline'));
  await expect(processStripeTestRefund('refund1')).rejects.toThrow('offline');
  expect(m.op.state).toBe('reversal_pending');expect(m.payment.amountRefundedCents).toBe(100);
  await processStripeTestRefund('refund1');expect(m.refundCreate).toHaveBeenCalledTimes(1);expect(m.op.state).toBe('succeeded');
});
it('recovers remote refund success after local transaction failure',async()=>{
  m.tx.mockRejectedValueOnce(new Error('database unavailable'));
  await expect(processStripeTestRefund('refund1')).rejects.toThrow('database unavailable');
  expect(m.op.stripeRefundId).toBeNull();expect(m.op.refundAttemptedAt).toBeInstanceOf(Date);
  await processStripeTestRefund('refund1');expect(m.refundCreate).toHaveBeenCalledTimes(1);expect(m.op.state).toBe('succeeded');
});
it('pending refund neither increments paid refund totals nor reverses funds',async()=>{
  m.refundCreate.mockResolvedValue({...refund(),status:'pending'});
  await processStripeTestRefund('refund1');expect(m.op.state).toBe('refund_pending');expect(m.payment.amountRefundedCents).toBe(0);expect(m.reverseCreate).not.toHaveBeenCalled();
  m.refundGet.mockResolvedValue({...refund(),status:'failed'});await processStripeTestRefund('refund1');expect(m.op.state).toBe('failed');expect(m.payment.amountRefundedCents).toBe(0);
});
it('refund without an issued transfer completes without reversing',async()=>{
  m.op.transferId=null;m.op.reversalCents=0;m.payment.stripeTransferId=null;
  await processStripeTestRefund('refund1');expect(m.op.state).toBe('succeeded');expect(m.transferGet).not.toHaveBeenCalled();
});
it('old uncertain refund is not recreated after idempotency expiry',async()=>{
  m.op.refundAttemptedAt=new Date(Date.now()-24*3600000);
  await expect(processStripeTestRefund('refund1')).rejects.toMatchObject({status:409});expect(m.refundCreate).not.toHaveBeenCalled();
});
it('owned metadata recovers an old uncertain refund without recreating it',async()=>{
  m.op.refundAttemptedAt=new Date(Date.now()-24*3600000);m.remote=refund();await processStripeTestRefund('refund1');expect(m.refundCreate).not.toHaveBeenCalled();expect(m.op.state).toBe('succeeded');
});
it('unknown external refund or incomplete history stops new refund creation',async()=>{
  m.refundList.mockResolvedValue({data:[{...refund(),id:'re_external',status:'pending',metadata:{}}],has_more:false});
  await expect(processStripeTestRefund('refund1')).rejects.toMatchObject({status:409});expect(m.refundCreate).not.toHaveBeenCalled();
  m.refundList.mockResolvedValue({data:[],has_more:true});await expect(processStripeTestRefund('refund1')).rejects.toMatchObject({status:409});
});
it.each([{livemode:true},{disputed:true},{customer:'other'},{payment_intent:'other'},{amount:999}])('rejects foreign or disputed charge %j',async change=>{
  m.charge.mockResolvedValue({...await m.charge(),...change});await expect(processStripeTestRefund('refund1')).rejects.toMatchObject({status:409});expect(m.refundCreate).not.toHaveBeenCalled();
});
it('does not issue another reversal after its durable window',async()=>{
  m.op.reversalAttemptedAt=new Date(Date.now()-24*3600000);await expect(processStripeTestRefund('refund1')).rejects.toMatchObject({status:409});expect(m.payment.amountRefundedCents).toBe(100);expect(m.reverseCreate).not.toHaveBeenCalled();
});
it('recovers lost reversal response from owned metadata',async()=>{
  m.op.reversalAttemptedAt=new Date(Date.now()-24*3600000);m.reverseList.mockResolvedValue({data:[{id:'trr_1',amount:90,currency:'usd',transfer:'tr_1',metadata:{bundleenRefundId:'refund1'}}],has_more:false});
  await processStripeTestRefund('refund1');expect(m.reverseCreate).not.toHaveBeenCalled();expect(m.payment.providerReversedCents).toBe(90);
});
it('requires current primary admin identity before accepting an idempotent request',async()=>{
  m.owner.mockResolvedValue({role:'homeowner'});await expect(requestStripeTestRefund('admin','visit',{id:'refund1',amountCents:100,reason:'requested_by_customer'})).rejects.toMatchObject({status:403});
});
it('same request is idempotent but changed amount cannot reuse its identity',async()=>{
  await expect(requestStripeTestRefund('admin','visit',{id:'refund1',amountCents:100,reason:'requested_by_customer'})).resolves.toMatchObject({id:'refund1'});
  await expect(requestStripeTestRefund('admin','visit',{id:'refund1',amountCents:101,reason:'requested_by_customer'})).rejects.toMatchObject({status:409});
});
it('rejects over-refunds before writing an operation',async()=>{
  m.op={};await expect(requestStripeTestRefund('admin','visit',{id:'new',amountCents:1001,reason:'requested_by_customer'})).rejects.toMatchObject({status:409});expect(m.audit).not.toHaveBeenCalled();
});
it('reserves refund and audit atomically without a remote mutation',async()=>{
  m.op={};await requestStripeTestRefund('admin','visit',{id:'new',amountCents:100,reason:'service_quality'});
  expect(m.op).toMatchObject({amountCents:100,reversalCents:90,cumulativeRefundCents:100});expect(m.audit).toHaveBeenCalledTimes(1);expect(m.refundCreate).not.toHaveBeenCalled();
});
it.each(['sk_live_fixture',''])('fails closed for non-test keys %s',async key=>{
  vi.stubEnv('STRIPE_SECRET_KEY',key);await expect(processStripeTestRefund('refund1')).rejects.toMatchObject({status:503});expect(m.charge).not.toHaveBeenCalled();
});
