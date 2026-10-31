"use client";

import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type FormEvent } from "react";

import { BidPrice, LegacyBidNotice } from "@/components/ui/BidPrice";
import { Button } from "@/components/ui/Button";
import type { ProviderFeedItem } from "@/lib/hoa-types";
import { apiFetch } from "@/lib/api";
import { serviceCategoryLabel } from "@/lib/service-categories";
import { MAX_BID_AMOUNT_CENTS } from "@/lib/validation/hoa";
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
          <BidPrice bid={item.myBid} homeCount={item.homeCount} totalOccurrences={item.totalOccurrences} />
          {item.myBid.pricingBasis !== "total" && item.myBid.status === "submitted" ? <LegacyBidNotice requestStatus="open_for_bids" /> : null}
        </div>
      ) : null}

      {canBid ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button disabled={writesBlocked} onClick={() => setOpen((current) => !current)} variant="warm">
            {item.myBid ? "Revise bid" : "Submit bid"}
          </Button>
          {item.myBid && item.myBid.status === "submitted" ? (
            <Button disabled={writesBlocked} onClick={() => { actionFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; onWithdraw(); }} variant="ghost">
              Withdraw
            </Button>
          ) : null}
        </div>
      ) : null}

      {open && canBid ? (
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
