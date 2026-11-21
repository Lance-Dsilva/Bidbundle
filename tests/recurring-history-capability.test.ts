import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const tx=vi.hoisted(()=>({$queryRaw:vi.fn(),user:{findUnique:vi.fn()},recurringPlan:{findUnique:vi.fn(),findUniqueOrThrow:vi.fn()},communityStaffAssignment:{findFirst:vi.fn()},communityMembership:{findFirst:vi.fn()},recurringSubscription:{findMany:vi.fn(),findFirst:vi.fn(),count:vi.fn()}}));
vi.mock('@/lib/server/db',()=>({db:{$transaction:(fn:(t:typeof tx)=>unknown)=>fn(tx)}}));
vi.mock('@/lib/server/hoa',()=>({HoaWorkflowError:class extends Error {constructor(message:string,public status:number){super(message);}}}));
vi.mock('@/lib/server/stripe-test-refunds',()=>({requireStripeRefundOwner:vi.fn()}));
import {getRecurringPlanView} from '@/lib/server/recurring-plans';
const plan={id:'plan',agreementId:'agreement',communityId:'community',providerUserId:'awarded',status:'active'};
beforeEach(()=>{
 vi.clearAllMocks();vi.stubEnv('RECURRING_PLANS','1');
 tx.$queryRaw.mockResolvedValue([]);tx.recurringPlan.findUnique.mockResolvedValue(plan);tx.recurringPlan.findUniqueOrThrow.mockResolvedValue(plan);
 tx.user.findUnique.mockResolvedValue({role:'hoa_staff',isVerified:true});tx.communityStaffAssignment.findFirst.mockResolvedValue({role:'hoa_manager'});
 tx.communityMembership.findFirst.mockResolvedValue(null);tx.recurringSubscription.findFirst.mockResolvedValue(null);tx.recurringSubscription.count.mockResolvedValue(7);
 tx.recurringSubscription.findMany.mockImplementation(({where})=>Promise.resolve(where.payerUserId?[]:[{id:'other',payerUserId:'other',status:'active'}]));
});
afterEach(()=>vi.unstubAllEnvs());
it('does not treat manager-visible subscriptions as personal payment ownership',async()=>{
 const view=await getRecurringPlanView('manager','plan');
 expect(view.subscriptions).toHaveLength(1);expect(view.canManage).toBe(true);expect(view.canViewPaymentHistory).toBe(false);
});
it('retains original-payer history capability after subscription cancellation',async()=>{
 tx.user.findUnique.mockResolvedValue({role:'homeowner',isVerified:true});tx.communityStaffAssignment.findFirst.mockResolvedValue(null);
 tx.recurringSubscription.findMany.mockResolvedValue([{id:'old',payerUserId:'payer',status:'cancelled'}]);
 expect((await getRecurringPlanView('payer','plan')).canViewPaymentHistory).toBe(true);
});
it('allows only the awarded provider, not another provider who belongs to the community',async()=>{
 tx.user.findUnique.mockResolvedValue({role:'provider',isVerified:true});tx.communityStaffAssignment.findFirst.mockResolvedValue(null);tx.communityMembership.findFirst.mockResolvedValue({unitId:'unit'});tx.recurringSubscription.findMany.mockResolvedValue([]);
 expect((await getRecurringPlanView('awarded','plan')).canViewPaymentHistory).toBe(true);
 expect((await getRecurringPlanView('other-provider','plan')).canViewPaymentHistory).toBe(false);
});
