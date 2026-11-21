import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const m=vi.hoisted(()=>({client:vi.fn(),event:vi.fn(),refund:vi.fn(),operation:vi.fn(),owner:vi.fn(),owned:vi.fn(),snapshot:vi.fn(),charge:vi.fn(),process:vi.fn()}));
vi.mock('@/lib/server/db',()=>({db:{stripeTestEvent:{findUniqueOrThrow:m.event},recurringChargeRefund:{findUnique:m.operation},recurringCharge:{findUnique:m.owner,findUniqueOrThrow:m.owned}}}));
vi.mock('@/lib/server/hoa',()=>({HoaWorkflowError:class extends Error{constructor(message:string,public status:number){super(message);}}}));
vi.mock('@/lib/server/recurring-payments',()=>({lockRecurringCharge:vi.fn(),recordRecurringIntent:vi.fn(),recurringTestClient:m.client}));
vi.mock('@/lib/server/recurring-refunds',()=>({processRecurringRefund:m.process,recordRecurringRefundSnapshot:m.snapshot}));
import {reconcileRecurringFinancialEvent} from '@/lib/server/recurring-financial-events';
beforeEach(()=>{vi.resetAllMocks();for(const name of ['RECURRING_PLANS','RECURRING_TEST_PAYMENTS','STRIPE_TEST_PAYMENTS'])vi.stubEnv(name,'1');m.client.mockReturnValue({refunds:{retrieve:m.refund},charges:{retrieve:m.charge}});m.event.mockResolvedValue({id:'event',eventType:'refund.updated',objectId:'re_foreign',accountId:null,processedAt:null});m.refund.mockResolvedValue({id:'re_foreign',livemode:false,charge:'ch_foreign',payment_intent:'pi_foreign',amount:100,currency:'usd',metadata:{bundleenRecurringRefundId:'owned-operation'}});m.operation.mockResolvedValue({id:'owned-operation',chargeId:'owned-charge',amountCents:999,stripeRefundId:null,status:'pending'});m.owner.mockResolvedValue(null);m.owned.mockResolvedValue({id:'owned-charge',stripeChargeId:'ch_owned',stripePaymentIntentId:'pi_owned',currency:'usd'});m.charge.mockResolvedValue({id:'ch_foreign',payment_intent:'pi_foreign'});});
afterEach(()=>vi.unstubAllEnvs());
it('never dispatches an unrelated refund operation based only on incoming refund metadata',async()=>{
 await expect(reconcileRecurringFinancialEvent('event')).rejects.toMatchObject({status:409});
 expect(m.snapshot).not.toHaveBeenCalled();
 expect(m.process).not.toHaveBeenCalled();
});
it('does not retry financial mutations for an already processed webhook',async()=>{
 m.event.mockResolvedValue({id:'event',eventType:'refund.updated',objectId:'re_foreign',accountId:null,processedAt:new Date()});
 await reconcileRecurringFinancialEvent('event');
 expect(m.process).not.toHaveBeenCalled();
});

it.each(['RECURRING_PLANS','RECURRING_TEST_PAYMENTS','STRIPE_TEST_PAYMENTS'])('does not intercept finite events with %s disabled',async flag=>{
 vi.stubEnv(flag,'0');
 expect(await reconcileRecurringFinancialEvent('finite-event')).toBe(false);
 expect(m.client).not.toHaveBeenCalled();
 expect(m.event).not.toHaveBeenCalled();
});
