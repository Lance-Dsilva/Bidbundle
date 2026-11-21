// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import type {ReactNode} from 'react';
const m=vi.hoisted(()=>{process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY='pk_test_fixture';return {next:vi.fn(),setup:vi.fn(),refresh:vi.fn()};});
vi.mock('next/navigation',()=>({useRouter:()=>({refresh:m.refresh})}));
vi.mock('@stripe/stripe-js',()=>({loadStripe:()=>Promise.resolve({handleNextAction:m.next})}));
vi.mock('@stripe/react-stripe-js',()=>({Elements:({children}:{children:ReactNode})=>children,PaymentElement:()=> <div>Card fields</div>,useStripe:()=>({confirmSetup:m.setup}),useElements:()=>({})}));
import {RecurringPaymentRecovery} from '@/components/recurring-plans/RecurringPaymentRecovery';
const response=(status:string,clientSecret:string|null=null)=>({id:'charge',amountCents:1001,currency:'usd',termsToken:'terms',status,clientSecret});
beforeEach(()=>vi.clearAllMocks());afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it('requires authoritative status after challenge instead of assuming client success',async()=>{
 const fetcher=vi.fn().mockResolvedValueOnce(Response.json(response('requires_action','challenge'))).mockResolvedValueOnce(Response.json(response('processing')));vi.stubGlobal('fetch',fetcher);m.next.mockResolvedValue({paymentIntent:{status:'succeeded'}});
 render(<RecurringPaymentRecovery chargeId="charge"/>);fireEvent.click(screen.getByText('Review payment recovery'));fireEvent.click(await screen.findByText('Verify this payment'));
 await waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(2));expect(screen.queryByText('Payment confirmed.')).toBeNull();expect(m.next).toHaveBeenCalledWith({clientSecret:'challenge'});
});
it('requires unchecked exact-amount consent and reuses verified setup after server failure',async()=>{
 const fetcher=vi.fn().mockResolvedValueOnce(Response.json(response('requires_payment_method'))).mockResolvedValueOnce(Response.json(response('requires_payment_method','setup-secret'))).mockResolvedValueOnce(Response.json({error:'Retry confirmation'},{status:503})).mockResolvedValueOnce(Response.json(response('succeeded')));vi.stubGlobal('fetch',fetcher);m.setup.mockResolvedValue({setupIntent:{id:'seti_verified',status:'succeeded'}});
 render(<RecurringPaymentRecovery chargeId="charge"/>);fireEvent.click(screen.getByText('Review payment recovery'));fireEvent.click(await screen.findByText('Use another test card'));const retry=await screen.findByText('Retry $10.01 payment');expect((retry as HTMLButtonElement).disabled).toBe(true);fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(retry);await screen.findByText('Retry confirmation');fireEvent.click(screen.getByText('Retry $10.01 payment'));await screen.findByText('Payment confirmed.');expect(m.setup).toHaveBeenCalledTimes(1);
 expect(JSON.parse(fetcher.mock.calls[2][1].body)).toEqual({action:'retry',setupIntentId:'seti_verified',termsToken:'terms',accepted:true});expect(fetcher.mock.calls[3][1].body).toBe(fetcher.mock.calls[2][1].body);
});
it('suppresses duplicate recovery requests while one is pending',async()=>{
 let finish!:(response:Response)=>void;const fetcher=vi.fn().mockImplementation(()=>new Promise<Response>(r=>{finish=r;}));vi.stubGlobal('fetch',fetcher);
 render(<RecurringPaymentRecovery chargeId="charge"/>);const button=screen.getByText('Review payment recovery');fireEvent.click(button);fireEvent.click(button);expect(fetcher).toHaveBeenCalledTimes(1);finish(Response.json(response('succeeded')));await screen.findByText('Payment confirmed.');
});
