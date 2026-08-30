"use client";

import { useMemo, useState, type CSSProperties } from "react";

import { EmptyState } from "@/components/ui/EmptyState";
import { useProviderMarketplace } from "@/hooks/useProviderMarketplace";

/**
 * Provider "My Bids": every quote this account has submitted, with its real
 * status from the marketplace.
 *
 * One source — `/api/provider/marketplace` — shared with the job feed and the
 * schedule, so a bid that was accepted cannot show as pending on one page and
 * won on another.
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
  withdrawn: { background: "var(--cream-100)", color: "var(--ink-400)" },
  expired: { background: "var(--cream-100)", color: "var(--ink-400)" },
  draft: { background: "var(--cream-100)", color: "var(--ink-400)" },
};

const FILTERS = ["all", "submitted", "accepted", "rejected"] as const;

function money(cents: number): string {
  return `$${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export default function ProviderBidsPage() {
  const { workspace, loading, error } = useProviderMarketplace();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("all");

  // The feed already carries each open request's title; agreements carry the
  // rest. Titles are looked up from what the same payload returned rather than
  // fetched again.
  const titles = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of workspace?.feed ?? []) map.set(item.requestId, item.title);
    for (const agreement of workspace?.agreements ?? []) {
      map.set(agreement.requestId, agreement.requestTitle);
    }
    return map;
  }, [workspace]);

  const bids = useMemo(
    () => (workspace?.bids ?? []).filter((bid) => filter === "all" || bid.status === filter),
    [workspace, filter],
  );

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-4xl px-4 py-6">
        <p className="text-sm" style={{ color: "var(--ink-400)" }}>
          Loading your bids…
        </p>
      </div>
    );
  }

  if (error || !workspace) {
    return (
      <div className="mx-auto w-full max-w-4xl px-4 py-6">
        <p className="rounded-xl px-4 py-3 text-sm" role="alert" style={{ background: "#fef2f2", color: "#b91c1c" }}>
          {error ?? "We could not load your bids."}
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
          {workspace.bids.length} {workspace.bids.length === 1 ? "quote" : "quotes"} submitted.
        </p>
      </header>

      <div className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map((value) => (
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

      {bids.length === 0 ? (
        <EmptyState
          ctaHref="/app/provider/job-feed"
          ctaLabel="Browse available work"
          hint="Bids you submit from the job feed appear here with their live status."
          icon={<span aria-hidden>📄</span>}
          title="No bids here yet"
        />
      ) : (
        <ul className="space-y-3">
          {bids.map((bid) => (
            <li className="p-4" key={bid.id} style={card}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold" style={{ color: "var(--ink-900)" }}>
                    {titles.get(bid.requestId) ?? "Service request"}
                  </p>
                  <p className="mt-1 text-xs" style={{ color: "var(--ink-400)" }}>
                    {money(bid.amountCents)} · {bid.pricingBasis.replace("_", " ")} · version{" "}
                    {bid.version} · submitted{" "}
                    {new Date(bid.submittedAt).toLocaleDateString()}
                  </p>
                </div>
                <span
                  className="rounded-full px-3 py-1 text-xs font-semibold"
                  style={STATUS_TONES[bid.status] ?? STATUS_TONES.draft}
                >
                  {bid.status}
                </span>
              </div>
              <p className="mt-2 text-xs" style={{ color: "var(--ink-700)" }}>
                {bid.scope}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
