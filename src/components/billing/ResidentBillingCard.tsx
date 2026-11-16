"use client";

import { useRef, useState } from "react";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";

type Offer = { termsToken: string; currency: string; totalCents: number; visits: Array<{ visitNumber: number; amountCents: number }>; terms: string; acceptedAt: string | null };
const publicKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
const stripePromise = publicKey?.startsWith("pk_test_") ? loadStripe(publicKey) : null;

async function post<T>(agreementId: string, endpoint: string, body: unknown): Promise<T> {
  const response = await fetch(`/api/hoa/agreements/${encodeURIComponent(agreementId)}/${endpoint}`, {
    method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Payment setup is unavailable. Please try again.");
  return result as T;
}

export function ResidentBillingCard({ agreementId, title, offer, initialCard = null }: { agreementId: string; title: string; offer: Offer; initialCard?: { brand: string; last4: string } | null }) {
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ brand: string; last4: string } | null>(initialCard);
  const inFlight = useRef(false);
  const attempt = useRef<string | null>(null);
  const money = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: offer.currency }).format(cents / 100);

  async function start() {
    if (inFlight.current || !accepted) return;
    inFlight.current = true; setBusy(true); setError(null);
    try {
      await post(agreementId, "billing-consent", { accepted: true, termsToken: offer.termsToken });
      attempt.current ??= crypto.randomUUID();
      const result = await post<{ clientSecret: string }>(agreementId, "billing-card", { action: "start", attemptId: attempt.current });
      setClientSecret(result.clientSecret);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to start card setup."); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <section className="bb-card bb-card-pad space-y-4">
    <h2 className="bb-card-title">{title}</h2>
    <ul className="space-y-1 text-sm">{offer.visits.map((visit) => <li key={visit.visitNumber}>Visit {visit.visitNumber}: {money(visit.amountCents)}, charged only after completion</li>)}</ul>
    <p className="text-sm font-semibold">Total for all visits: {money(offer.totalCents)}</p>
    {saved ? <div><p role="status">Test card saved: {saved.brand} ending {saved.last4}.</p><button type="button" className="bb-btn bb-btn-secondary mt-3 min-h-11" onClick={() => { setSaved(null); setClientSecret(null); setAccepted(false); attempt.current = null; }}>Replace test card</button></div> : <>
      {!clientSecret && <>
        <label className="flex items-start gap-3 text-sm"><input className="mt-1 h-5 w-5 shrink-0" type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} disabled={busy} /><span>{offer.terms}</span></label>
        <button type="button" className="bb-btn bb-btn-primary min-h-11" disabled={!stripePromise || !accepted || busy} onClick={() => void start()}>{busy ? "Preparing…" : "Continue to test card"}</button>
        {!stripePromise && <p role="status">Sandbox card setup is not available yet.</p>}
      </>}
      {clientSecret && stripePromise && <Elements stripe={stripePromise} options={{ clientSecret }}><CardForm agreementId={agreementId} onSaved={setSaved} /></Elements>}
    </>}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
  </section>;
}

function CardForm({ agreementId, onSaved }: { agreementId: string; onSaved: (card: { brand: string; last4: string }) => void }) {
  const stripe = useStripe(); const elements = useElements();
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  // Keep a confirmed intent for verification retries; don't re-submit the card after a network failure.
  const confirmedId = useRef<string | null>(null);
  return <form className="space-y-4" onSubmit={async (event) => {
    event.preventDefault();
    if (!stripe || !elements || inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(null);
    try {
      if (!confirmedId.current) {
        const result = await stripe.confirmSetup({ elements, redirect: "if_required" });
        if (result.error) throw new Error(result.error.message ?? "Stripe could not save this card.");
        if (!result.setupIntent || result.setupIntent.status !== "succeeded") throw new Error("Card setup is not complete. Please try again.");
        confirmedId.current = result.setupIntent.id;
      }
      onSaved(await post(agreementId, "billing-card", { action: "verify", setupIntentId: confirmedId.current }));
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to save card."); }
    finally { inFlight.current = false; setBusy(false); }
  }}>
    <PaymentElement />
    <button className="bb-btn bb-btn-primary min-h-11" type="submit" disabled={!stripe || busy}>{busy ? "Saving…" : "Save test card"}</button>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
  </form>;
}
