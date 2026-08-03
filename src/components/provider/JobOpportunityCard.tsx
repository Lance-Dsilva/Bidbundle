"use client";

import { useState } from "react";

import type { JobOpportunity } from "@/data/mock/mockProviderDashboard";

interface JobOpportunityCardProps {
  job: JobOpportunity;
}

export function JobOpportunityCard({ job }: JobOpportunityCardProps) {
  const isLive = job.status === "live";
  const [notified, setNotified] = useState(false);
  const [bidding, setBidding] = useState(false);
  const [bidSubmitted, setBidSubmitted] = useState(false);

  function handleSubmitBid() {
    setBidding(true);
    window.setTimeout(() => {
      setBidding(false);
      setBidSubmitted(true);
    }, 700);
  }

  return (
    <article className="rounded-card bg-card p-4 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">{job.title}</p>
          <p className="mt-0.5 text-xs text-muted">
            {job.neighborsJoined} neighbors · {job.neighborhood}
          </p>
          <p className="mt-1 text-base font-bold text-foreground">
            ${job.budgetMin}–${job.budgetMax}
          </p>
        </div>
        <span
          className={`mt-0.5 shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${
            isLive ? "bg-accent/15 text-accent" : "bg-muted/15 text-muted"
          }`}
        >
          {isLive ? "LIVE" : "UPCOMING"}
        </span>
      </div>

      {!isLive && job.countdown ? (
        <p className="mt-2 text-xs text-muted">⏱ Opens in {job.countdown}</p>
      ) : null}

      {isLive && bidSubmitted ? (
        <div className="mt-3 flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2.5">
          <svg className="h-4 w-4 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.2">
            <path strokeLinecap="round" strokeLinejoin="round" d="m5 12 5 5L19 8" />
          </svg>
          <span className="text-sm font-semibold text-emerald-700">Bid submitted!</span>
        </div>
      ) : isLive ? (
        <button
          className="mt-3 flex h-10 w-full items-center justify-center gap-1.5 rounded-xl bg-primary text-sm font-semibold text-white shadow-sm transition-all duration-150 hover:bg-blue-600 active:scale-[0.98] disabled:opacity-60"
          type="button"
          disabled={bidding}
          onClick={handleSubmitBid}
        >
          {bidding ? "Submitting…" : (
            <>
              Submit bid
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="m9 18 6-6-6-6" />
              </svg>
            </>
          )}
        </button>
      ) : (
        <button
          className={`mt-3 flex h-10 w-full items-center justify-center gap-1.5 rounded-xl border text-sm font-semibold transition-all duration-150 active:scale-[0.98] ${
            notified
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-accent/30 bg-accent/8 text-accent hover:bg-accent/15"
          }`}
          type="button"
          onClick={() => setNotified(true)}
        >
          {notified ? "✓ You'll be notified" : "Notify me when bidding opens"}
        </button>
      )}
    </article>
  );
}
