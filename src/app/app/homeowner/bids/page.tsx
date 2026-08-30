"use client";

import { useMemo, useState, type CSSProperties } from "react";

import { EmptyState } from "@/components/ui/EmptyState";
import { useHomeownerBids } from "@/hooks/useHomeownerBids";
import { useNeighbourhood } from "@/hooks/useNeighbourhood";

/**
 * Homeowner "My Bids": the quotes providers have sent for requests this
 * account opened or joined.
 *
 * Transparent by design — every participant sees the same comparison — but
 * only the neighbourhood manager can accept one, and only once bidding has
 * closed. `canAward` comes from the server; the award endpoint checks it
 * again, so the button's absence is a courtesy and its presence is not
 * permission.
 */

const card: CSSProperties = {
  background: "var(--bg-card)",
  border: "1px solid var(--border-warm)",
  borderRadius: 18,
  boxShadow: "var(--shadow-warm-sm)",
};

const STATUS_TONES: Record<string, CSSProperties> = {
  submitted: { background: "var(--gold-50)", color: "var(--gold-600)" },
  accepted: { background: "#dcfce7", color: "#15803d" },
  rejected: { background: "#fee2e2", color: "#b91c1c" },
};

function money(cents: number): string {
  return `$${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export default function HomeownerBidsPage() {
  const { bids, loading, error, refresh } = useHomeownerBids();
  const { act, busy, missingAddresses, error: actionError } = useNeighbourhood();
  const [filter, setFilter] = useState<"all" | "submitted" | "accepted">("all");

  const visible = useMemo(
    () => bids.filter((bid) => filter === "all" || bid.status === filter),
    [bids, filter],
  );

  const award = async (requestId: string, bidId: string) => {
    const ok = await act({ kind: "award", requestId, bidId });
    if (ok) await refresh();
  };

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-4xl px-4 py-6">
        <p className="text-sm" style={{ color: "var(--ink-400)" }}>
          Loading your quotes…
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6">
      <header className="mb-4">
        <h1 className="text-lg font-semibold" style={{ color: "var(--ink-900)" }}>
          My bids
        </h1>
        <p className="mt-1 text-sm" style={{ color: "var(--ink-400)" }}>
          Quotes on requests you opened or joined.
        </p>
      </header>

      {error || actionError ? (
        <p className="mb-4 rounded-xl px-4 py-3 text-sm" role="alert" style={{ background: "#fef2f2", color: "#b91c1c" }}>
          {error ?? actionError}
        </p>
      ) : null}

      {missingAddresses ? (
        <div
          className="mb-4 rounded-xl px-4 py-3 text-sm"
          role="alert"
          style={{ background: "#fffbeb", color: "#92400e" }}
        >
          Nothing was awarded: {missingAddresses.names.join(", ")}{" "}
          {missingAddresses.count === 1 ? "has" : "have"} no home address on file yet.
        </div>
      ) : null}

      <div className="mb-4 flex flex-wrap gap-2">
        {(["all", "submitted", "accepted"] as const).map((value) => (
          <button
            className="rounded-full px-3 py-1 text-xs font-semibold"
            key={value}
            onClick={() => setFilter(value)}
            style={
              value === filter
                ? { background: "var(--terracotta-600)", color: "white" }
                : { background: "var(--cream-100)", color: "var(--ink-700)" }
            }
            type="button"
          >
            {value === "all" ? "All" : value}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <EmptyState
          ctaHref="/app/homeowner/request"
          ctaLabel="Open a request"
          hint="When providers quote on a request you opened or joined, their bids appear here side by side."
          icon={<span aria-hidden>💬</span>}
          title="No quotes yet"
        />
      ) : (
        <ul className="space-y-3">
          {visible.map((bid) => (
            <li className="p-4" key={bid.id} style={card}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold" style={{ color: "var(--ink-900)" }}>
                    {bid.requestTitle}
                  </p>
                  <p className="mt-1 text-xs" style={{ color: "var(--ink-400)" }}>
                    {bid.providerCompany ?? bid.providerName}
                    {bid.providerVerified ? " · verified" : ""} · {money(bid.amountCents)} ·{" "}
                    {bid.pricingBasis.replace("_", " ")}
                  </p>
                </div>
                <span
                  className="rounded-full px-3 py-1 text-xs font-semibold"
                  style={STATUS_TONES[bid.status] ?? { background: "var(--cream-100)", color: "var(--ink-400)" }}
                >
                  {bid.status}
                </span>
              </div>
              <p className="mt-2 text-xs" style={{ color: "var(--ink-700)" }}>
                {bid.scope}
              </p>
              {bid.canAward ? (
                <button
                  className="mt-3 rounded-lg px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"
                  disabled={busy}
                  onClick={() => void award(bid.requestId, bid.id)}
                  style={{ background: "var(--terracotta-600)" }}
                  type="button"
                >
                  Award this provider
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
