"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
export function QualityExecutionForm({ claimId, resolution, operationId, amountCents }: { claimId: string; resolution: string; operationId: string | null; amountCents: number | null }) {
  const router = useRouter();
  const id = useRef(operationId), lock = useRef(false);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState<string | null>(null);
  const refund = resolution === "refund_pending";
  return <form className="space-y-3" onSubmit={async event => {
    event.preventDefault(); if (lock.current) return;
    const form = new FormData(event.currentTarget);
    const amount = amountCents ?? Math.round(Number(form.get("amount")) * 100);
    lock.current = true; setBusy(true); setMessage(null);
    try {
      if (refund && !id.current) id.current = crypto.randomUUID();
      const payload = refund ? { action: "refund", operationId: id.current, amountCents: amount, note: form.get("note") } : { action: "redo", serviceDate: new Date(String(form.get("date"))).toISOString(), note: form.get("note") };
      const response = await fetch(`/api/admin/quality/${encodeURIComponent(claimId)}/execute`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify(payload) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error ?? "The operation is pending or needs review. Retry the same request.");
      setMessage(result.executed ? "The refund and required reversal are complete." : refund ? "Refund processing remains pending. The claim stays open until reconciliation finishes." : "A no-charge redo is scheduled. The original visit and payment are preserved."); router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to execute resolution."); }
    finally { lock.current = false; setBusy(false); }
  }}>
    <p>{refund ? "Refund the original payer. This amount is the agreed resolution for this claim; it cannot exceed the remaining paid balance." : "Schedule a separate redo at no additional charge."}</p>
    {refund ? <label className="block">Refund amount (USD)<input name="amount" type="number" min="0.01" step="0.01" required className="bb-input" defaultValue={amountCents === null ? undefined : (amountCents / 100).toFixed(2)} disabled={busy || amountCents !== null} /></label> : <label className="block">Redo date and time<input name="date" type="datetime-local" required className="bb-input" disabled={busy} /></label>}
    <label className="block">Approval note<textarea name="note" required minLength={10} maxLength={2000} className="bb-input w-full" disabled={busy} /></label>
    <button className="bb-btn bb-btn-primary min-h-11" disabled={busy}>{busy ? "Processing…" : refund ? operationId ? "Retry approved refund" : "Execute approved refund" : "Schedule no-charge redo"}</button>
    {message && <p role="status">{message}</p>}
  </form>;
}
