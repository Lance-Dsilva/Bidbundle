"use client";

import { useMemo, useState, type CSSProperties, type FormEvent } from "react";

import { Button } from "@/components/ui/Button";
import type { ProviderFeedItem } from "@/lib/hoa-types";
import { apiFetch } from "@/lib/api";
import { serviceCategoryLabel } from "@/lib/service-categories";
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

export function ProviderMarketplaceFeed() {
  const { workspace, loading, error, refresh } = useProviderMarketplace();
  const [trade, setTrade] = useState("all");
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyRequestId, setBusyRequestId] = useState<string | null>(null);

  const trades = useMemo(() => {
    const values = new Set((workspace?.feed ?? []).map((item) => item.category));
    return ["all", ...[...values].sort()];
  }, [workspace]);

  const visible = useMemo(
    () =>
      (workspace?.feed ?? []).filter((item) => trade === "all" || item.category === trade),
    [workspace, trade],
  );

  const submitBid = async (requestId: string, body: Record<string, unknown>) => {
    setBusyRequestId(requestId);
    setActionError(null);
    try {
      await apiFetch(`/provider/marketplace/requests/${requestId}/bid`, {
        method: "PUT",
        body: JSON.stringify(body),
      });
      await refresh();
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "Your bid was not saved.");
    } finally {
      setBusyRequestId(null);
    }
  };

  const withdrawBid = async (requestId: string) => {
    setBusyRequestId(requestId);
    setActionError(null);
    try {
      await apiFetch(`/provider/marketplace/requests/${requestId}/bid`, { method: "DELETE" });
      await refresh();
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "Your bid was not withdrawn.");
    } finally {
      setBusyRequestId(null);
    }
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

      {actionError ? (
        <p className="rounded-xl px-4 py-3 text-sm" role="alert" style={{ background: "#fef2f2", color: "#b91c1c" }}>
          {actionError}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {trades.map((value) => (
          <button
            className="rounded-full px-3 py-1 text-xs font-semibold"
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
            busy={busyRequestId === item.requestId}
            canBid={workspace.eligible}
            item={item}
            key={item.requestId}
            onSubmit={(body) => void submitBid(item.requestId, body)}
            onWithdraw={() => void withdrawBid(item.requestId)}
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
  onSubmit,
  onWithdraw,
}: {
  item: ProviderFeedItem;
  canBid: boolean;
  busy: boolean;
  onSubmit: (body: Record<string, unknown>) => void;
  onWithdraw: () => void;
}) {
  const [open, setOpen] = useState(false);

  const handle = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const amount = Number(String(data.get("amount") ?? ""));
    if (!Number.isFinite(amount) || amount < 0) return;
    onSubmit({
      // Dollars in the form, whole cents on the wire — the one money unit the
      // marketplace stores.
      amountCents: Math.round(amount * 100),
      pricingBasis: String(data.get("pricingBasis") ?? "total"),
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
    <article className="p-5" style={card}>
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
          <dt>Visits</dt>
          <dd style={{ color: "var(--ink-900)" }}>{item.totalOccurrences}</dd>
        </div>
      </dl>

      {item.myBid ? (
        <div className="mt-3 rounded-xl p-3" style={{ background: "var(--cream-100)" }}>
          <p className="text-xs" style={{ color: "var(--ink-700)" }}>
            Your bid: <strong>{money(item.myBid.amountCents)}</strong> ({item.myBid.status}, version{" "}
            {item.myBid.version})
          </p>
        </div>
      ) : null}

      {canBid ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button disabled={busy} onClick={() => setOpen((current) => !current)} variant="warm">
            {item.myBid ? "Revise bid" : "Submit bid"}
          </Button>
          {item.myBid && item.myBid.status === "submitted" ? (
            <Button disabled={busy} onClick={onWithdraw} variant="ghost">
              Withdraw
            </Button>
          ) : null}
        </div>
      ) : null}

      {open && canBid ? (
        <form className="mt-3 grid gap-3 sm:grid-cols-2" onSubmit={handle}>
          <label className="block text-xs" style={{ color: "var(--ink-700)" }}>
            Amount (USD)
            <input
              defaultValue={item.myBid ? (item.myBid.amountCents / 100).toString() : ""}
              min="0"
              name="amount"
              required
              step="0.01"
              style={input}
              type="number"
            />
          </label>
          <label className="block text-xs" style={{ color: "var(--ink-700)" }}>
            Pricing basis
            <select
              defaultValue={item.myBid?.pricingBasis ?? "total"}
              name="pricingBasis"
              style={input}
            >
              <option value="total">Total</option>
              <option value="per_home">Per home</option>
              <option value="per_visit">Per visit</option>
            </select>
          </label>
          <label className="block text-xs sm:col-span-2" style={{ color: "var(--ink-700)" }}>
            What is included
            <textarea
              defaultValue={item.myBid?.scope ?? ""}
              name="scope"
              required
              rows={3}
              style={input}
            />
          </label>
          <label className="block text-xs" style={{ color: "var(--ink-700)" }}>
            Exclusions (optional)
            <input defaultValue={item.myBid?.exclusions ?? ""} name="exclusions" style={input} />
          </label>
          <label className="block text-xs" style={{ color: "var(--ink-700)" }}>
            Estimated duration (optional)
            <input
              defaultValue={item.myBid?.estimatedDurationLabel ?? ""}
              name="duration"
              placeholder="Half a day"
              style={input}
            />
          </label>
          <div className="sm:col-span-2">
            <Button disabled={busy} type="submit" variant="warm">
              {busy ? "Sending…" : item.myBid ? "Update bid" : "Send bid"}
            </Button>
          </div>
        </form>
      ) : null}
    </article>
  );
}
