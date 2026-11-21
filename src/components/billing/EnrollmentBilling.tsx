"use client";
import { useRef, useState } from "react";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
const key = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
const stripePromise = key?.startsWith("pk_test_") ? loadStripe(key) : null;
type Offer = { title: string; scope: string; maximumCents: number; currency: string; totalOccurrences: number; recurrenceLabel: string | null; termsToken: string };
async function post<T>(requestId: string, body: unknown): Promise<T> {
  const response = await fetch(`/api/hoa/requests/${encodeURIComponent(requestId)}/enrollment`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json(); if (!response.ok) throw new Error(data.error ?? "Enrollment is unavailable."); return data;
}
export function EnrollmentBilling({ requestId, offer }: { requestId: string; offer: Offer }) {
  const [accepted, setAccepted] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [secret, setSecret] = useState<string | null>(null), [joined, setJoined] = useState(false);
  const consent = useRef<string | null>(null), pending = useRef(false);
  const maximum = new Intl.NumberFormat("en-US", { style: "currency", currency: offer.currency }).format(offer.maximumCents / 100);
  return <section className="bb-card bb-card-pad space-y-4"><p>{offer.scope}</p><p className="font-semibold">Maximum {maximum} for the full service term ({offer.totalOccurrences} visits{offer.recurrenceLabel ? `, ${offer.recurrenceLabel}` : ""}).</p>
    <p>Your price can fall as more homes join. Each completed visit is charged its share of the final total. No charge if the group does not reach its minimum.</p><p>Sandbox testing only: use a Stripe test card.</p>
    {joined ? <p role="status">You’re enrolled. Your test card is saved; nothing has been charged.</p> : secret && consent.current && stripePromise ? <Elements stripe={stripePromise} options={{ clientSecret: secret }}><EnrollmentCard requestId={requestId} consentId={consent.current} onJoined={() => setJoined(true)} /></Elements> : <>
      <label className="flex gap-3"><input className="mt-1 h-5 w-5 shrink-0" type="checkbox" checked={accepted} disabled={busy} onChange={event => setAccepted(event.target.checked)} /><span>I authorize Bundleen to save my test card and charge only after completed visits, up to {maximum} in total for these services. The final total may be lower.</span></label>
      <button type="button" className="bb-btn bb-btn-primary min-h-11" disabled={!accepted || busy || !stripePromise} onClick={async () => {
        if (pending.current || !accepted) return; pending.current = true; setBusy(true); setError(null);
        try { consent.current ??= crypto.randomUUID(); const result = await post<{ clientSecret: string }>(requestId, { action: "start", consentId: consent.current, termsToken: offer.termsToken, accepted: true }); setSecret(result.clientSecret); }
        catch (caught) { setError(caught instanceof Error ? caught.message : "Please try again."); }
        finally { pending.current = false; setBusy(false); }
      }}>{busy ? "Preparing…" : "Save card and join"}</button>
    </>}{!stripePromise && <p role="status">Sandbox card setup is unavailable. Please try again later.</p>}{error && <p role="alert">{error}</p>}</section>;
}
function EnrollmentCard({ requestId, consentId, onJoined }: { requestId: string; consentId: string; onJoined: () => void }) {
  const stripe = useStripe(), elements = useElements(); const confirmed = useRef<string | null>(null), pending = useRef(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  return <form className="space-y-4" onSubmit={async event => {
    event.preventDefault(); if (!stripe || !elements || pending.current) return; pending.current = true; setBusy(true); setError(null);
    try {
      if (!confirmed.current) { const result = await stripe.confirmSetup({ elements, redirect: "if_required" }); if (result.error || result.setupIntent?.status !== "succeeded") throw new Error(result.error?.message ?? "Card setup did not complete."); confirmed.current = result.setupIntent.id; }
      await post(requestId, { action: "join", consentId, setupIntentId: confirmed.current }); onJoined();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Please retry enrollment."); }
    finally { pending.current = false; setBusy(false); }
  }}><PaymentElement /><button className="bb-btn bb-btn-primary min-h-11" type="submit" disabled={busy || !stripe}>{busy ? "Joining…" : "Confirm card and join"}</button>{error && <p role="alert">{error}</p>}</form>;
}
