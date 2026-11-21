// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {cleanup,render,screen} from '@testing-library/react';
const history=vi.hoisted(()=>vi.fn());
vi.mock('@/lib/server/recurring-payments',()=>({getRecurringPaymentHistory:history}));
vi.mock('@/lib/server/hoa',()=>({HoaWorkflowError:class extends Error {constructor(message:string,public status:number){super(message);}}}));
import {HoaWorkflowError} from '@/lib/server/hoa';
import {RecurringPaymentHistorySection} from '@/components/recurring-plans/RecurringPaymentHistorySection';
afterEach(cleanup);beforeEach(()=>vi.clearAllMocks());
it('uses server actor and plan to load authorized history',async()=>{
 history.mockResolvedValue([]);
 render(await RecurringPaymentHistorySection({actorId:'original-payer',planId:'plan'}));
 expect(history).toHaveBeenCalledWith('original-payer','plan');
 expect(screen.getByText(/No recurring payments yet/)).toBeTruthy();
});
it('distinguishes a retrieval failure from empty history without exposing details',async()=>{
 history.mockRejectedValue(new Error('private database or customer detail'));
 const {container}=render(await RecurringPaymentHistorySection({actorId:'payer',planId:'plan'}));
 expect(screen.getByRole('status').textContent).toContain('temporarily unavailable');
 expect(screen.queryByText(/No recurring payments yet/)).toBeNull();
 expect(container.textContent).not.toContain('private database');
});

it('omits history for a scoped plan viewer without payment ownership',async()=>{
 for(const status of [403,404]){
  history.mockRejectedValue(new HoaWorkflowError('Not authorized',status));
  expect(await RecurringPaymentHistorySection({actorId:'manager',planId:'plan'})).toBeNull();
 }
});
