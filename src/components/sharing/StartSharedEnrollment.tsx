"use client";
import { useRef, useState } from "react";
export function StartSharedEnrollment({communityToken,requestToken}:{communityToken:string;requestToken:string}){
 const pending=useRef(false);const[busy,setBusy]=useState(false);const[error,setError]=useState<string|null>(null);
 return <div><button className="mt-5 inline-block rounded-xl bg-teal-700 px-5 py-3 font-semibold text-white disabled:opacity-50" disabled={busy} onClick={async()=>{
  if(pending.current)return;pending.current=true;setBusy(true);setError(null);
  try{const r=await fetch("/api/public-enrollment/start",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({communityToken,requestToken})});const d=await r.json();if(!r.ok)throw new Error(d.error??"Please try again.");
   if(typeof d.path!=="string"||!/^\/c\/[A-Za-z0-9_-]{32}\/r\/[A-Za-z0-9_-]{32}\/join$/.test(d.path))throw new Error("Please reopen the service link.");window.location.assign(d.path);
  }catch(e){setError(e instanceof Error?e.message:"Please try again.");pending.current=false;setBusy(false);}
 }}>{busy?"Opening enrollment…":"Continue to enrollment"}</button>{error&&<p role="alert" className="mt-3">{error}</p>}</div>;
}
