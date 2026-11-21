"use client";
import { useRef, useState } from "react";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
const key = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
const stripePromise = key?.startsWith("pk_test_") ? loadStripe(key) : null;
type State = { status: string; clientSecret?: string };
async function post<T>(visitId: string, body: unknown): Promise<T> {
  const response = await fetch(`/api/hoa/payments/${encodeURIComponent(visitId)}/recovery`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json(); if (!response.ok) throw new Error(data.error ?? "Payment recovery is unavailable."); return data;
}
export function PaymentRecovery({ visitId, amountCents, currency }: { visitId: string; amountCents: number; currency: string }) {
  const [state, setState] = useState<State | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false), [setup, setSetup] = useState<string | null>(null);
  const attempt = useRef<string | null>(null), inFlight = useRef(false);
  const amount = new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amountCents / 100);
  async function act(action: "refresh" | "verify" | "start") {
    if (inFlight.current) return; inFlight.current = true; setBusy(true); setError(null);
    try {
      if (action === "start") {
        if (!accepted) return;
        attempt.current ??= crypto.randomUUID();
        const result = await post<{ clientSecret: string }>(visitId, { action: "start", attemptId: attempt.current, accepted: true }); setSetup(result.clientSecret);
      } else {
        const fresh = await post<State>(visitId, { action: "refresh" });
        if (action === "verify" && fresh.status === "requires_action" && fresh.clientSecret) {
          const stripe = await stripePromise; if (!stripe) throw new Error("Sandbox verification is unavailable.");
          const result = await stripe.confirmCardPayment(fresh.clientSecret);
          if (result.error) throw new Error(result.error.message ?? "Verification did not complete.");
          setState(await post<State>(visitId, { action: "refresh" }));
        } else setState(fresh);
      }
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Please try again."); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <section className="bb-card bb-card-pad space-y-4"><p className="font-semibold">Completed visit: {amount}</p>
    {!state && <button type="button" className="bb-btn bb-btn-primary" disabled={busy} onClick={() => void act("refresh")}>Review payment status</button>}
    {state?.status === "succeeded" && <p role="status">Your test payment succeeded.</p>}
    {state?.status === "requires_action" && <button type="button" className="bb-btn bb-btn-primary" disabled={busy || !stripePromise} onClick={() => void act("verify")}>Verify with your bank</button>}
    {state?.status === "requires_payment_method" && !setup && <>
      <p>Your payment did not complete. You can authorize another test card for this same visit.</p>
      <label className="flex gap-3"><input type="checkbox" checked={accepted} onChange={event => setAccepted(event.target.checked)} disabled={busy} /><span>I authorize a test charge of {amount} for this completed visit using the replacement card.</span></label>
      <button type="button" className="bb-btn bb-btn-primary" disabled={busy || !accepted || !stripePromise} onClick={() => void act("start")}>Use another test card</button>
    </>}
    {setup && attempt.current && stripePromise && <Elements stripe={stripePromise} options={{ clientSecret: setup }}><ReplacementCard visitId={visitId} attemptId={attempt.current} onResult={result => { setState(result); setSetup(null); setAccepted(false); attempt.current = null; }} /></Elements>}
    {state && !["succeeded", "requires_action", "requires_payment_method"].includes(state.status) && <p role="status">{["canceled", "requires_confirmation"].includes(state.status) ? "This payment needs billing support." : "Payment is processing. Refresh to check its status."}</p>}
    {state && <button type="button" className="bb-btn bb-btn-secondary" disabled={busy} onClick={() => void act("refresh")}>Refresh status</button>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
function ReplacementCard({ visitId, attemptId, onResult }: { visitId: string; attemptId: string; onResult: (state: State) => void }) {
  const stripe = useStripe(), elements = useElements(); const confirmed = useRef<string | null>(null), pending = useRef(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  return <form className="space-y-4" onSubmit={async event => {
    event.preventDefault(); if (!stripe || !elements || pending.current) return; pending.current = true; setBusy(true); setError(null);
    try {
      if (!confirmed.current) {
        const result = await stripe.confirmSetup({ elements, redirect: "if_required" });
        if (result.error || result.setupIntent?.status !== "succeeded") throw new Error(result.error?.message ?? "Card setup did not complete.");
        confirmed.current = result.setupIntent.id;
      }
      onResult(await post<State>(visitId, { action: "retry", attemptId, setupIntentId: confirmed.current, accepted: true }));
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Please retry verification."); }
    finally { pending.current = false; setBusy(false); }
  }}><PaymentElement /><button type="submit" className="bb-btn bb-btn-primary" disabled={busy || !stripe}>{busy ? "Verifying…" : "Save card and retry test payment"}</button>{error && <p role="alert">{error}</p>}</form>;
}
