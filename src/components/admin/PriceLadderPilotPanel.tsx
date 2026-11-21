"use client";
import { useEffect, useState } from "react";
import { validatePriceLadder } from "@/lib/price-ladder";

export function PriceLadderPilotPanel({ communityId }: { communityId: string }) {
 const [choices,setChoices]=useState<{requests:{id:string;title:string}[];providers:{id:string;name:string}[]}>({requests:[],providers:[]});
 useEffect(()=>{const controller=new AbortController();void fetch(`/api/admin/communities/${encodeURIComponent(communityId)}/price-ladder`,{signal:controller.signal,cache:"no-store"}).then(async r=>{const d=await r.json();if(!r.ok)throw new Error(d.error||"Could not load pricing choices");setChoices(d);}).catch(e=>{if(!controller.signal.aborted)setError(e instanceof Error?e.message:"Could not load choices");});return()=>controller.abort();},[communityId]);
 const [error,setError]=useState(""); const [notice,setNotice]=useState(""); const [busy,setBusy]=useState(false);
 return <section className="rounded-2xl border bg-white p-5"><h2 className="font-semibold">Provider-backed group pricing</h2>
 <p className="my-2 text-sm">For pilots, propose the provider’s maximum and discounts before anyone joins. Prices cover the full service term. The provider must accept it in My bids before enrollment opens. Terms cannot be edited after saving.</p>
 <form className="grid gap-3" onSubmit={async(event)=>{event.preventDefault();setError("");setNotice(""); const data=new FormData(event.currentTarget);try {const tiers=validatePriceLadder(String(data.get("tiers")).split(/\n/).filter(Boolean).map(line=>{const [homes,cents]=line.split(",");return {minHomes:Number(homes),perHomeCents:Number(cents)};}));setBusy(true);const response=await fetch(`/api/admin/communities/${encodeURIComponent(communityId)}/price-ladder`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({requestId:data.get("requestId"),providerUserId:data.get("providerUserId"),scope:data.get("scope"),tiers,providerAgreementConfirmed:data.get("confirmed")==="on"})});const result=await response.json();if(!response.ok)throw new Error(result.error||"Could not save commitment");setNotice("Proposal saved. The provider must accept it in My bids before enrollment opens.");}catch(e){setError(e instanceof Error?e.message:"Could not save commitment");}finally{setBusy(false);}}}>
 <label className="grid gap-1 text-sm">Request<select required name="requestId" className="rounded border p-2"><option value="">Choose a request before enrollment</option>{choices.requests.map(r=><option key={r.id} value={r.id}>{r.title}</option>)}</select></label>
 <label className="grid gap-1 text-sm">Provider<select required name="providerUserId" className="rounded border p-2"><option value="">Choose the provider</option>{choices.providers.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
 <label className="grid gap-1 text-sm">Agreed service scope<textarea required name="scope" maxLength={2000} className="rounded border p-2" /></label>
 <label className="grid gap-1 text-sm">Price tiers: minimum homes, full-term cents per home<textarea required name="tiers" defaultValue={'1,12000\n10,10000\n20,8000'} className="rounded border p-2" /></label>
 <label className="flex gap-2 text-sm"><input required type="checkbox" name="confirmed" />The provider agreed to these full-term prices and to retain unlocked discounts even when homes withdraw.</label>
 <button disabled={busy} className="min-h-11 rounded bg-teal-800 px-4 text-white disabled:opacity-50">{busy?"Saving…":"Save immutable provider commitment"}</button>
 {error?<p role="alert">{error}</p>:null}{notice?<p role="status">{notice}</p>:null}
 </form></section>;
}
