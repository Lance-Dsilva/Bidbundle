"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { BidSummary, ResidentHoaHub, VisitSummary } from "@/lib/hoa-types";

async function post(path: string, body: unknown) {
  const response = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = (await response.json().catch(() => null)) as { error?: string } | null;
  if (!response.ok) throw new Error(result?.error ?? "Something went wrong. Please try again.");
}

function money(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}

function dateLabel(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString() : "—";
}

const REQUEST_STATUS_LABEL: Record<string, string> = {
  collecting_interest: "Collecting interest",
  open_for_bids: "Open for bids",
  bidding_closed: "Bidding closed",
  awarded: "Provider selected",
  scheduled: "Scheduled",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
  failed: "Failed",
};

export function ResidentHoaWorkspace({ hub }: { hub: ResidentHoaHub }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (hub.communities.length === 0) return null;

  const run = async (key: string, action: () => Promise<void>, successText?: string) => {
    if (busy) return;
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      await action();
      if (successText) setNotice(successText);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-6">
      {error ? (
        <p className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="rounded-xl bg-green-50 px-4 py-3 text-sm font-medium text-green-700" role="status">
          {notice}
        </p>
      ) : null}
      {hub.communities.map((community) => (
        <section className="bb-card bb-card-pad" key={community.id}>
          <div className="bb-card-header">
            <div>
              <span className="bb-eyebrow">Official HOA</span>
              <h2 className="bb-card-title">{community.name}</h2>
              <p className="bb-card-copy">
                {community.unitLabel ? `Your home: ${community.unitLabel}. ` : ""}
                Community services, transparent bids, your visit schedule, and resident surveys.
              </p>
            </div>
          </div>

          {/* ── My visits ─────────────────────────────────────────────── */}
          {community.myVisits.length > 0 ? (
            <>
              <h3 className="mt-6 text-sm font-bold text-[var(--ink-900)]">Your upcoming & recent visits</h3>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                {community.myVisits.slice(0, 6).map((visit) => (
                  <VisitCard
                    key={visit.id}
                    visit={visit}
                    busy={busy}
                    onReview={(rating, comment) =>
                      void run(
                        `review-${visit.id}`,
                        () => post(`/api/hoa/visits/${visit.id}/review`, { rating, comment }),
                        "Review submitted — thank you.",
                      )
                    }
                  />
                ))}
              </div>
            </>
          ) : null}

          {/* ── Requests ──────────────────────────────────────────────── */}
          <h3 className="mt-6 text-sm font-bold text-[var(--ink-900)]">Community service requests</h3>
          {community.requests.length === 0 ? (
            <Empty text="Your HOA manager has not opened a service request yet." />
          ) : (
            <div className="mt-3 space-y-3">
              {community.requests.map((request) => {
                const bids = community.bidsByRequest[request.id] ?? [];
                const winner = bids.find((bid) => bid.status === "accepted");
                const joinOpen =
                  request.kind === "optional_group" &&
                  request.status === "collecting_interest" &&
                  !request.participantsLockedAt;
                return (
                  <article className="rounded-xl border p-4" style={{ borderColor: "var(--line)" }} key={request.id}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--teal-800)]">
                          {request.category}
                        </p>
                        <h4 className="mt-1 text-sm font-semibold text-[var(--ink-900)]">{request.title}</h4>
                      </div>
                      <span className="rounded-full bg-[var(--teal-50)] px-2 py-1 text-[10px] font-bold uppercase text-[var(--teal-800)]">
                        {REQUEST_STATUS_LABEL[request.status] ?? request.status}
                      </span>
                    </div>
                    <p className="mt-2 text-xs leading-5 text-[var(--muted)]">{request.description}</p>

                    {request.kind === "compulsory_recurring" ? (
                      <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                        HOA compulsory · {request.recurrenceLabel} · every eligible home is included
                      </p>
                    ) : (
                      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                        <span className="text-xs text-[var(--muted)]">
                          {request.joinedCount} joined
                          {request.enrollmentClosesAt
                            ? ` · enrollment closes ${dateLabel(request.enrollmentClosesAt)}`
                            : ""}
                        </span>
                        {joinOpen ? (
                          <span className="flex gap-2">
                            <button
                              className="h-9 rounded-xl bg-[var(--teal-800)] px-4 text-xs font-semibold text-white disabled:opacity-60"
                              disabled={busy !== null || request.viewerResponse === "joined"}
                              onClick={() =>
                                void run(`join-${request.id}`, () =>
                                  post(`/api/hoa/requests/${request.id}/join`, { response: "joined" }),
                                )
                              }
                              type="button"
                            >
                              {request.viewerResponse === "joined" ? "Joined" : "Join"}
                            </button>
                            <button
                              className="h-9 rounded-xl border px-4 text-xs font-semibold text-[var(--muted)] disabled:opacity-60"
                              style={{ borderColor: "var(--line)" }}
                              disabled={busy !== null || request.viewerResponse === "declined"}
                              onClick={() =>
                                void run(`decline-${request.id}`, () =>
                                  post(`/api/hoa/requests/${request.id}/join`, { response: "declined" }),
                                )
                              }
                              type="button"
                            >
                              {request.viewerResponse === "declined" ? "Declined" : "Decline"}
                            </button>
                          </span>
                        ) : request.viewerResponse ? (
                          <span className="text-xs font-semibold text-[var(--teal-800)]">
                            You {request.viewerResponse}
                            {request.participantsLockedAt ? " (locked)" : ""}
                          </span>
                        ) : null}
                      </div>
                    )}

                    {bids.length > 0 ? <BidList bids={bids} winner={winner} /> : null}
                  </article>
                );
              })}
            </div>
          )}

          {/* ── Surveys ───────────────────────────────────────────────── */}
          <h3 className="mt-7 text-sm font-bold text-[var(--ink-900)]">Monthly resident surveys</h3>
          {community.surveys.length === 0 ? (
            <Empty text="No resident survey is open right now." />
          ) : (
            <div className="mt-3 space-y-3">
              {community.surveys.map((survey) => (
                <article className="rounded-xl border p-4" style={{ borderColor: "var(--line)" }} key={survey.id}>
                  <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--teal-800)]">
                    {survey.monthKey}
                  </p>
                  <h4 className="mt-1 text-sm font-semibold text-[var(--ink-900)]">{survey.question}</h4>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {survey.options.map((option, index) => (
                      <button
                        className="flex items-center justify-between rounded-xl border px-3 py-2 text-left text-xs disabled:opacity-70"
                        style={{
                          borderColor:
                            survey.viewerOptionIndex === index ? "var(--teal-800)" : "var(--line)",
                          background:
                            survey.viewerOptionIndex === index ? "var(--teal-50)" : "var(--paper)",
                        }}
                        disabled={survey.status !== "open" || busy !== null}
                        key={option}
                        onClick={() =>
                          void run(`survey-${survey.id}-${index}`, () =>
                            post(`/api/hoa/surveys/${survey.id}/vote`, { optionIndex: index }),
                          )
                        }
                        type="button"
                      >
                        <span>{option}</span>
                        <strong>{survey.voteCounts[index]}</strong>
                      </button>
                    ))}
                  </div>
                  {survey.viewerOptionIndex !== null ? (
                    <p className="mt-2 text-xs font-medium text-green-700">
                      Your vote is recorded. You may change it while the survey is open.
                    </p>
                  ) : null}
                </article>
              ))}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}

function BidList({ bids, winner }: { bids: BidSummary[]; winner: BidSummary | undefined }) {
  return (
    <div className="mt-3 rounded-lg bg-[var(--canvas)] p-3">
      <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--muted)]">
        Provider bids — full transparency
      </p>
      <ul className="mt-2 space-y-2">
        {bids.map((bid) => (
          <li
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[var(--paper)] px-3 py-2 text-xs"
            key={bid.id}
          >
            <span className="min-w-0">
              <strong className="text-[var(--ink-900)]">{bid.providerCompany ?? bid.providerName}</strong>
              {bid.providerVerified ? (
                <span className="ml-1 rounded-full bg-green-100 px-1.5 py-0.5 text-[9px] font-bold uppercase text-green-700">
                  Verified
                </span>
              ) : null}
              <span className="ml-2 text-[var(--muted)]">
                {money(bid.amountCents, bid.currency)}{" "}
                {bid.pricingBasis === "per_home" ? "per home" : bid.pricingBasis === "per_visit" ? "per visit" : "total"}
                {bid.proposedStartDate ? ` · starts ${dateLabel(bid.proposedStartDate)}` : ""}
              </span>
            </span>
            {bid.status === "accepted" ? (
              <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-bold uppercase text-green-700">
                Winner
              </span>
            ) : bid.status === "rejected" && winner ? (
              <span className="rounded-full bg-[var(--canvas)] px-2 py-0.5 text-[10px] font-bold uppercase text-[var(--muted)]">
                Not selected
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function VisitCard({
  visit,
  busy,
  onReview,
}: {
  visit: VisitSummary;
  busy: string | null;
  onReview: (rating: number, comment: string) => void;
}) {
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const [showReview, setShowReview] = useState(false);

  return (
    <article className="rounded-xl border p-4" style={{ borderColor: "var(--line)" }}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-[var(--ink-900)]">{dateLabel(visit.scheduledDate)}</p>
        <span className="rounded-full bg-[var(--teal-50)] px-2 py-1 text-[10px] font-bold uppercase text-[var(--teal-800)]">
          {visit.status.replace("_", " ")}
        </span>
      </div>
      <p className="mt-1 text-xs text-[var(--muted)]">
        {visit.unitLabel}
        {visit.windowStart ? ` · window ${visit.windowStart}–${visit.windowEnd ?? ""}` : ""}
      </p>
      {visit.status === "completed" ? (
        showReview ? (
          <form
            className="mt-3 space-y-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (comment.trim()) onReview(rating, comment.trim());
            }}
          >
            <div className="flex gap-2">
              <select
                aria-label="Rating"
                className="h-9 rounded-lg border px-2 text-xs"
                style={{ borderColor: "var(--line)" }}
                onChange={(event) => setRating(Number(event.currentTarget.value))}
                value={rating}
              >
                {[5, 4, 3, 2, 1].map((value) => (
                  <option key={value} value={value}>
                    {value}★
                  </option>
                ))}
              </select>
              <input
                className="h-9 min-w-0 flex-1 rounded-lg border px-3 text-xs"
                style={{ borderColor: "var(--line)" }}
                onChange={(event) => setComment(event.currentTarget.value)}
                placeholder="How did it go?"
                required
                value={comment}
              />
            </div>
            <button
              className="h-9 w-full rounded-lg bg-[var(--teal-800)] text-xs font-semibold text-white disabled:opacity-60"
              disabled={busy !== null}
              type="submit"
            >
              Submit review
            </button>
          </form>
        ) : (
          <button
            className="mt-3 h-9 rounded-lg border px-3 text-xs font-semibold text-[var(--teal-800)]"
            style={{ borderColor: "var(--line)" }}
            onClick={() => setShowReview(true)}
            type="button"
          >
            Review this visit
          </button>
        )
      ) : null}
    </article>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="mt-3 rounded-xl bg-[var(--canvas)] px-4 py-4 text-sm text-[var(--muted)]">{text}</p>;
}
