import {beforeEach,expect,it,vi} from 'vitest';
const m=vi.hoisted(()=>({auth:vi.fn(),limit:vi.fn(),status:vi.fn(),start:vi.fn(),retry:vi.fn()}));
vi.mock('@/lib/server/auth',()=>({authorizeRequest:m.auth}));
vi.mock('@/lib/server/auth-guard',()=>({guardHoaMutation:m.limit,guardFailureResponse:()=>new Response('Limited',{status:429})}));
vi.mock('@/lib/server/hoa-api',()=>({readHoaBody:async(r:Request)=>({ok:true,value:await r.json()}),hoaErrorResponse:(_:string,e:{message:string;status:number})=>Response.json({error:e.message},{status:e.status})}));
vi.mock('@/lib/server/hoa',()=>({HoaWorkflowError:class extends Error{constructor(message:string,public status:number){super(message);}}}));
vi.mock('@/lib/server/recurring-payment-recovery',()=>({getRecurringRecovery:m.status,startRecurringRecoveryCard:m.start,retryRecurringPayment:m.retry}));
import {recurringRecoveryAction} from '@/lib/server/recurring-recovery-api';
const ctx={params:Promise.resolve({chargeId:'charge'})};
const req=(body:unknown)=>new Request('https://example.invalid',{method:'POST',body:JSON.stringify(body)});
beforeEach(()=>{vi.resetAllMocks();m.auth.mockResolvedValue({ok:true,user:{id:'original'}});m.limit.mockResolvedValue(null);});
it('requires authentication and rate limiting even to retrieve a challenge secret',async()=>{
 m.auth.mockResolvedValueOnce({ok:false,response:new Response('Denied',{status:401})});
 expect((await recurringRecoveryAction(req({action:'status'}),ctx)).status).toBe(401);
 m.limit.mockResolvedValue({limited:true});expect((await recurringRecoveryAction(req({action:'status'}),ctx)).status).toBe(429);
 expect(m.status).not.toHaveBeenCalled();
});
it.each([{action:'status',actorId:'foreign'},{action:'start_card',amountCents:1},{action:'retry',setupIntentId:'seti_valid',termsToken:'terms',accepted:false},{action:'retry',setupIntentId:'seti_valid',termsToken:'terms',accepted:true,paymentMethodId:'pm_foreign'}])('rejects injected authority or missing consent %j',async body=>{
 expect((await recurringRecoveryAction(req(body),ctx)).status).toBe(400);expect(m.status).not.toHaveBeenCalled();expect(m.start).not.toHaveBeenCalled();expect(m.retry).not.toHaveBeenCalled();
});
it('binds the authenticated actor and projects only the authorized recovery fields with no-store',async()=>{
 m.status.mockResolvedValue({id:'charge',amountCents:1001,currency:'usd',termsToken:'terms',status:'requires_action',clientSecret:'authorized_challenge',customerId:'private_customer',paymentMethodId:'private_card'});
 const response=await recurringRecoveryAction(req({action:'status'}),ctx);
 expect(m.status).toHaveBeenCalledWith('original','charge');expect(response.headers.get('Cache-Control')).toBe('private, no-store');
 const text=await response.text();expect(text).toContain('authorized_challenge');expect(text).not.toContain('private_');
});
it('passes exact accepted terms and setup identity to the domain without accepting an amount',async()=>{
 m.retry.mockResolvedValue({amountCents:1001,currency:'usd',termsToken:'terms',status:'succeeded',clientSecret:null});
 const input={action:'retry',setupIntentId:'seti_valid',termsToken:'terms',accepted:true};
 expect((await recurringRecoveryAction(req(input),ctx)).status).toBe(200);
 expect(m.retry).toHaveBeenCalledWith('original','charge',input);
});
it('sanitizes unexpected failures',async()=>{
 m.start.mockRejectedValue(new Error('private processor response'));
 const response=await recurringRecoveryAction(req({action:'start_card'}),ctx);
 expect(response.status).toBe(503);expect(await response.text()).not.toContain('private processor');
});
