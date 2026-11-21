import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => {
 const table=()=>({findUnique:vi.fn(),findUniqueOrThrow:vi.fn(),findFirst:vi.fn(),findMany:vi.fn(),create:vi.fn(),update:vi.fn(),updateMany:vi.fn()});
 const tx:any={$queryRaw:vi.fn(),recurringPlan:table(),recurringSubscription:table(),user:table(),communityMembership:table(),community:table(),serviceVisit:table(),adminAuditLog:table(),recurringMonthlyBill:table(),recurringBillLine:table()};
 return {tx,db:{$transaction:vi.fn(),recurringSubscription:tx.recurringSubscription},retrieve:vi.fn()};
});
vi.mock('server-only',()=>({}));
vi.mock('@/lib/server/db',()=>({db:mocks.db}));
vi.mock('@/lib/server/stripe-test-refunds',()=>({requireStripeRefundOwner:vi.fn()}));
vi.mock('stripe',()=>({default:class {setupIntents={retrieve:mocks.retrieve};}}));
import { confirmRecurringSubscription, requestRecurringStop, sealRecurringMonth } from '@/lib/server/recurring-plans';
const plan={id:'plan',agreementId:'agreement',providerUserId:'provider',communityId:'community',status:'active',acceptedAt:new Date(),timezone:'America/Chicago',billingMode:'monthly',currency:'usd'};
const sub={id:'sub',planId:'plan',payerUserId:'original',unitId:'unit',status:'active',monthlyCapCents:10001,startDate:'2026-01-01',stopKind:null};
beforeEach(()=>{vi.clearAllMocks();vi.stubEnv('RECURRING_PLANS','1');vi.stubEnv('STRIPE_TEST_PAYMENTS','1');vi.stubEnv('STRIPE_SECRET_KEY','sk_test_fake');mocks.db.$transaction.mockImplementation((fn:any)=>fn(mocks.tx));mocks.tx.recurringPlan.findUnique.mockResolvedValue(plan);mocks.tx.recurringPlan.findUniqueOrThrow.mockResolvedValue(plan);mocks.tx.recurringSubscription.findUnique.mockResolvedValue(sub);mocks.tx.recurringSubscription.findUniqueOrThrow.mockResolvedValue(sub);mocks.tx.serviceVisit.findMany.mockResolvedValue([]);mocks.tx.recurringSubscription.update.mockImplementation(({data}:any)=>({...sub,...data}));});
describe('independent recurring consent and billing boundaries',()=>{
 it('rejects another occupant before retrieving any saved card',async()=>{await expect(confirmRecurringSubscription('new-occupant','plan','sub','seti')).rejects.toThrow('Enrollment not found');expect(mocks.retrieve).not.toHaveBeenCalled();});
 it.each([
 ['finite consent', {metadata:{bundleenVisitId:'visit'}}],
 ['another subscription',{metadata:{bundleenRecurringSubscriptionId:'other',bundleenTermsToken:'terms'}}],
 ['live card',{livemode:true}],
 ['incomplete challenge',{status:'requires_action'}],
 ['on-session authorization',{usage:'on_session'}],
 ['foreign customer',{customer:'cus_other'}],
 ])('rejects %s without activating enrollment',async(_name,change)=>{mocks.tx.recurringSubscription.findUnique.mockResolvedValue({...sub,status:'pending',termsToken:'terms'});mocks.retrieve.mockResolvedValue({livemode:false,status:'succeeded',usage:'off_session',customer:'cus',metadata:{bundleenRecurringSubscriptionId:'sub',bundleenTermsToken:'terms'},payment_method:{id:'pm',type:'card',livemode:false,customer:'cus',card:{}},...change});await expect(confirmRecurringSubscription('original','plan','sub','seti')).rejects.toThrow('verified recurring sandbox card');expect(mocks.tx.recurringSubscription.update).not.toHaveBeenCalled();});
 it('preserves original-payer cancellation rights after moving out',async()=>{await requestRecurringStop('original','sub','cancel');expect(mocks.tx.communityMembership.findFirst).not.toHaveBeenCalled();expect(mocks.tx.recurringSubscription.update).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({stopKind:'cancel'})}));});
 it('does not let new occupant cancel original payer subscription',async()=>{await expect(requestRecurringStop('new-occupant','sub','pause')).rejects.toThrow('Subscription not found');expect(mocks.tx.recurringSubscription.update).not.toHaveBeenCalled();});
 it('repeated identical notice preserves its original effective date',async()=>{mocks.tx.recurringSubscription.findUniqueOrThrow.mockResolvedValue({...sub,stopKind:'pause',stopEffectiveDate:'2026-12-21'});const result=await requestRecurringStop('original','sub','pause');expect(result.stopEffectiveDate).toBe('2026-12-21');expect(mocks.tx.recurringSubscription.update).not.toHaveBeenCalled();await expect(requestRecurringStop('original','sub','cancel')).rejects.toThrow('notice is already recorded');});
 it('rejects unresolved past-month visits rather than silently skipping their charges',async()=>{mocks.tx.recurringMonthlyBill.findUnique.mockResolvedValue(null);mocks.tx.serviceVisit.findMany.mockResolvedValue([{status:'scheduled',allocatedVisitCents:2000}]);await expect(sealRecurringMonth('plan','sub','2025-01')).rejects.toThrow('Resolve every service visit');expect(mocks.tx.recurringMonthlyBill.create).not.toHaveBeenCalled();});
 it('seals only completed allocations without reallocating skipped cents',async()=>{mocks.tx.recurringMonthlyBill.findUnique.mockResolvedValue(null);mocks.tx.serviceVisit.findMany.mockResolvedValue([{id:'a',status:'completed',allocatedVisitCents:2001,completedAt:new Date()},{id:'b',status:'skipped',allocatedVisitCents:2000,completedAt:null}]);mocks.tx.recurringMonthlyBill.create.mockImplementation(({data}:any)=>data);const bill=await sealRecurringMonth('plan','sub','2025-01');expect(bill.amountCents).toBe(2001);expect(mocks.tx.recurringBillLine.create).toHaveBeenCalledWith({data:expect.objectContaining({visitId:'b',allocatedCents:2000,amountCents:0})});});
 it('different plans for the same unit/month get distinct monthly identities',async()=>{mocks.tx.recurringMonthlyBill.findUnique.mockResolvedValue(null);mocks.tx.serviceVisit.findMany.mockResolvedValue([]);mocks.tx.recurringMonthlyBill.create.mockImplementation(({data}:any)=>data);const a=await sealRecurringMonth('plan','sub','2025-01');mocks.tx.recurringPlan.findUniqueOrThrow.mockResolvedValue({...plan,id:'other-plan'});mocks.tx.recurringSubscription.findUnique.mockResolvedValue({...sub,planId:'other-plan'});const b=await sealRecurringMonth('other-plan','sub','2025-01');expect(a.id).not.toBe(b.id);});
 it('does not create a second bill or constituent ledger on an identical worker retry',async()=>{const existing={id:'durable-bill',amountCents:2001};mocks.tx.recurringMonthlyBill.findUnique.mockResolvedValue(existing);expect(await sealRecurringMonth('plan','sub','2025-01')).toBe(existing);expect(mocks.tx.recurringMonthlyBill.create).not.toHaveBeenCalled();expect(mocks.tx.recurringBillLine.create).not.toHaveBeenCalled();});

});
