"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
type Operation = { id: string; state: string; amountCents: number };
export function AdminPaymentRefund({ visitId, amountCents, refundedCents, operations, eligible }: {
  visitId: string; amountCents: number; refundedCents: number; operations: Operation[]; eligible: boolean;
}) {
  const router = useRouter();
  const remaining = amountCents - refundedCents;
  const active = operations.find(row => !["succeeded", "failed"].includes(row.state));
  const [amount, setAmount] = useState((remaining / 100).toFixed(2));
  const [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState<string | null>(null);
  const inFlight = useRef(false), requestId = useRef<string | null>(null);
  async function submit(retryId?: string) {
    if (inFlight.current) return;
    const cents = Math.round(Number(amount) * 100);
    if (!retryId && (!confirmed || !/^\d+(\.\d{1,2})?$/.test(amount) || cents < 1 || cents > remaining)) { setMessage("Confirm an amount within the remaining paid balance."); return; }
    inFlight.current = true; setBusy(true); setMessage(null);
    try {
      requestId.current ??= crypto.randomUUID();
      const body = retryId ? { action: "retry", id: retryId } : { action: "request", id: requestId.current, amountCents: cents, reason: "requested_by_customer", confirmed: true };
      const response = await fetch(`/api/admin/payments/${encodeURIComponent(visitId)}/refunds`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Refund unavailable.");
      setMessage(result.message ?? (result.state === "succeeded" ? "Refund and required reversal completed." : result.state === "failed" ? "The processor could not complete this refund." : "Refund saved; processing is pending."));
      router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Refresh before retrying."); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <section className="rounded-xl border border-slate-200 p-4 space-y-3">
    <p>Amount ${(amountCents / 100).toFixed(2)} · Refunded ${(refundedCents / 100).toFixed(2)}</p>
    {active ? <><p>Refund ${(active.amountCents / 100).toFixed(2)}: {active.state.replaceAll("_", " ")}</p><button className="bb-btn bb-btn-secondary" disabled={busy} onClick={() => void submit(active.id)}>Retry saved refund</button></> : eligible && remaining > 0 ? <>
      <label className="block">Refund amount (USD)<input className="bb-input" inputMode="decimal" value={amount} disabled={busy || requestId.current !== null} onChange={event => setAmount(event.target.value)} /></label>
      <label className="flex gap-2"><input type="checkbox" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} />I confirm this sandbox refund and its matching provider transfer reversal.</label>
      <button className="bb-btn bb-btn-primary" disabled={busy || !confirmed} onClick={() => void submit()}>Request test refund</button>
    </> : <p>{remaining === 0 ? "Fully refunded." : "Refunds are available only after a successful payment."}</p>}
    {message && <p role="status">{message}</p>}
  </section>;
}
