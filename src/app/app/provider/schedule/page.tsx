"use client";

import { useMemo, useRef, useState, type CSSProperties } from "react";

import { ConfirmAction } from "@/components/ui/ConfirmAction";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { apiFetch } from "@/lib/api";
import type { AgreementSummary, OccurrenceSummary, VisitSummary } from "@/lib/hoa-types";
import { useProviderMarketplace } from "@/hooks/useProviderMarketplace";

/**
 * Provider schedule: the day plans for agreements this account actually won.
 *
 * Only the awarded provider ever reaches these stops — the server checks that
 * on every read and every write, so the ordering controls here are a
 * convenience rather than the boundary. Publishing a plan notifies each home
 * about its own window only; nobody receives the route.
 *
 * The previous version called `/provider/schedule`, which had no handler, and
 * kept locally-invented appointments that no crew could have been dispatched
 * from.
 */

const card: CSSProperties = {
  background: "var(--bg-card)",
  border: "1px solid var(--border-warm)",
  borderRadius: 18,
  boxShadow: "var(--shadow-warm-sm)",
};

const NEXT_STATUSES: Record<string, string[]> = {
  scheduled: ["en_route", "in_progress", "completed", "skipped", "blocked"],
  en_route: ["in_progress", "completed", "skipped", "blocked"],
  in_progress: ["completed", "skipped", "blocked"],
};

export default function ProviderSchedulePage() {
  const { workspace, loading, error, refresh } = useProviderMarketplace();
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const [confirmation, setConfirmation] = useState<{
    agreementId: string; occurrenceId: string; visitId: string; previousStatus: string;
    status: "completed" | "skipped" | "blocked"; stopLabel: string; serviceDate: string; title: string;
  } | null>(null);
  const currentOccurrence = confirmation ? workspace?.occurrencesByAgreement[confirmation.agreementId]?.find((item) => item.id === confirmation.occurrenceId) : null;
  const currentVisit = confirmation ? currentOccurrence?.visits.find((visit) => visit.id === confirmation.visitId) : null;
  const validConfirmation = Boolean(confirmation && currentVisit && currentVisit.status === confirmation.previousStatus &&
    currentVisit.stopLabel === confirmation.stopLabel && currentOccurrence?.serviceDate === confirmation.serviceDate &&
    workspace?.agreements.some((agreement) => agreement.id === confirmation.agreementId && agreement.status === "active") &&
    (NEXT_STATUSES[currentVisit.status] ?? []).includes(confirmation.status));


  const agreementsById = useMemo(() => {
    const map = new Map<string, AgreementSummary>();
    for (const agreement of workspace?.agreements ?? []) map.set(agreement.id, agreement);
    return map;
  }, [workspace]);

  const call = async (path: string, body: unknown) => {
    if (inFlight.current) return false;
    inFlight.current = true;
    setBusy(true);
    setActionError(null);
    try {
      await apiFetch(path, { method: "POST", body: JSON.stringify(body) });
      await refresh();
      return true;
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "That change was not saved.");
      return false;
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-4xl px-4 py-6">
        <p className="text-sm" style={{ color: "var(--ink-400)" }}>
          Loading your schedule…
        </p>
      </div>
    );
  }

  if (error || !workspace) {
    return (
      <div className="mx-auto w-full max-w-4xl px-4 py-6">
        <p className="rounded-xl px-4 py-3 text-sm" role="alert" style={{ background: "#fef2f2", color: "#b91c1c" }}>
          {error ?? "We could not load your schedule."}
        </p>
      </div>
    );
  }

  const entries = Object.entries(workspace.occurrencesByAgreement);

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6">
      <header className="mb-4">
        <h1 className="text-lg font-semibold" style={{ color: "var(--ink-900)" }}>
          Schedule
        </h1>
        <p className="mt-1 text-sm" style={{ color: "var(--ink-400)" }}>
          Service days for the work you have won. Only you can see these stops.
        </p>
      </header>

      {actionError ? (
        <p className="mb-4 rounded-xl px-4 py-3 text-sm" role="alert" style={{ background: "#fef2f2", color: "#b91c1c" }}>
          {actionError}
        </p>
      ) : null}

      {entries.length === 0 ? (
        <EmptyState
          ctaHref="/app/provider/job-feed"
          ctaLabel="Find work to bid on"
          hint="Once a community awards you a job, its service days and stops appear here."
          icon={<span aria-hidden>🗓️</span>}
          title="Nothing scheduled yet"
        />
      ) : (
        <div className="space-y-5">
          {entries.map(([agreementId, occurrences]) => (
            <section className="p-5" key={agreementId} style={card}>
              <h2 className="text-base font-semibold" style={{ color: "var(--ink-900)" }}>
                {agreementsById.get(agreementId)?.requestTitle ?? "Awarded work"}
              </h2>
              <p className="mt-1 text-xs" style={{ color: "var(--ink-400)" }}>
                {agreementsById.get(agreementId)?.communityName ?? ""} ·{" "}
                {agreementsById.get(agreementId)?.lockedHomeCount ?? occurrences[0]?.visits.length}{" "}
                homes
              </p>
              {occurrences.map((occurrence) => (
                <OccurrenceBlock
                  busy={busy}
                  key={occurrence.id}
                  occurrence={occurrence}
                  onPublish={(stops) =>
                    void call(`/provider/marketplace/occurrences/${occurrence.id}/plan`, {
                      stops,
                      publish: true,
                    })
                  }
                  onStatus={(visitId, status) => {
                    if (status === "completed" || status === "skipped" || status === "blocked") {
                      const visit = occurrence.visits.find((item) => item.id === visitId);
                      if (!visit) return;
                      setActionError(null);
                      setConfirmation({
                        agreementId, occurrenceId: occurrence.id, visitId, previousStatus: visit.status,
                        status, stopLabel: visit.stopLabel, serviceDate: occurrence.serviceDate,
                        title: agreementsById.get(agreementId)?.requestTitle ?? "Awarded work",
                      });
                    } else {
                      void call(`/provider/marketplace/visits/${visitId}/status`, { status, completionNote: null });
                    }
                  }}
                />
              ))}
            </section>
          ))}
        </div>
      )}
      {confirmation ? (
        <ConfirmAction
          open
          title={confirmation.status === "completed" ? "Mark this visit complete?" : `Mark this visit ${confirmation.status}?`}
          confirmLabel={confirmation.status === "completed" ? "Mark complete" : `Mark ${confirmation.status}`}
          destructive={confirmation.status !== "completed"}
          valid={validConfirmation} error={actionError}
          onCancel={() => setConfirmation(null)}
          onConfirm={async () => {
            if (!validConfirmation || busy) return false;
            return call(`/provider/marketplace/visits/${confirmation.visitId}/status`, {
              status: confirmation.status,
              completionNote: confirmation.status === "skipped" || confirmation.status === "blocked"
                ? "Reported from the provider schedule." : null,
            });
          }}
          description={<>
            <p>“{confirmation.title}” — {confirmation.stopLabel}, service day {new Date(confirmation.serviceDate).toLocaleDateString()}.</p>
            <p>{confirmation.status === "completed"
              ? "This marks this visit complete. The resident may be notified and asked to review the service, according to their preferences."
              : `This marks this visit ${confirmation.status}. The resident may be notified according to their preferences. It does not automatically schedule another visit.`}</p>
          </>}
        />
      ) : null}
    </div>
  );
}

function OccurrenceBlock({
  occurrence,
  busy,
  onPublish,
  onStatus,
}: {
  occurrence: OccurrenceSummary;
  busy: boolean;
  onPublish: (stops: Array<{ visitId: string; stopRank: number }>) => void;
  onStatus: (visitId: string, status: string) => void;
}) {
  // Local ordering only until it is published; the server is what makes an
  // order authoritative, and it re-reads the visits it is given.
  const [order, setOrder] = useState<string[]>(() => occurrence.visits.map((visit) => visit.id));

  const ordered = useMemo(() => {
    const byId = new Map(occurrence.visits.map((visit) => [visit.id, visit]));
    return order.map((id) => byId.get(id)).filter((visit): visit is VisitSummary => Boolean(visit));
  }, [occurrence.visits, order]);

  const move = (index: number, delta: number) => {
    setOrder((current) => {
      const next = [...current];
      const target = index + delta;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  return (
    <div className="mt-4 rounded-xl p-3" style={{ background: "var(--cream-100)" }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold" style={{ color: "var(--ink-900)" }}>
          Service day {occurrence.sequence} ·{" "}
          {new Date(occurrence.serviceDate).toLocaleDateString()}
        </p>
        <Button
          disabled={busy || ordered.length === 0}
          onClick={() =>
            onPublish(ordered.map((visit, index) => ({ visitId: visit.id, stopRank: index + 1 })))
          }
          variant="warm"
        >
          {occurrence.schedulePublishedAt ? "Republish plan" : "Publish plan"}
        </Button>
      </div>

      <ol className="mt-3 space-y-2">
        {ordered.map((visit, index) => (
          <li
            className="rounded-lg border p-3"
            key={visit.id}
            style={{ borderColor: "var(--border-warm)", background: "var(--bg-card)" }}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium" style={{ color: "var(--ink-900)" }}>
                  {index + 1}. {visit.stopLabel}
                </p>
                <p className="text-xs" style={{ color: "var(--ink-400)" }}>
                  {visit.addressLine1 ?? "Address available on the day"}
                  {visit.windowStart && visit.windowEnd
                    ? ` · ${visit.windowStart}–${visit.windowEnd}`
                    : ""}{" "}
                  · {visit.status.replace("_", " ")}
                </p>
                {visit.accessNotes ? (
                  <p className="text-xs" style={{ color: "var(--ink-700)" }}>
                    Access: {visit.accessNotes}
                  </p>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-1">
                <button
                  aria-label={`Move ${visit.stopLabel} earlier`}
                  className="rounded-md border px-2 text-xs"
                  disabled={busy}
                  onClick={() => move(index, -1)}
                  style={{ borderColor: "var(--border-warm)" }}
                  type="button"
                >
                  ↑
                </button>
                <button
                  aria-label={`Move ${visit.stopLabel} later`}
                  className="rounded-md border px-2 text-xs"
                  disabled={busy}
                  onClick={() => move(index, 1)}
                  style={{ borderColor: "var(--border-warm)" }}
                  type="button"
                >
                  ↓
                </button>
                {(NEXT_STATUSES[visit.status] ?? []).map((status) => (
                  <button
                    className="rounded-md px-2 py-1 text-xs font-semibold"
                    disabled={busy}
                    key={status}
                    onClick={() => onStatus(visit.id, status)}
                    style={{ background: "var(--cream-100)", color: "var(--ink-700)" }}
                    type="button"
                  >
                    {status.replace("_", " ")}
                  </button>
                ))}
              </div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
