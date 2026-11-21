"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { EnrollmentBilling } from "@/components/billing/EnrollmentBilling";
import type { ComponentProps } from "react";
type Address={addressLine1:string;locality:string;region:string;postalCode:string;unitLabel?:string};
type State={stage:"address"|"card"|"joined"|"review"|"closed";requestPath:string;service:string;ownAddress?:Address;message?:string};
export function SharedEnrollment({token,state,offer}:{token:string;state:State;offer?:ComponentProps<typeof EnrollmentBilling>["offer"]}){
 const router=useRouter();const[review,setReview]=useState(false);const[busy,setBusy]=useState(false);const[error,setError]=useState<string|null>(null);const pending=useRef(false);
 return <section className="space-y-5"><h1 className="text-3xl font-semibold">Join {state.service}</h1>
 <ol aria-label="Enrollment progress" className="flex flex-wrap gap-4 text-sm"><li aria-current={state.stage==="address"?"step":undefined}>1. Confirm home</li><li aria-current={state.stage==="card"?"step":undefined}>2. Card and consent</li><li aria-current={state.stage==="joined"?"step":undefined}>3. Enrollment confirmed</li></ol>
 {state.stage==="address"&&!review&&<form className="space-y-4" onSubmit={async event=>{event.preventDefault();if(pending.current)return;pending.current=true;setBusy(true);setError(null);const data=new FormData(event.currentTarget);
 try{const address=Object.fromEntries(["addressLine1","locality","region","postalCode","unitLabel"].map(k=>[k,String(data.get(k)??"").trim()]));const r=await fetch(`/api/public-enrollment/${encodeURIComponent(token)}`,{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"address",address})});const d=await r.json();if(!r.ok)throw new Error(d.error??"Please check your address.");if(d.stage==="review")setReview(true);else router.refresh();}catch(e){setError(e instanceof Error?e.message:"Please try again.");}finally{pending.current=false;setBusy(false);}
 }}><p>Use the home listed in your HOA invitation. We verify your signed-in email before matching your home.</p>
 {([{key:"addressLine1",label:"Street address",auto:"address-line1"},{key:"unitLabel",label:"Unit (if applicable)",auto:"address-line2"},{key:"locality",label:"City",auto:"address-level2"},{key:"region",label:"State or region",auto:"address-level1"},{key:"postalCode",label:"Postal code",auto:"postal-code"}] as const).map(f=><label key={f.key} className="block">{f.label}<input name={f.key} autoComplete={f.auto} required={f.key!=="unitLabel"} maxLength={f.key==="addressLine1"?200:f.key==="postalCode"?20:100} defaultValue={state.ownAddress?.[f.key]??""} disabled={busy} className="mt-1 block min-h-11 w-full rounded-lg border px-3" /></label>)}
 <button disabled={busy} className="bb-btn bb-btn-primary min-h-11">{busy?"Checking home…":"Confirm my home"}</button></form>}
 {state.stage==="card"&&offer&&<EnrollmentBilling requestId="" sharedFlowToken={token} offer={offer} onJoined={()=>router.refresh()} />}
 {state.stage==="card"&&!offer&&<p role="status">Card setup is temporarily unavailable. Refresh this page to try again.</p>}
 {state.stage==="joined"&&<p role="status">You’re enrolled in this service. You can return to the service details below.</p>}
 {(review||state.stage==="review"||state.stage==="closed")&&<p role="status">{state.message??"Please ask your community manager to confirm your invitation and home before continuing."}</p>}
 {error&&<p role="alert">{error}</p>}<Link href={state.requestPath} className="inline-block min-h-11 py-3 text-teal-700 underline">Back to this service</Link></section>;
}
