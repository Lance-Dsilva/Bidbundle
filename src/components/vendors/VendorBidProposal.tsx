"use client";
import { useUser } from "@clerk/nextjs";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { PublicVendorBidSummary } from "@/lib/vendor-sourcing-types";
import { calculatePoolTotal, POOL_TIER_LABELS, POOL_ROUTE_DAYS, type PoolTier, type PoolQuote } from "@/lib/pool-bid-template";
import { CATEGORY_LABELS, normalizeServiceCategory } from "@/lib/service-categories";
import { vendorOnboardingPath } from "@/lib/vendor-bid-return";
import { bidSubmitSchema } from "@/lib/validation/hoa";

const inputClass = "mt-1 block min-h-11 w-full rounded-lg border border-[#dce7e4] bg-white p-2";
function cents(value: string): number {
  if (!/^(0|[1-9]\d{0,6})(?:\.\d{1,2})?$/.test(value)) throw new Error("Enter a price in dollars with no more than two decimal places.");
  const [whole, fraction = ""] = value.split("."); const result = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(result) || result < 1 || result > 50000000) throw new Error("Enter a price between $0.01 and $500,000.");
  return result;
}
const money = (amount: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount / 100);

type ProposalProps = { token: string; summary: PublicVendorBidSummary };
export function VendorBidProposal(props: ProposalProps) {
  const { isLoaded, isSignedIn, user } = useUser();
  return <AccountVendorProposal key={`${props.token}:${user?.id ?? (isSignedIn ? "signed-in" : "signed-out")}`} {...props} isLoaded={isLoaded} isSignedIn={Boolean(isSignedIn)} />;
}
function AccountVendorProposal({ token, summary, isLoaded, isSignedIn }: ProposalProps & { isLoaded: boolean; isSignedIn: boolean }) {
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const [claimed, setClaimed] = useState(false);
  const [submitted, setSubmitted] = useState(summary.invitation.submitted); const [pendingVerification, setPendingVerification] = useState(true);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const [rates, setRates] = useState<Partial<Record<PoolTier, string>>>({});
  const { request } = summary; const template = request.poolTemplate;
  const returnTo = `/bid/${token}`; const category = normalizeServiceCategory(request.category);
  const base = `/api/vendor-bids/${encodeURIComponent(token)}`;
  const markStarted = () => { void fetch(`${base}/started`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: "{}", keepalive: true }).catch(() => undefined); };
  let previewTotal: number | null = null;
  if (template) {
    try { const monthlyCents = Object.fromEntries(template.tiers.map(tier => [tier, cents(rates[tier] ?? "")])); previewTotal = calculatePoolTotal(template, { monthlyCents, chemicalsIncluded: false, equipmentRepairsExcluded: true, earliestStartDate: new Date().toISOString(), routeDay: "flexible", cancellationNoticeDays: 30 }, request.tierCounts); } catch { /* Incomplete form; the server also validates the actual quote. */ }
  }
  return <main className="mx-auto max-w-3xl space-y-6 px-5 py-10">
    <Link className="font-semibold text-[#0f756c]" href="/">Bundleen</Link>
    <header><p className="text-sm font-semibold text-[#0f756c]">Community proposal invitation</p><h1 className="mt-2 text-3xl font-semibold">Quote {category ? CATEGORY_LABELS[category].toLowerCase() : 'community service'} for nearby homes</h1><p className="mt-3 text-[#64748b]">{request.areaLabel} · {request.homeCount} participating homes</p><p className="mt-1 text-sm">Bids close {new Date(request.biddingClosesAt).toLocaleString()}. This invitation expires {new Date(summary.invitation.expiresAt).toLocaleString()}.</p></header>
    {template && <section className="rounded-xl border border-[#dce7e4] bg-[#f6faf9] p-5"><h2 className="font-semibold">Shared service terms</h2><p className="mt-2 text-sm">{template.serviceMonths} calendar months · {template.visitsPerMonth} visits per month for each home</p><ul className="mt-2 space-y-1 text-sm">{template.tiers.map(tier => <li key={tier}>{POOL_TIER_LABELS[tier]}: {request.tierCounts[tier] ?? 0} homes</li>)}</ul>{request.requiresAfterPhoto && <p className="mt-3 text-sm">An after-service photo is required to complete each visit.</p>}</section>}
    <p className="text-sm text-[#64748b]">This invitation is for {summary.prefill.businessName}. Use the verified email that received it. Your quote is reviewed by the HOA; award requires current provider verification and the community’s eligibility checks.</p>
    {!isLoaded ? <p role="status">Checking your session…</p> : !isSignedIn ? <section className="rounded-xl border border-[#dce7e4] p-5"><h2 className="font-semibold">Start your proposal</h2><p className="mt-2 text-sm">Create a provider account or sign in with your invited business email. We’ll return you here after setup.</p><div className="mt-4 flex flex-wrap gap-3"><Link className="flex min-h-11 items-center rounded bg-[#0f756c] px-4 text-sm font-semibold text-white" href={vendorOnboardingPath('/get-started', returnTo)} onClick={markStarted}>Sign up to propose</Link><Link className="flex min-h-11 items-center rounded border px-4 text-sm" href={vendorOnboardingPath('/sign-in', returnTo)} onClick={markStarted}>Sign in with invited email</Link></div></section> : !claimed ? <section className="space-y-3 rounded-xl border border-[#dce7e4] p-5"><h2 className="font-semibold">Confirm your provider account</h2><p className="text-sm">Continue with the verified email that received the invitation. If your provider profile is incomplete, finish it first.</p><div className="flex flex-wrap gap-3"><button className="min-h-11 rounded bg-[#0f756c] px-4 text-sm font-semibold text-white disabled:opacity-50" disabled={busy} onClick={async () => { if (busy) return; setBusy(true); setError(null); try { const response = await fetch(`${base}/claim`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type':'application/json' }, body: '{}' }); const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Could not confirm the invited account.'); if (!active.current) return; setClaimed(true); setPendingVerification(result.verificationPending !== false); markStarted(); } catch (caught) { if (active.current) setError(caught instanceof Error ? caught.message : 'Could not confirm your account.'); } finally { if (active.current) setBusy(false); } }}>Continue with verified email</button><Link className="flex min-h-11 items-center rounded border px-4 text-sm" href={vendorOnboardingPath('/get-started', returnTo)}>Complete provider profile</Link></div></section> : submitted ? <section role="status" className="space-y-3 rounded-xl border border-[#b9d9ce] bg-[#f1faf5] p-5"><h2 className="font-semibold">Your proposal has been received</h2><p className="text-sm">The HOA can review it in its normal bid comparison. Complete your provider documents before the work can be awarded.</p><Link href="/app/provider/hoa" className="inline-flex min-h-11 items-center font-semibold underline">Open my proposals</Link><Link href="/app/provider/profile" className="ml-4 inline-flex min-h-11 items-center underline">Review provider setup</Link></section> : <form className="space-y-4 rounded-xl border border-[#dce7e4] p-5" onSubmit={async event => {
      event.preventDefault(); if (busy) return; setBusy(true); setError(null); const data = new FormData(event.currentTarget); const text = (key: string) => String(data.get(key) ?? '').trim();
      try {
        const poolQuote: PoolQuote | null = template ? { monthlyCents: Object.fromEntries(template.tiers.map(tier => [tier,cents(text(`monthly-${tier}`))])), chemicalsIncluded: data.get('chemicalsIncluded') === 'on', equipmentRepairsExcluded: true, earliestStartDate: new Date(`${text('earliestStartDate')}T00:00:00Z`).toISOString(), routeDay: text('routeDay') as PoolQuote['routeDay'], cancellationNoticeDays: Number(text('cancellationNoticeDays')) } : null;
        const parsed = bidSubmitSchema.safeParse({ pricingBasis:'total', perHomeCents:null, ...(poolQuote ? {poolQuote} : {amountCents:cents(text('amount'))}), scope:text('scope'), exclusions:text('exclusions') || null, estimatedDurationLabel:text('duration') || null, cadenceLabel:text('cadence') || null, validUntil:text('validUntil') ? new Date(text('validUntil')).toISOString() : null });
        if (!parsed.success) throw new Error(parsed.error.issues[0]?.message || 'Check the proposal fields.');
        const response = await fetch(`${base}/proposal`, { method:'PUT', credentials:'same-origin', headers:{'Content-Type':'application/json'}, body:JSON.stringify(parsed.data) }); const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Could not submit your proposal.'); if (active.current) setSubmitted(true);
      } catch (caught) { if (active.current) setError(caught instanceof Error ? caught.message : 'Could not submit your proposal.'); } finally { if (active.current) setBusy(false); }
    }}>
      <h2 className="text-xl font-semibold">Your proposal</h2>
      {pendingVerification && <p className="rounded border border-amber-200 bg-amber-50 p-3 text-sm">Verification pending: you may submit this invited proposal, but your provider documents must be approved before award. Payout setup follows the payments rollout.</p>}
      <fieldset disabled={busy} className="grid gap-4 sm:grid-cols-2"><legend className="sr-only">Quote terms</legend>
        {template ? template.tiers.map(tier => <label className="text-sm" key={tier}>{POOL_TIER_LABELS[tier]} monthly price per home ($)<input className={inputClass} name={`monthly-${tier}`} type="number" min="0.01" max="500000" step="0.01" required value={rates[tier] ?? ''} onChange={event => setRates(current => ({...current,[tier]:event.target.value}))} /></label>) : <label className="text-sm">Whole-job total for all homes and visits ($)<input className={inputClass} name="amount" type="number" min="0.01" max="500000" step="0.01" required /></label>}
        {template && <><label className="text-sm">Earliest service start<input className={inputClass} name="earliestStartDate" type="date" required /></label><label className="text-sm">Preferred route day<select className={inputClass} name="routeDay" defaultValue="flexible">{POOL_ROUTE_DAYS.map(day => <option value={day} key={day}>{day === 'flexible' ? 'Flexible' : day}</option>)}</select></label><label className="text-sm">Cancellation notice (days)<input className={inputClass} name="cancellationNoticeDays" type="number" min={0} max={90} step={1} defaultValue={30} required /></label><label className="flex min-h-11 items-center gap-2 text-sm"><input name="chemicalsIncluded" type="checkbox" />Chemicals included</label><label className="flex min-h-11 items-center gap-2 text-sm sm:col-span-2"><input name="repairsExcluded" type="checkbox" required defaultChecked />Equipment repairs are excluded from these rates.</label><p className="rounded bg-[#f6faf9] p-3 text-sm sm:col-span-2" aria-live="polite">{previewTotal === null ? 'Enter every applicable monthly rate to calculate the whole-job total.' : `Calculated whole-job total: ${money(previewTotal)} for ${template.serviceMonths} calendar months across all participating homes.`}</p></>}
        <label className="text-sm sm:col-span-2">Work included<textarea className={inputClass} name="scope" maxLength={2000} required /></label><label className="text-sm sm:col-span-2">Exclusions<textarea className={inputClass} name="exclusions" maxLength={2000} /></label><label className="text-sm">Estimated visit duration<input className={inputClass} name="duration" maxLength={120} /></label><label className="text-sm">Service cadence<input className={inputClass} name="cadence" maxLength={80} /></label><label className="text-sm sm:col-span-2">Quote valid until<input className={inputClass} name="validUntil" type="datetime-local" required={Boolean(template)} /></label>
      </fieldset>
      <button className="min-h-11 rounded bg-[#0f756c] px-5 text-sm font-semibold text-white disabled:opacity-50" disabled={busy} type="submit">{busy ? 'Submitting…' : 'Submit proposal'}</button>
    </form>}
    {error && <p role="alert" className="rounded border border-red-200 p-3 text-sm text-red-700">{error}</p>}
  </main>;
}
