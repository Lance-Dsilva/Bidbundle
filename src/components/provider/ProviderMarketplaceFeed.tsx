"use client";

import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type FormEvent } from "react";

import { BidPrice, LegacyBidNotice } from "@/components/ui/BidPrice";
import { Button } from "@/components/ui/Button";
import type { ProviderFeedItem } from "@/lib/hoa-types";
import { apiFetch } from "@/lib/api";
import { serviceCategoryLabel } from "@/lib/service-categories";
import { MAX_BID_AMOUNT_CENTS } from "@/lib/validation/hoa";
import { calculatePoolTotal, poolQuoteSchema, POOL_TIER_LABELS, POOL_ROUTE_DAYS, type PoolQuote, type PoolTier } from "@/lib/pool-bid-template";
import { useProviderMarketplace } from "@/hooks/useProviderMarketplace";

/**
 * The provider Job Feed: every open opportunity this account is eligible for,
 * in both community types, with the bid form attached.
 *
 * Eligibility is not computed here. The server returns only work whose trade
 * matches, whose community falls inside an active service area, whose bidding
 * window is open, and whose provider account is active and verified — so the
 * feed cannot show a job that a bid would then be refused for.
 *
 * What a provider sees before winning: the community, an approximate distance,
 * the locked home count, the scope, the permitted budget, and the deadline.
 * What they do not see: any participant, any address, any coordinate, and any
 * competitor's amount. Those arrive only with an award.
 */

const card: CSSProperties = {
  background: "var(--bg-card)",
  border: "1px solid var(--border-warm)",
  borderRadius: 18,
  boxShadow: "var(--shadow-warm-sm)",
};

const input: CSSProperties = {
  width: "100%",
  borderRadius: 12,
  border: "1px solid var(--border-warm)",
  background: "var(--bg-card)",
  padding: "10px 12px",
  fontSize: 14,
  color: "var(--ink-900)",
  outline: "none",
};

const poolInputStyle: CSSProperties = { ...input, outline: undefined };

function money(cents: number | null): string {
  if (cents == null) return "—";
  return `$${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function closesIn(iso: string | null): string {
  if (!iso) return "Open";
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "Closing now";
  const hours = Math.round(ms / 3_600_000);
  return hours < 24 ? `Closes in ${hours}h` : `Closes in ${Math.round(hours / 24)}d`;
}

type CardFeedback = { success: string | null; error: string | null; stale: boolean; title?: string };
const EMPTY_FEEDBACK: CardFeedback = { success: null, error: null, stale: false };

function readAmountCents(amount: string): number | null {
  if (!/^(?:\d+(?:\.\d{0,2})?|\.\d{1,2})$/.test(amount.trim())) return null;
  const cents = Math.round(Number(amount) * 100);
  return Number.isSafeInteger(cents) && cents >= 0 && cents <= MAX_BID_AMOUNT_CENTS ? cents : null;
}

export function ProviderMarketplaceFeed() {
  const { workspace, loading, error, refresh } = useProviderMarketplace();
  const [trade, setTrade] = useState("all");
  const [feedback, setFeedback] = useState<Record<string, CardFeedback>>({});
  const [busyRequestId, setBusyRequestId] = useState<string | null>(null);
  const inFlight = useRef(false);

  const trades = useMemo(() => {
    const values = new Set((workspace?.feed ?? []).map((item) => item.category));
    return ["all", ...[...values].sort()];
  }, [workspace]);

  const visible = useMemo(
    () =>
      (workspace?.feed ?? []).filter((item) => trade === "all" || item.category === trade),
    [workspace, trade],
  );

  const refreshCard = async (requestId: string) => {
    // A read failure must never turn a confirmed write into a failed bid.
    let stale = false;
    try {
      const result = await refresh({ background: true });
      stale = result?.ok === false;
    } catch {
      // Keep this boundary safe if a future refresh implementation throws.
      stale = true;
    }
    setFeedback((current) => ({
      ...current,
      [requestId]: { ...(current[requestId] ?? EMPTY_FEEDBACK), stale },
    }));
  };

  const mutateBid = async (
    requestId: string, method: "PUT" | "DELETE", success: string, title: string,
    body?: Record<string, unknown>,
  ) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusyRequestId(requestId);
    setFeedback((current) => ({ ...current, [requestId]: EMPTY_FEEDBACK }));
    try {
      try {
        await apiFetch(`/provider/marketplace/requests/${requestId}/bid`, {
          method,
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
      } catch (caught) {
        setFeedback((current) => ({
          ...current,
          [requestId]: {
            success: null, stale: false,
            error: caught instanceof Error ? caught.message
              : method === "PUT" ? "Your bid was not saved. Please try again."
                : "Your bid was not withdrawn. Please try again.",
          },
        }));
        return;
      }
      setFeedback((current) => ({
        ...current, [requestId]: { success, error: null, stale: false, title },
      }));
      await refreshCard(requestId);
    } finally {
      inFlight.current = false;
      setBusyRequestId(null);
    }
  };

  const retryRefresh = async (requestId: string) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusyRequestId(requestId);
    try { await refreshCard(requestId); }
    finally { inFlight.current = false; setBusyRequestId(null); }
  };

  if (loading) {
    return (
      <p className="text-sm" style={{ color: "var(--ink-400)" }}>
        Loading available work…
      </p>
    );
  }

  if (error || !workspace) {
    return (
      <p className="rounded-xl px-4 py-3 text-sm" role="alert" style={{ background: "#fef2f2", color: "#b91c1c" }}>
        {error ?? "We could not load the job feed."}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {!workspace.eligible ? (
        <p
          className="rounded-xl px-4 py-3 text-sm font-medium"
          role="status"
          style={{ background: "#fffbeb", color: "#92400e" }}
        >
          {workspace.ineligibleReason ??
            "Your account cannot bid yet. Jobs below are shown for reference only."}
        </p>
      ) : null}

      {workspace.serviceAreas.length === 0 ? (
        <p className="rounded-xl px-4 py-3 text-sm" style={{ background: "var(--cream-100)", color: "var(--ink-700)" }}>
          Add a service area on your profile — work is matched to where you travel, so an account
          with no coverage area sees nothing.
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {trades.map((value) => (
          <button
            disabled={busyRequestId !== null}
            className="rounded-full px-3 py-1 text-xs font-semibold disabled:opacity-60"
            key={value}
            onClick={() => setTrade(value)}
            style={
              value === trade
                ? { background: "var(--terracotta-600)", color: "white" }
                : { background: "var(--cream-100)", color: "var(--ink-700)" }
            }
            type="button"
          >
            {value === "all" ? "All trades" : serviceCategoryLabel(value)}
          </button>
        ))}
      </div>

      {Object.entries(feedback).filter(([requestId, state]) =>
        state.success && !workspace.feed.some((item) => item.requestId === requestId),
      ).map(([requestId, state]) => (
        <p key={requestId} role="status" className="rounded-xl border px-4 py-3 text-sm" style={{ borderColor: "var(--border-warm)", color: "#166534" }}>
          <strong>{state.title ?? "Service request"}: {state.success}</strong> This request is no longer in the available feed.
        </p>
      ))}

      {visible.length === 0 ? (
        <div className="p-5" style={card}>
          <p className="text-sm" style={{ color: "var(--ink-700)" }}>
            No open work matches your trades and service areas right now. New requests appear here
            as soon as a community opens bidding nearby.
          </p>
        </div>
      ) : (
        visible.map((item) => (
          <FeedCard
            busy={busyRequestId !== null}
            working={busyRequestId === item.requestId}
            canBid={workspace.eligible}
            item={item}
            key={item.requestId}
            feedback={feedback[item.requestId] ?? EMPTY_FEEDBACK}
            onRefresh={() => void retryRefresh(item.requestId)}
            onSubmit={(body) => void mutateBid(item.requestId, "PUT", item.myBid ? "Bid updated." : "Bid sent.", item.title, body)}
            onWithdraw={() => void mutateBid(item.requestId, "DELETE", "Bid withdrawn.", item.title)}
          />
        ))
      )}
    </div>
  );
}

function FeedCard({
  item,
  canBid,
  busy,
  working,
  onSubmit,
  onWithdraw,
  feedback,
  onRefresh,
}: {
  item: ProviderFeedItem;
  canBid: boolean;
  busy: boolean;
  working: boolean;
  onSubmit: (body: Record<string, unknown>) => void;
  onWithdraw: () => void;
  feedback: CardFeedback;
  onRefresh: () => void;
}) {
  const [open, setOpen] = useState(false);
  const quoteCurrency = item.myBid?.currency ?? "USD";
  const initialAmount = () => item.myBid?.pricingBasis === "total"
    ? (item.myBid.amountCents / 100).toString() : "";
  const [amount, setAmount] = useState(initialAmount);
  const previewCents = readAmountCents(amount);
  const [amountError, setAmountError] = useState<string | null>(null);
  const amountId = useId();
  const amountInput = useRef<HTMLInputElement>(null);
  const actionFocus = useRef<HTMLElement | null>(null);
  const wasBusy = useRef(false);
  const writesBlocked = busy || feedback.stale;

  useEffect(() => {
    if (wasBusy.current && !working && actionFocus.current &&
      (document.activeElement === document.body || document.activeElement === actionFocus.current)) {
      const target = feedback.stale
        ? document.getElementById(`${amountId}-refresh`) : actionFocus.current;
      target?.focus({ preventScroll: true });
    }
    wasBusy.current = working;
  }, [working, feedback.stale, amountId]);

  const showAmountError = () => {
    setAmountError(`Enter a whole-job total from 0 to ${MAX_BID_AMOUNT_CENTS / 100} using no more than two decimal places.`);
    amountInput.current?.focus({ preventScroll: true });
  };

  const handle = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (writesBlocked) return;
    if (previewCents === null) { showAmountError(); return; }
    setAmountError(null);
    actionFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const data = new FormData(event.currentTarget);
    onSubmit({
      // Only the entered integer total is sent; averages are display-only.
      amountCents: previewCents,
      pricingBasis: "total",
      scope: String(data.get("scope") ?? "").trim(),
      exclusions: String(data.get("exclusions") ?? "").trim() || null,
      estimatedDurationLabel: String(data.get("duration") ?? "").trim() || null,
      cadenceLabel: null,
      perHomeCents: null,
      proposedStartDate: null,
      validUntil: null,
    });
  };

  return (
    <article className="p-5" style={card} aria-busy={working}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold" style={{ color: "var(--ink-900)" }}>
            {item.title}
          </h2>
          <p className="mt-1 text-xs" style={{ color: "var(--ink-400)" }}>
            {item.communityName}
            {item.locality ? ` · ${item.locality}` : ""}
            {item.approximateDistanceMi != null ? ` · ~${item.approximateDistanceMi} mi away` : ""}
            {" · "}
            {item.context === "hoa" ? "HOA" : "Neighbourhood"}
          </p>
        </div>
        <span
          className="rounded-full px-3 py-1 text-xs font-semibold"
          style={{ background: "var(--cream-100)", color: "var(--ink-700)" }}
        >
          {closesIn(item.biddingClosesAt)}
        </span>
      </div>

      <p className="mt-3 text-sm" style={{ color: "var(--ink-700)" }}>
        {item.description}
      </p>

      <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-3" style={{ color: "var(--ink-400)" }}>
        <div>
          <dt>Homes</dt>
          <dd style={{ color: "var(--ink-900)" }}>{item.homeCount}</dd>
        </div>
        <div>
          <dt>Budget</dt>
          <dd style={{ color: "var(--ink-900)" }}>
            {money(item.budgetMinCents)} – {money(item.budgetMaxCents)}
          </dd>
        </div>
        <div>
          <dt>Visits per home</dt>
          <dd style={{ color: "var(--ink-900)" }}>{item.totalOccurrences}</dd>
        </div>
      </dl>

      {item.myBid ? (
        <div className="mt-3 rounded-xl p-3" style={{ background: "var(--cream-100)" }}>
          <p className="mb-2 text-xs" style={{ color: "var(--ink-700)" }}>
            Your bid ({item.myBid.status}, version {item.myBid.version})
          </p>
          {item.poolTemplate && item.myBid.poolQuote ? <div className="space-y-1 text-xs">
            <p><strong>{formatPoolMoney(item.myBid.amountCents, quoteCurrency)}</strong> whole-job total for {item.poolTemplate.serviceMonths} calendar months</p>
            {item.poolTemplate.tiers.map((tier) => <p key={tier}>{POOL_TIER_LABELS[tier]}: {item.myBid!.poolQuote!.monthlyCents[tier] == null ? "Not quoted" : formatPoolMoney(item.myBid!.poolQuote!.monthlyCents[tier]!, quoteCurrency)} /home/month · {item.tierCounts?.[tier] ?? 0} locked homes</p>)}
            <p>{item.myBid.poolQuote.chemicalsIncluded ? "Chemicals included" : "Chemicals not included"} · Equipment repairs excluded</p>
            <p>Earliest start {item.myBid.poolQuote.earliestStartDate.slice(0, 10)} UTC · {item.myBid.poolQuote.cancellationNoticeDays} days’ cancellation notice</p>
            {item.myBid.revisions?.length ? <details><summary className="min-h-9 cursor-pointer py-2 font-semibold">Bid update history</summary><ol className="space-y-1">{item.myBid.revisions.map((revision) => <li key={revision.version}>v{revision.version}: {formatPoolMoney(revision.amountCents, quoteCurrency)} whole-job total · {revision.submittedAt.slice(0, 10)}</li>)}</ol></details> : null}
          </div> : <BidPrice bid={item.myBid} homeCount={item.homeCount} totalOccurrences={item.totalOccurrences} />}
          {item.myBid.pricingBasis !== "total" && item.myBid.status === "submitted" ? <LegacyBidNotice requestStatus="open_for_bids" /> : null}
        </div>
      ) : null}

      {canBid ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button id={`${amountId}-bid-action`} disabled={writesBlocked} onClick={() => setOpen((current) => !current)} variant="warm">
            {item.myBid ? "Revise bid" : "Submit bid"}
          </Button>
          {item.myBid && item.myBid.status === "submitted" ? (
            <Button disabled={writesBlocked} onClick={() => { actionFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; onWithdraw(); }} variant="ghost">
              Withdraw
            </Button>
          ) : null}
        </div>
      ) : null}

      {open && canBid && item.poolTemplate ? <PoolQuoteForm key={`${item.requestId}:${item.myBid?.version ?? 0}`} item={item} disabled={writesBlocked} onSubmit={(body) => { actionFocus.current = document.getElementById(`${amountId}-bid-action`); onSubmit(body); }} /> : null}
      {open && canBid && !item.poolTemplate ? (
        <form className="mt-3 grid gap-3 sm:grid-cols-2" onSubmit={handle}>
          <label className="block text-xs" style={{ color: "var(--ink-700)" }}>
            Whole-job total ({quoteCurrency.toUpperCase()})
            <input
              value={amount}
              ref={amountInput}
              id={amountId}
              onChange={(event) => { setAmount(event.target.value); setAmountError(null); }}
              readOnly={busy}
              aria-invalid={amountError ? true : undefined}
              aria-describedby={amountError ? `${amountId}-error` : undefined}
              onInvalid={(event) => { event.preventDefault(); showAmountError(); }}
              max={MAX_BID_AMOUNT_CENTS / 100}
              min="0"
              name="amount"
              required
              step="0.01"
              style={input}
              type="number"
            />
            {amountError ? <span id={`${amountId}-error`} className="mt-1 block text-xs" role="alert" style={{ color: "#b91c1c" }}>{amountError}</span> : null}
          </label>
          <div className="sm:col-span-2 space-y-2" role="status" aria-live="polite">
            <p className="text-xs" style={{ color: "var(--ink-700)" }}>
              Quote for the complete job across all participating homes and visits. Only the whole-job total is submitted.
            </p>
            {previewCents === null && Number.isSafeInteger(item.homeCount) && item.homeCount > 0 && Number.isSafeInteger(item.totalOccurrences) && item.totalOccurrences > 0 ? (
              <p className="text-xs" style={{ color: "var(--ink-700)" }}>
                {item.homeCount} {item.homeCount === 1 ? "home" : "homes"} × {item.totalOccurrences} {item.totalOccurrences === 1 ? "visit" : "visits"} each.
              </p>
            ) : null}
            {previewCents !== null ? (
              <BidPrice bid={{ amountCents: previewCents, currency: quoteCurrency, pricingBasis: "total" }} homeCount={item.homeCount} totalOccurrences={item.totalOccurrences} />
            ) : null}
          </div>
          <label className="block text-xs sm:col-span-2" style={{ color: "var(--ink-700)" }}>
            What is included
            <textarea
              defaultValue={item.myBid?.scope ?? ""}
              name="scope"
              required
              readOnly={busy}
              rows={3}
              style={input}
            />
          </label>
          <label className="block text-xs" style={{ color: "var(--ink-700)" }}>
            Exclusions (optional)
            <input defaultValue={item.myBid?.exclusions ?? ""} readOnly={busy} name="exclusions" style={input} />
          </label>
          <label className="block text-xs" style={{ color: "var(--ink-700)" }}>
            Estimated duration (optional)
            <input
              defaultValue={item.myBid?.estimatedDurationLabel ?? ""}
              readOnly={busy}
              name="duration"
              placeholder="Half a day"
              style={input}
            />
          </label>
          <div className="sm:col-span-2">
            <Button disabled={writesBlocked} type="submit" variant="warm">
              {working ? "Sending…" : item.myBid ? "Update bid" : "Send bid"}
            </Button>
          </div>
        </form>
      ) : null}

      {(feedback.success || feedback.error || feedback.stale) ? (
        <div className="mt-3 space-y-2 rounded-xl border p-3" style={{ borderColor: "var(--border-warm)" }}>
          {feedback.success ? <p role="status" className="text-sm font-semibold" style={{ color: "#166534" }}>{feedback.success}</p> : null}
          {feedback.error ? <p role="alert" className="text-sm" style={{ color: "#b91c1c" }}>{feedback.error}</p> : null}
          {feedback.stale ? (
            <>
              <p role="status" className="text-xs leading-relaxed" style={{ color: "#92400e" }}>
                Your change is confirmed, but the latest details could not be loaded. Do not send it again. Refresh the details before making another change.
              </p>
              <Button id={`${amountId}-refresh`} disabled={busy} onClick={onRefresh} variant="secondary">{working ? "Refreshing…" : "Refresh details"}</Button>
            </>
          ) : null}
        </div>
      ) : null}

    </article>
  );
}

function formatPoolMoney(cents: number, currency: string) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);
}

/** A pool quote carries monthly inputs; the server owns its all-homes total. */
export function PoolQuoteForm({ item, disabled, onSubmit }: { item: ProviderFeedItem; disabled: boolean; onSubmit: (body: Record<string, unknown>) => void }) {
  const template = item.poolTemplate!;
  const current = item.myBid?.poolQuote;
  const [prices, setPrices] = useState<Partial<Record<PoolTier, string>>>(() => Object.fromEntries(template.tiers.map((tier) => [tier, current?.monthlyCents[tier] == null ? "" : (current.monthlyCents[tier]! / 100).toFixed(2)])));
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  const [total, setTotal] = useState<number | null>(() => {
    try { return current ? calculatePoolTotal(template, current, item.tierCounts ?? {}) : null; } catch { return null; }
  });

  function readQuote(data: FormData): PoolQuote {
    const monthlyCents = Object.fromEntries(template.tiers.map((tier) => [tier, readAmountCents(String(data.get(`pool-rate-${tier}`) ?? ""))]));
    if (template.tiers.some((tier) => monthlyCents[tier] == null || monthlyCents[tier]! <= 0)) throw new Error("Enter a positive monthly price for every applicable tier, using up to two decimal places.");
    const earliest = String(data.get("earliestStartDate") ?? "");
    if (!earliest) throw new Error("Choose the earliest start date.");
    if (data.get("chemicalsIncluded") !== "yes" && data.get("chemicalsIncluded") !== "no") throw new Error("State whether chemicals are included.");
    if (!/^\d+$/.test(String(data.get("cancellationNoticeDays") ?? ""))) throw new Error("Enter the cancellation notice in whole days, including 0 if no notice is required.");
    const parsed = poolQuoteSchema.safeParse({ monthlyCents, chemicalsIncluded: data.get("chemicalsIncluded") === "yes", equipmentRepairsExcluded: data.get("repairsExcluded") === "on", earliestStartDate: new Date(`${earliest}T00:00:00.000Z`).toISOString(), routeDay: data.get("routeDay"), cancellationNoticeDays: Number(data.get("cancellationNoticeDays")) });
    if (!parsed.success) throw new Error("Check the pool quote prices, repair exclusion and cancellation terms.");
    return parsed.data;
  }

  function refreshPreview(event: FormEvent<HTMLFormElement>) {
    try { setTotal(calculatePoolTotal(template, readQuote(new FormData(event.currentTarget)), item.tierCounts ?? {})); }
    catch { setTotal(null); }
  }
  const validity = item.myBid?.validUntil ? new Date(new Date(item.myBid.validUntil).getTime() - new Date(item.myBid.validUntil).getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : "";

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled) return;
    const data = new FormData(event.currentTarget);
    setError(null);
    try {
      const valid = new Date(String(data.get("validUntil") ?? ""));
      if (!Number.isFinite(valid.getTime()) || valid.getTime() <= Date.now()) throw new Error("Choose a future bid validity deadline.");
      const quote = readQuote(data);
      calculatePoolTotal(template, quote, item.tierCounts ?? {});
      const scope = String(data.get("scope") ?? "").trim();
      if (!scope) throw new Error("Describe the included work.");
      onSubmit({ pricingBasis: "total", perHomeCents: null, poolQuote: quote,
        scope, exclusions: String(data.get("exclusions") ?? "").trim() || null,
        estimatedDurationLabel: null, cadenceLabel: null, proposedStartDate: quote.earliestStartDate,
        validUntil: valid.toISOString(), expectedBidVersion: item.myBid?.version,
      });
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Check the pool bid terms."); }
  }

  return <form className="mt-4 rounded-xl border border-[var(--border-warm)] p-4" onSubmit={submit} onChange={refreshPreview} aria-labelledby={`${id}-title`}>
    <h3 id={`${id}-title`} className="text-sm font-semibold">Pool-cleaning bid</h3>
    <p className="mt-1 text-xs leading-5 text-[var(--ink-500)]">{template.serviceMonths} calendar months · {template.visitsPerMonth} visits per month. Quote every applicable tier. Prices are monthly per home; the whole-job total is calculated from locked homes.</p>
    <fieldset disabled={disabled} className="mt-3 grid min-w-0 gap-3 sm:grid-cols-2">
      <legend className="sr-only">Pool quote terms</legend>
      {template.tiers.map((tier) => <label className="block text-xs" key={tier}>{POOL_TIER_LABELS[tier]} — USD /home/month<input className="mt-1" style={poolInputStyle} inputMode="decimal" type="text" name={`pool-rate-${tier}`} required value={prices[tier] ?? ""} onChange={(event) => setPrices((existing) => ({ ...existing, [tier]: event.target.value }))} /><span className="mt-1 block text-[var(--ink-500)]">{item.tierCounts?.[tier] ?? 0} locked homes</span></label>)}
      <div className="rounded-lg bg-[var(--cream-100)] p-3 text-sm sm:col-span-2" role="status" aria-live="polite"><span className="block text-xs">Derived whole-job total (all homes, full term)</span><strong>{total === null ? "Complete tier prices and quote terms to calculate" : formatPoolMoney(total, "usd")}</strong><p className="mt-1 text-xs text-[var(--ink-500)]">The server recalculates this total. No monthly amount is converted to a per-visit charge.</p></div>
      <label className="text-xs">Chemicals included?<select style={poolInputStyle} className="mt-1" name="chemicalsIncluded" defaultValue={current ? current.chemicalsIncluded ? "yes" : "no" : ""} required><option value="" disabled>Choose yes or no</option><option value="yes">Yes — included</option><option value="no">No — excluded</option></select></label>
      <label className="text-xs">Earliest start (UTC date)<input style={poolInputStyle} className="mt-1" name="earliestStartDate" type="date" required defaultValue={current?.earliestStartDate.slice(0, 10) ?? ""} /></label>
      <label className="text-xs">Route-day preference<select style={poolInputStyle} className="mt-1" name="routeDay" defaultValue={current?.routeDay ?? "flexible"}>{POOL_ROUTE_DAYS.map((day) => <option key={day} value={day}>{({ flexible: "Flexible", mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday" })[day]}</option>)}</select><span className="mt-1 block text-[var(--ink-500)]">Actual times are confirmed in the visit plan.</span></label>
      <label className="text-xs">Cancellation notice (days)<input style={poolInputStyle} className="mt-1" name="cancellationNoticeDays" type="number" min={0} max={90} step={1} required defaultValue={current?.cancellationNoticeDays ?? ""} /></label>
      <label className="text-xs">Bid valid until (your local time)<input style={poolInputStyle} className="mt-1" name="validUntil" type="datetime-local" required defaultValue={validity} /></label>
      <label className="flex min-h-11 items-center gap-2 text-xs"><input type="checkbox" name="repairsExcluded" required defaultChecked={current?.equipmentRepairsExcluded ?? false} />Equipment repairs are excluded</label>
      <label className="text-xs sm:col-span-2">Included work<textarea className="mt-1" style={poolInputStyle} name="scope" rows={2} required maxLength={2000} defaultValue={item.myBid?.scope ?? ""} /></label>
      <label className="text-xs sm:col-span-2">Other exclusions (optional)<input className="mt-1" style={poolInputStyle} name="exclusions" maxLength={2000} defaultValue={item.myBid?.exclusions ?? ""} /></label>
      {error && <p role="alert" className="text-sm text-red-700 sm:col-span-2">{error}</p>}
      <div className="sm:col-span-2"><Button type="submit" disabled={disabled} variant="warm">{disabled ? "Please wait…" : item.myBid ? "Update pool bid" : "Submit pool bid"}</Button></div>
    </fieldset>
  </form>;
}
