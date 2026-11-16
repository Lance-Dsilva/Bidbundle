"use client";
import { useRef, useState } from "react";

export function ServiceQualityReport({ visitId }: { visitId: string }) {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lock = useRef(false);
  if (saved) return <p role="status" className="mt-3 text-sm">Your report is saved. Follow up in <a href="/app/support" className="underline">Support</a>.</p>;
  if (!open) return <button type="button" className="bb-btn bb-btn-secondary mt-3 min-h-11" onClick={() => setOpen(true)}>Report a problem</button>;
  return <form className="mt-4 space-y-3" onSubmit={async event => {
    event.preventDefault(); if (lock.current) return;
    const data = new FormData(event.currentTarget);
    lock.current = true; setBusy(true); setError(null);
    try {
      const response = await fetch(`/api/hoa/visits/${encodeURIComponent(visitId)}/quality`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason: data.get("reason"), description: data.get("description") }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error ?? "Unable to save your report.");
      setSaved(true);
    } catch (error) { setError(error instanceof Error ? error.message : "Unable to save your report."); }
    finally { lock.current = false; setBusy(false); }
  }}>
    <p className="text-sm">Report a problem within 72 hours of completion. Support will review the visit; submitting does not confirm a refund or schedule a redo.</p>
    <label className="block text-sm">Problem type<select name="reason" className="bb-input mt-1 w-full" disabled={busy}><option value="incomplete">Visit was incomplete</option><option value="not_as_described">Not as described</option><option value="damage">Damage</option><option value="other">Other problem</option></select></label>
    <label className="block text-sm">What went wrong?<textarea name="description" required minLength={10} maxLength={4000} rows={4} className="bb-input mt-1 w-full" disabled={busy} /></label>
    <p className="text-xs">Your description is shared with the service provider. Do not include gate codes or payment details.</p>
    <button className="bb-btn bb-btn-primary min-h-11" disabled={busy}>{busy ? "Saving…" : "Submit report"}</button>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
  </form>;
}
