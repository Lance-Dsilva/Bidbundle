"use client";
import { useRef, useState } from "react";
export function QualityResolutionForm({ claimId, provider = false }: { claimId: string; provider?: boolean }) {
  const [busy, setBusy] = useState(false), [message, setMessage] = useState<string | null>(null);
  const lock = useRef(false);
  return <form className="space-y-3" onSubmit={async event => {
    event.preventDefault(); if (lock.current) return;
    const data = new FormData(event.currentTarget); lock.current = true; setBusy(true); setMessage(null);
    try {
      const response = await fetch(`/api/${provider ? "provider" : "admin"}/quality/${encodeURIComponent(claimId)}`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(provider ? { response: data.get("note") } : { action: data.get("action"), note: data.get("note") }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error ?? "Unable to save.");
      setMessage(provider ? "Your response is recorded." : "Resolution request recorded. No refund or redo has been executed.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to save."); }
    finally { lock.current = false; setBusy(false); }
  }}>
    {!provider && <label className="block">Requested resolution<select name="action" className="bb-input w-full" disabled={busy}><option value="request_redo">Request a redo</option><option value="request_refund">Request a refund</option></select></label>}
    <label className="block">{provider ? "Your response" : "Internal reason"}<textarea name="note" minLength={10} maxLength={4000} required rows={3} className="bb-input w-full" disabled={busy}/></label>
    <button className="bb-btn bb-btn-primary min-h-11" disabled={busy}>{busy ? "Saving…" : provider ? "Send response" : "Record pending resolution"}</button>
    {message && <p role="status">{message}</p>}
  </form>;
}
