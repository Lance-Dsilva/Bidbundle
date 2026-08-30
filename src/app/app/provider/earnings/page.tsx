"use client";

import type { CSSProperties } from "react";

import { EmptyState } from "@/components/ui/EmptyState";
import { useProviderEarnings } from "@/hooks/useProviderEarnings";

/**
 * Provider earnings, from awarded agreements.
 *
 * Every figure is the value of work this account actually won: the amount
 * snapshotted onto the agreement at award time, which no later bid edit can
 * change. Bundleen holds no payment rails yet, so this reports the value of
 * completed and active work rather than pretending to be a payout balance.
 */

const card: CSSProperties = {
  background: "var(--bg-card)",
  border: "1px solid var(--border-warm)",
  borderRadius: 18,
  boxShadow: "var(--shadow-warm-sm)",
};

export default function ProviderEarningsPage() {
  const { earnings, loading, error, fmt } = useProviderEarnings();

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-4xl px-4 py-6">
        <p className="text-sm" style={{ color: "var(--ink-400)" }}>
          Loading your earnings…
        </p>
      </div>
    );
  }

  if (error || !earnings) {
    return (
      <div className="mx-auto w-full max-w-4xl px-4 py-6">
        <p className="rounded-xl px-4 py-3 text-sm" role="alert" style={{ background: "#fef2f2", color: "#b91c1c" }}>
          {error ?? "We could not load your earnings."}
        </p>
      </div>
    );
  }

  const tiles = [
    { label: "Completed work", value: fmt(earnings.earnedCents) },
    { label: "Active agreements", value: fmt(earnings.pendingCents) },
    { label: "Completed this month", value: fmt(earnings.thisMonthCents) },
    { label: "Average job", value: fmt(earnings.averageJobCents) },
  ];

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6">
      <header className="mb-4">
        <h1 className="text-lg font-semibold" style={{ color: "var(--ink-900)" }}>
          Earnings
        </h1>
        <p className="mt-1 text-sm" style={{ color: "var(--ink-400)" }}>
          {earnings.completedJobs} completed · {earnings.activeJobs} active ·{" "}
          {earnings.completedVisits} visits finished.
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((tile) => (
          <div className="p-4" key={tile.label} style={card}>
            <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--ink-400)" }}>
              {tile.label}
            </p>
            <p className="mt-1 text-xl font-semibold" style={{ color: "var(--ink-900)" }}>
              {tile.value}
            </p>
          </div>
        ))}
      </div>

      <h2 className="mt-6 text-sm font-semibold" style={{ color: "var(--ink-900)" }}>
        Recent agreements
      </h2>

      {earnings.recent.length === 0 ? (
        <div className="mt-2">
          <EmptyState
            ctaHref="/app/provider/job-feed"
            ctaLabel="Find work to bid on"
            hint="Win a job and its agreed value appears here."
            icon={<span aria-hidden>💷</span>}
            title="No agreements yet"
          />
        </div>
      ) : (
        <ul className="mt-2 space-y-2">
          {earnings.recent.map((entry) => (
            <li className="p-4" key={entry.agreementId} style={card}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium" style={{ color: "var(--ink-900)" }}>
                    {entry.requestTitle}
                  </p>
                  <p className="text-xs" style={{ color: "var(--ink-400)" }}>
                    {entry.communityName} ·{" "}
                    {entry.context === "hoa" ? "HOA" : "Neighbourhood"} ·{" "}
                    {entry.startDate
                      ? new Date(entry.startDate).toLocaleDateString()
                      : "date to be set"}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold" style={{ color: "var(--ink-900)" }}>
                    {fmt(entry.amountCents)}
                  </p>
                  <p className="text-xs" style={{ color: "var(--ink-400)" }}>
                    {entry.status}
                  </p>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
