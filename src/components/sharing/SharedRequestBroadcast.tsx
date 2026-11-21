"use client";
import { useRef, useState } from "react";
type Preview={enabled:boolean;recipientCount:number;emailCount:number;subject:string;body:string;previewToken:string};
export function SharedRequestBroadcast({requestId}:{requestId:string}){
 const[preview,setPreview]=useState<Preview|null>(null);const[busy,setBusy]=useState(false);const[message,setMessage]=useState("");const[confirmed,setConfirmed]=useState(false);const pending=useRef(false);
 async function act(send=false){
  if(pending.current||send&&(!preview?.enabled||!confirmed))return;pending.current=true;setBusy(true);setMessage("");
  try{const response=await fetch(`/api/hoa/requests/${encodeURIComponent(requestId)}/share/broadcast`,{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify(send?{action:"send",previewToken:preview!.previewToken}:{action:"preview"})});const data=await response.json();if(!response.ok)throw new Error(data.error??"Unable to prepare this message.");
   if(send){if(data.queued!==true)throw new Error("Message delivery has not been queued.");setPreview(null);setConfirmed(false);setMessage(`Message queued for ${data.recipientCount} residents (${data.emailCount} emails). Delivery is not yet confirmed.`);}
   else {setPreview(data);setConfirmed(false);}
  }catch(error){setMessage(error instanceof Error?error.message:"Please try again.");if(send){setPreview(null);setConfirmed(false);}}
  finally{pending.current=false;setBusy(false);}
 }
 return <div className="mt-3 space-y-3"><button type="button" disabled={busy} className="bb-btn bb-btn-secondary min-h-11" onClick={()=>void act()}>Email residents</button>
 {preview&&<section aria-label="Resident message preview" className="space-y-3 rounded-xl border bg-white p-4"><h3 className="font-semibold">{preview.subject}</h3><p className="whitespace-pre-wrap break-words">{preview.body}</p><p>{preview.recipientCount} residents · {preview.emailCount} emails, based on notification preferences.</p>
 {preview.enabled?<><label className="flex gap-2"><input type="checkbox" className="h-5 w-5" checked={confirmed} disabled={busy} onChange={e=>setConfirmed(e.target.checked)}/><span>Send this service invitation to the residents shown in this count.</span></label><button type="button" disabled={busy||!confirmed} className="bb-btn bb-btn-primary min-h-11" onClick={()=>void act(true)}>{busy?"Queuing…":"Queue resident message"}</button></>:<p role="status">Resident email is not configured for this environment.</p>}
 <button type="button" disabled={busy} className="bb-btn bb-btn-secondary min-h-11" onClick={()=>{setPreview(null);setConfirmed(false);}}>Cancel</button></section>}
 {message&&<p role="status">{message}</p>}</div>;
}
