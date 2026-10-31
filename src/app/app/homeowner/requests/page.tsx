"use client";

import { useEffect, useState, type CSSProperties } from "react";
import Link from "next/link";

import type {
  HomeownerRequestEligibility,
  HomeownerRequestView,
} from "@/lib/server/homeowner-requests";

const cardStyle: CSSProperties = {
  background: "var(--bg-card)",
  border: "1px solid var(--border-warm)",
  borderRadius: 18,
  boxShadow: "var(--shadow-warm-sm)",
};

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  collecting_interest: "Collecting neighbours",
  open_for_bids: "Open for bids",
  bidding_closed: "Comparing bids",
  awarded: "Provider selected",
  scheduled: "Scheduled",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
  failed: "Not filled",
};

const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

function budgetLabel(request: HomeownerRequestView): string {
  const { budgetMinCents: min, budgetMaxCents: max } = request;
  if (min === null && max === null) return "Budget not provided";
  if (min === null) return `Up to ${currency.format(max! / 100)}`;
  if (max === null) return `From ${currency.format(min / 100)}`;
  return `${currency.format(min / 100)} – ${currency.format(max / 100)}`;
}

export default function HomeownerRequestsPage() {
  const [requests, setRequests] = useState<HomeownerRequestView[]>([]);
  const [eligibility, setEligibility] = useState<HomeownerRequestEligibility | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch("/api/homeowner/requests", {
          credentials: "same-origin",
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Could not load requests");
        const payload = (await response.json()) as {
          requests: HomeownerRequestView[];
          eligibility: HomeownerRequestEligibility;
        };
        if (!controller.signal.aborted) {
          setRequests(payload.requests);
          setEligibility(payload.eligibility);
        }
      } catch {
        if (!controller.signal.aborted) {
          setError("We could not load your requests. Check your connection and try again.");
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [attempt]);

  useEffect(() => {
    if (loading || error) return;
    function focusRequestedCard() {
      if (!window.location.hash.startsWith("#request-")) return;
      let requestId: string;
      try {
        requestId = decodeURIComponent(window.location.hash.slice("#request-".length));
      } catch {
        return;
      }
      // A hash can only target a record in this authenticated collection. It
      // never names a different endpoint or expands the server's owner scope.
      if (!requests.some((request) => request.id === requestId)) return;
      const card = document.getElementById(`request-${encodeURIComponent(requestId)}`);
      card?.focus({ preventScroll: true });
      card?.scrollIntoView?.({ block: "start" });
    }
    focusRequestedCard();
    window.addEventListener("hashchange", focusRequestedCard);
    return () => window.removeEventListener("hashchange", focusRequestedCard);
  }, [requests, loading, error]);

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-5 py-6 pb-24" style={{ fontFamily: "var(--font-body)" }}>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-[var(--ink-900)]">My requests</h1>
          <p className="mt-1 text-sm text-[var(--ink-600)]">Your recent service requests.</p>
        </div>
        {!loading && !error && eligibility?.canCreate ? (
          <Link href="/app/homeowner/request" className="bb-btn bb-btn-primary">New request</Link>
        ) : null}
      </header>

      {loading ? (
        <section className="p-5" style={cardStyle}>
          <p role="status" className="text-sm text-[var(--ink-600)]">Loading your requests…</p>
        </section>
      ) : error ? (
        <section className="space-y-3 p-5" style={cardStyle}>
          <p role="alert" className="text-sm text-[var(--danger-600)]">{error}</p>
          <button type="button" className="bb-btn bb-btn-primary" onClick={() => setAttempt((value) => value + 1)}>Try again</button>
        </section>
      ) : (
        <>
          {eligibility && !eligibility.canCreate ? (
            <section className="space-y-3 p-5" style={cardStyle}>
              <h2 className="font-semibold text-[var(--ink-900)]">About new requests</h2>
              <p className="text-sm text-[var(--ink-600)]">{eligibility.message}</p>
              <Link href={eligibility.actionPath} className="bb-btn bb-btn-primary">{eligibility.actionLabel}</Link>
            </section>
          ) : null}

          {requests.length === 0 ? (
            <section className="space-y-2 p-6 text-center" style={cardStyle}>
              <h2 className="text-lg font-semibold text-[var(--ink-900)]">No requests yet</h2>
              <p className="text-sm text-[var(--ink-600)]">
                {eligibility?.canCreate ? "Use New request to tell local providers what you need." : "Requests you have posted will appear here."}
              </p>
            </section>
          ) : requests.map((request) => (
            <article
              key={request.id}
              id={`request-${encodeURIComponent(request.id)}`}
              tabIndex={-1}
              aria-labelledby={`request-title-${encodeURIComponent(request.id)}`}
              className="scroll-mt-24 space-y-3 break-words p-5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--terracotta-600)]"
              style={cardStyle}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <h2 id={`request-title-${encodeURIComponent(request.id)}`} className="min-w-0 text-lg font-semibold text-[var(--ink-900)]">{request.title}</h2>
                <span className="rounded-full bg-[var(--terracotta-50)] px-3 py-1 text-xs font-semibold text-[var(--terracotta-600)]">
                  {STATUS_LABELS[request.status] ?? request.status.replace(/_/g, " ")}
                </span>
              </div>
              <p className="text-sm text-[var(--ink-600)]">{request.categoryLabel} · {request.communityName}</p>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--ink-700)]">{request.description}</p>
              <dl className="flex flex-wrap gap-x-8 gap-y-3 text-sm">
                <div><dt className="text-[var(--ink-500)]">Budget</dt><dd className="font-medium text-[var(--ink-900)]">{budgetLabel(request)}</dd></div>
                <div><dt className="text-[var(--ink-500)]">Bids</dt><dd className="font-medium text-[var(--ink-900)]">{request.bidCount}</dd></div>
              </dl>
            </article>
          ))}
        </>
      )}
    </div>
  );
}
