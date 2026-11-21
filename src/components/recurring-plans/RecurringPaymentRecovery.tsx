'use client';
import {useRef,useState} from 'react';
import {Elements,PaymentElement,useElements,useStripe} from '@stripe/react-stripe-js';
import {loadStripe} from '@stripe/stripe-js';
import {useRouter} from 'next/navigation';
const key=process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
const stripePromise=key?.startsWith('pk_test_')?loadStripe(key):null;
type Recovery={id:string;amountCents:number;currency:string;termsToken:string;status?:string;clientSecret:string|null};
async function action(id:string,body:unknown):Promise<Recovery>{
 const response=await fetch(`/api/recurring-payments/${encodeURIComponent(id)}/recovery`,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 const data=await response.json();if(!response.ok)throw new Error(data.error??'Payment recovery is unavailable.');return data;
}
export function RecurringPaymentRecovery({chargeId}:{chargeId:string}){
 const router=useRouter(),pending=useRef(false);
 const [view,setView]=useState<Recovery|null>(null),[setup,setSetup]=useState<Recovery|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
 async function run(work:()=>Promise<void>){if(pending.current)return;pending.current=true;setBusy(true);setError(null);try{await work();}catch(e){setError(e instanceof Error?e.message:'Please refresh and retry.');}finally{pending.current=false;setBusy(false);}}
 async function refresh(){const next=await action(chargeId,{action:'status'});setView(next);if(next.status==='succeeded'){setSetup(null);router.refresh();}}
 return <div className="space-y-3">
  {!view&&<button className="bb-btn bb-btn-secondary min-h-11" disabled={busy||!stripePromise} onClick={()=>run(refresh)}>Review payment recovery</button>}
  {view&&<p>Original payment: {new Intl.NumberFormat('en-US',{style:'currency',currency:view.currency}).format(view.amountCents/100)}. Recovery uses this existing payment.</p>}
  {view?.status==='succeeded'&&<p role="status">Payment confirmed.</p>}
  {view?.status==='requires_action'&&view.clientSecret&&<button className="bb-btn bb-btn-primary min-h-11" disabled={busy||!stripePromise} onClick={()=>run(async()=>{const stripe=await stripePromise;if(!stripe)throw new Error('Card verification is unavailable.');const result=await stripe.handleNextAction({clientSecret:view.clientSecret!});if(result.error)throw new Error(result.error.message??'Card verification is incomplete.');await refresh();})}>Verify this payment</button>}
  {view&&['requires_payment_method','requires_confirmation'].includes(view.status??'')&&!setup&&<button className="bb-btn bb-btn-secondary min-h-11" disabled={busy||!stripePromise} onClick={()=>run(async()=>{const next=await action(chargeId,{action:'start_card'});if(!next.clientSecret)throw new Error('Card setup is unavailable.');setSetup(next);})}>Use another test card</button>}
  {setup?.clientSecret&&stripePromise&&<Elements stripe={stripePromise} options={{clientSecret:setup.clientSecret}}><RecoveryCard chargeId={chargeId} setup={setup} onComplete={async next=>{setView(next);setSetup(null);router.refresh();}}/></Elements>}
  {view&&view.status!=='succeeded'&&!(view.status==='requires_action'&&view.clientSecret)&&!['requires_payment_method','requires_confirmation'].includes(view.status??'')&&<p role="status">This payment cannot be retried here right now. Refresh to check its status.</p>}
  {!stripePromise&&<p role="status">Sandbox card recovery is temporarily unavailable.</p>}
  {error&&<p role="alert">{error}</p>}
 </div>;
}
function RecoveryCard({chargeId,setup,onComplete}:{chargeId:string;setup:Recovery;onComplete:(value:Recovery)=>Promise<void>}){
 const stripe=useStripe(),elements=useElements(),pending=useRef(false),confirmed=useRef<string|null>(null);
 const [accepted,setAccepted]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
 const amount=new Intl.NumberFormat('en-US',{style:'currency',currency:setup.currency}).format(setup.amountCents/100);
 return <form className="space-y-3" onSubmit={async e=>{e.preventDefault();if(!stripe||!elements||!accepted||pending.current)return;pending.current=true;setBusy(true);setError(null);try{
  if(!confirmed.current){const result=await stripe.confirmSetup({elements,redirect:'if_required'});if(result.error||result.setupIntent?.status!=='succeeded')throw new Error(result.error?.message??'Card verification is incomplete.');confirmed.current=result.setupIntent.id;}
  const next=await action(chargeId,{action:'retry',setupIntentId:confirmed.current,termsToken:setup.termsToken,accepted:true});await onComplete(next);
 }catch(e){setError(e instanceof Error?e.message:'Please retry confirmation.');}finally{pending.current=false;setBusy(false);}}}>
  <PaymentElement/>
  <label className="flex gap-3"><input className="h-5 w-5 shrink-0" type="checkbox" checked={accepted} disabled={busy} onChange={e=>setAccepted(e.target.checked)}/><span>I authorize retrying this original {amount} payment using this test card.</span></label>
  <button className="bb-btn bb-btn-primary min-h-11" disabled={!accepted||busy||!stripe||!elements}>{busy?'Checking payment…':`Retry ${amount} payment`}</button>
  {error&&<p role="alert">{error}</p>}
 </form>;
}
