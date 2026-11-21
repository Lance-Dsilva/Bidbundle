"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { HoaShareDashboard as Dashboard } from "@/lib/hoa-revenue-share-types";
const dollars = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);

/** The domain service enforces ownership; admin controls never grant permission. */
export function HoaRevenueSharePanel({ communityId, admin = false }: { communityId: string; admin?: boolean }) {
  return <RevenueShareContent key={`${communityId}:${admin}`} communityId={communityId} admin={admin} />;
}
function RevenueShareContent({ communityId, admin }: { communityId: string; admin: boolean }) {
  const endpoint = `/api/${admin ? "admin" : "hoa"}/communities/${encodeURIComponent(communityId)}/revenue-share`;
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rate, setRate] = useState("");
  const [period, setPeriod] = useState("");
  const [references, setReferences] = useState<Record<string, string>>({});
  const pending = useRef(false);
  const read = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch(endpoint, { credentials: "same-origin", cache: "no-store", signal });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "Could not load association earnings.");
    if (!signal?.aborted) { setData(body); setRate(String(body.rateBps / 100)); }
  }, [endpoint]);
  useEffect(() => {
    const controller = new AbortController();
    void read(controller.signal).catch(caught => { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "Could not load association earnings."); });
    return () => controller.abort();
  }, [read]);
  async function act(payload: Record<string, unknown>) {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(null); setNotice(null);
    try {
      const response = await fetch(endpoint, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "The action could not be completed.");
      if (payload.action === "connect") {
        const target = new URL(body.url);
        if (target.protocol !== "https:" || target.hostname !== "connect.stripe.com" || target.username || target.password || target.port) throw new Error("The payout setup link was not valid.");
        window.location.assign(target.href); return;
      }
      setNotice("Saved. The statement history reflects the recorded result.");
      await read();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Please refresh before trying again."); }
    finally { pending.current = false; setBusy(false); }
  }
  return <section className="bb-card bb-card-pad space-y-5" aria-label="Association revenue share" aria-busy={busy}>
    <div><h2 className="bb-card-title">Earned for your reserve fund</h2><p className="bb-card-copy">Your association’s share comes from Bundleen’s fee. It does not reduce the provider’s payout.</p></div>
    {error ? <p role="alert">{error}</p> : null}
    {notice ? <p role="status">{notice}</p> : null}
    {!data ? <><p role="status">{error ? "Earnings are unavailable." : "Loading association earnings…"}</p>{error ? <button type="button" className="bb-btn bb-btn-secondary min-h-11" onClick={() => { setError(null); void read().catch(caught => setError(caught.message)); }}>Try again</button> : null}</> : <>
      <dl className="grid gap-4 sm:grid-cols-3">
        <div><dt>Resident savings this month ({data.currentMonth})</dt><dd className="text-xl font-semibold">{dollars(data.monthSavingsCents)}</dd></div>
        <div><dt>Association share this month</dt><dd className="text-xl font-semibold">{dollars(data.monthEarnedCents)}</dd></div>
        <div><dt>Unpaid balance</dt><dd className="text-xl font-semibold">{dollars(data.availableCents)}</dd></div>
      </dl>
      <p className="text-sm">Share rate: {data.rateBps / 100}%. Refund adjustments reduce earnings. A negative balance carries forward against future earnings.</p>
      <p className="text-sm">Payout setup: {data.payoutStatus.replaceAll("_", " ")}</p>
      {data.payoutHoldReason ? <p role="status">Payouts are paused: {data.payoutHoldReason}</p> : null}
      <button type="button" className="bb-btn bb-btn-secondary min-h-11" disabled={busy} onClick={() => void act({ action: "connect" })}>Set up association payouts</button>
      <button type="button" className="bb-btn bb-btn-secondary min-h-11" disabled={busy} onClick={() => void act({ action: "refresh" })}>Refresh payout status</button>
      {admin ? <div className="grid gap-4 sm:grid-cols-2">
        <form onSubmit={event => { event.preventDefault(); const bps = Math.round(Number(rate) * 100); if (!Number.isFinite(bps) || bps < 0 || bps > 1000) { setError("Enter a share from 0% to 10%, within the platform fee."); return; } void act({ action: "rate", rateBps: bps }); }}>
          <label className="block">Association share (%)<input className="bb-input mt-1 w-full" type="number" min="0" max="10" step="0.01" required value={rate} disabled={busy} onChange={event => setRate(event.target.value)} /></label>
          <p className="text-sm">Applies only to new payments. Existing payment shares stay unchanged.</p>
          <button className="bb-btn bb-btn-secondary mt-2 min-h-11" disabled={busy}>Save share rate</button>
        </form>
        <form onSubmit={event => { event.preventDefault(); void act({ action: "statement", period }); }}>
          <label className="block">Statement month<input className="bb-input mt-1 w-full" type="month" required value={period} disabled={busy} onChange={event => setPeriod(event.target.value)} /></label>
          <p className="text-sm">Create a statement for an ended month (UTC).</p>
          <button className="bb-btn bb-btn-secondary mt-2 min-h-11" disabled={busy || !period}>Create monthly statement</button>
        </form>
      </div> : null}
      <div className="space-y-4"><h3 className="font-semibold">Monthly statements</h3>{data.statements.length === 0 ? <p>No monthly statements yet.</p> : data.statements.map(statement => <article key={statement.id} className="rounded-xl border border-[var(--line)] p-4 space-y-3">
        <h4 className="font-semibold">{statement.periodStart.slice(0, 7)} · {statement.status.replaceAll("_", " ")}</h4>
        <dl className="grid gap-2 sm:grid-cols-3"><div><dt>Net earned in period</dt><dd>{dollars(statement.totalCents)}</dd></div><div><dt>Paid to association</dt><dd>{dollars(statement.distributedCents)}</dd></div><div><dt>Closing balance</dt><dd>{dollars(statement.closingBalanceCents)}</dd></div></dl>
        {statement.reference ? <p className="text-sm break-words">Payment reference: {statement.reference}</p> : null}
        <div className="flex flex-wrap gap-3">{["csv", "pdf"].map(format => <a key={format} className="bb-btn bb-btn-secondary min-h-11" href={`${endpoint}/statements/${encodeURIComponent(statement.id)}?format=${format}`}>Download {format.toUpperCase()}</a>)}</div>
        {admin && statement.status !== "paid" ? <div className="space-y-3">
          <p>Available for this statement: {dollars(statement.availableCents)}. Pending transfers must be reconciled before recording a manual payment.</p>
          <button type="button" className="bb-btn bb-btn-secondary min-h-11" disabled={busy || (statement.status !== "pending" && (!!data.payoutHoldReason || statement.availableCents <= 0))} onClick={() => void act({ action: "payout", statementId: statement.id })}>{statement.status === "pending" ? "Reconcile pending sandbox payout" : "Send sandbox payout"}</button>
          <form onSubmit={event => { event.preventDefault(); void act({ action: "manual", statementId: statement.id, reference: references[statement.id]?.trim() }); }} className="space-y-2">
            <label className="block">Manual payment reference<input className="bb-input mt-1 w-full" required maxLength={200} disabled={busy} value={references[statement.id] ?? ""} onChange={event => setReferences(previous => ({ ...previous, [statement.id]: event.target.value }))} /></label>
            <button className="bb-btn bb-btn-secondary min-h-11" disabled={busy || statement.status === "pending" || !!data.payoutHoldReason || statement.availableCents <= 0}>Record payment already made</button>
          </form>
        </div> : null}
      </article>)}</div>
    </>}
  </section>;
}
