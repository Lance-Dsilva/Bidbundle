"use client";

import { useState, type CSSProperties } from "react";

import { BidPrice, LegacyBidNotice } from "@/components/ui/BidPrice";
import { compareBidQuotes } from "@/lib/bid-pricing";
import { Button } from "@/components/ui/Button";
import type { BidSummary } from "@/lib/hoa-types";
import type { NeighborhoodRequestView } from "@/lib/neighborhood-types";
import { useNeighbourhood } from "@/hooks/useNeighbourhood";

/**
 * The non-HOA neighbourhood workspace.
 *
 * One screen, three audiences, all derived from server-sent permissions:
 *
 * - **a neighbour** joins or declines an open request;
 * - **a participant** sees the transparent bid comparison;
 * - **the assigned manager** runs the lifecycle — lock and open bidding, close
 *   bidding, award one provider, then watch the work through.
 *
 * There is no local authority anywhere here. `request.permissions` decides
 * which controls render, and every one of them posts to an endpoint that
 * re-derives the same answer from the database. Hiding a button is a courtesy,
 * not a security boundary.
 */

const card: CSSProperties = {
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
  failed: "Expired",
};

function money(cents: number | null): string {
  if (cents == null) return "—";
  return `$${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function when(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** A default bidding deadline one week out, in the format the API expects. */
function defaultBiddingDeadline(): string {
  return new Date(Date.now() + 7 * 24 * 3_600_000).toISOString();
}

export function NeighbourhoodWorkspace() {
  const { hub, loading, error, busy, missingAddresses, act } = useNeighbourhood();

  if (loading) {
    return (
      <p className="text-sm" style={{ color: "var(--ink-400)" }}>
        Loading your neighbourhood…
      </p>
    );
  }

  if (!hub) {
    return (
      <div className="p-5" style={card}>
        <h2 className="text-base font-semibold" style={{ color: "var(--ink-900)" }}>
          You are not in a neighbourhood yet
        </h2>
        <p className="mt-2 text-sm" style={{ color: "var(--ink-700)" }}>
          Bundleen places you automatically once your home address is on file and a neighbourhood
          covers it. Add or check your address to get started.
        </p>
        <a className="mt-3 inline-block" href="/app/homeowner/profile">
          <Button variant="warm">Review your address</Button>
        </a>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <header className="p-5" style={card}>
        <h1 className="text-lg font-semibold" style={{ color: "var(--ink-900)" }}>
          {hub.communityName}
        </h1>
        <p className="mt-1 text-sm" style={{ color: "var(--ink-700)" }}>
          {hub.activeNeighbourCount} {hub.activeNeighbourCount === 1 ? "home" : "homes"} ·{" "}
          {hub.isManager
            ? "You are this neighbourhood's manager."
            : hub.managerName
              ? `Managed by ${hub.managerName}.`
              : "No neighbourhood manager assigned yet."}
        </p>
        {!hub.addressReady ? (
          <p className="mt-2 text-sm" style={{ color: "#b45309" }} role="status">
            Add your home address to your profile — a provider cannot be sent to your home without
            it, and requests you join will be held back until it is on file.
          </p>
        ) : null}
      </header>

      {error ? (
        <p
          className="rounded-xl px-4 py-3 text-sm font-medium"
          role="alert"
          style={{ background: "#fef2f2", color: "#b91c1c" }}
        >
          {error}
        </p>
      ) : null}

      {missingAddresses ? (
        <div
          className="rounded-xl px-4 py-3 text-sm"
          role="alert"
          style={{ background: "#fffbeb", color: "#92400e" }}
        >
          <p className="font-semibold">
            {missingAddresses.count} {missingAddresses.count === 1 ? "home has" : "homes have"} no
            address on file
          </p>
          <p className="mt-1">
            Nothing was awarded. Ask {missingAddresses.names.join(", ")} to add their home address,
            then award again.
          </p>
        </div>
      ) : null}

      {hub.requests.length === 0 ? (
        <div className="p-5" style={card}>
          <p className="text-sm" style={{ color: "var(--ink-700)" }}>
            No requests in your neighbourhood yet. Open one and your neighbours can join it.
          </p>
          <a className="mt-3 inline-block" href="/app/homeowner/request">
            <Button variant="warm">Open a request</Button>
          </a>
        </div>
      ) : (
        hub.requests.map((request) => (
          <RequestCard key={request.id} busy={busy} onAct={act} request={request} />
        ))
      )}
    </div>
  );
}

function RequestCard({
  request,
  busy,
  onAct,
}: {
  request: NeighborhoodRequestView;
  busy: boolean;
  onAct: ReturnType<typeof useNeighbourhood>["act"];
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <article className="p-5" style={card}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold" style={{ color: "var(--ink-900)" }}>
            {request.title}
          </h2>
          <p className="mt-1 text-xs" style={{ color: "var(--ink-400)" }}>
            {request.categoryLabel} · opened by {request.isOwner ? "you" : request.createdByName} ·{" "}
            {STATUS_LABELS[request.status] ?? request.status}
          </p>
        </div>
        <span
          className="rounded-full px-3 py-1 text-xs font-semibold"
          style={{ background: "var(--cream-100)", color: "var(--ink-700)" }}
        >
          {request.joinedCount} joined · {request.bidCount} bids
        </span>
      </div>

      <p className="mt-3 text-sm" style={{ color: "var(--ink-700)" }}>
        {request.description}
      </p>

      <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-3" style={{ color: "var(--ink-400)" }}>
        <div>
          <dt>Budget</dt>
          <dd style={{ color: "var(--ink-900)" }}>
            {money(request.budgetMinCents)} – {money(request.budgetMaxCents)}
          </dd>
        </div>
        <div>
          <dt>Sign-ups close</dt>
          <dd style={{ color: "var(--ink-900)" }}>{when(request.enrollmentClosesAt)}</dd>
        </div>
        <div>
          <dt>Bidding closes</dt>
          <dd style={{ color: "var(--ink-900)" }}>{when(request.biddingClosesAt)}</dd>
        </div>
      </dl>

      {/* ── Neighbour: join or decline ─────────────────────────────────── */}
      {request.permissions.canRespond ? (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            disabled={busy}
            onClick={() =>
              void onAct({ kind: "respond", requestId: request.id, response: "joined" })
            }
            variant={request.viewerResponse === "joined" ? "secondary" : "warm"}
          >
            {request.viewerResponse === "joined" ? "You have joined" : "Join this request"}
          </Button>
          <Button
            disabled={busy}
            onClick={() =>
              void onAct({ kind: "respond", requestId: request.id, response: "declined" })
            }
            variant="ghost"
          >
            {request.viewerResponse === "declined" ? "You declined" : "No thanks"}
          </Button>
        </div>
      ) : null}

      {/* ── Manager: lifecycle ─────────────────────────────────────────── */}
      {request.permissions.canManage ? (
        <div className="mt-4 rounded-xl p-3" style={{ background: "var(--cream-100)" }}>
          <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--ink-400)" }}>
            Neighbourhood manager
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {request.status === "collecting_interest" ? (
              <Button
                disabled={busy || request.joinedCount < request.minHomes}
                onClick={() =>
                  void onAct({
                    kind: "transition",
                    requestId: request.id,
                    action: "open_bidding",
                    biddingClosesAt: defaultBiddingDeadline(),
                  })
                }
                variant="warm"
              >
                Lock {request.joinedCount} {request.joinedCount === 1 ? "home" : "homes"} and open
                bidding
              </Button>
            ) : null}
            {request.status === "open_for_bids" ? (
              <Button
                disabled={busy}
                onClick={() =>
                  void onAct({
                    kind: "transition",
                    requestId: request.id,
                    action: "close_bidding",
                  })
                }
                variant="warm"
              >
                Close bidding
              </Button>
            ) : null}
            {["awarded", "scheduled", "in_progress"].includes(request.status) ? (
              <Button
                disabled={busy}
                onClick={() =>
                  void onAct({ kind: "transition", requestId: request.id, action: "complete" })
                }
                variant="secondary"
              >
                Mark complete
              </Button>
            ) : null}
            {["collecting_interest", "open_for_bids", "bidding_closed"].includes(
              request.status,
            ) ? (
              <Button
                disabled={busy}
                onClick={() =>
                  void onAct({ kind: "transition", requestId: request.id, action: "cancel" })
                }
                variant="ghost"
              >
                Cancel request
              </Button>
            ) : null}
          </div>
          {request.status === "collecting_interest" && request.joinedCount < request.minHomes ? (
            <p className="mt-2 text-xs" style={{ color: "var(--ink-400)" }}>
              {request.minHomes} {request.minHomes === 1 ? "home is" : "homes are"} needed before
              bidding can open.
            </p>
          ) : null}

          {request.participants && request.participants.length > 0 ? (
            <ul className="mt-3 space-y-1 text-xs" style={{ color: "var(--ink-700)" }}>
              {request.participants.map((participant) => (
                <li key={participant.userId}>
                  {participant.displayName}
                  {participant.isViewer ? " (you)" : ""} — {participant.response}
                  {participant.response === "joined" && !participant.addressReady ? (
                    <span style={{ color: "#b45309" }}> · no address on file</span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {/* ── Transparent bid comparison ─────────────────────────────────── */}
      {request.permissions.canViewBids && request.bids && request.bids.length > 0 ? (
        <div className="mt-4">
          <button
            className="text-xs font-semibold underline"
            onClick={() => setExpanded((current) => !current)}
            style={{ color: "var(--ink-700)" }}
            type="button"
          >
            {expanded ? "Hide" : "Compare"} {request.bids.length}{" "}
            {request.bids.length === 1 ? "quote" : "quotes"}
          </button>
          {expanded ? (
            <ul className="mt-2 space-y-2">
              {[...request.bids].sort(compareBidQuotes).map((bid) => (
                <BidRow
                  bid={bid}
                  requestStatus={request.status}
                  busy={busy}
                  canAward={request.permissions.canManage && request.status === "bidding_closed"}
                  key={bid.id}
                  onAward={() =>
                    void onAct({ kind: "award", requestId: request.id, bidId: bid.id })
                  }
                />
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {/* ── After award: this resident's own stop ──────────────────────── */}
      {request.myVisits.length > 0 ? (
        <div className="mt-4 rounded-xl p-3" style={{ background: "var(--cream-100)" }}>
          <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--ink-400)" }}>
            Your visits
          </p>
          <ul className="mt-2 space-y-1 text-xs" style={{ color: "var(--ink-700)" }}>
            {request.myVisits.map((visit) => (
              <li key={visit.id}>
                {visit.scheduledDate
                  ? new Date(visit.scheduledDate).toLocaleDateString()
                  : "Not scheduled yet"}
                {visit.windowStart && visit.windowEnd
                  ? ` · ${visit.windowStart}–${visit.windowEnd}`
                  : ""}{" "}
                · {visit.status.replace("_", " ")}
                {visit.addressLine1 ? ` · ${visit.addressLine1}` : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </article>
  );
}

function BidRow({
  bid,
  requestStatus,
  canAward,
  busy,
  onAward,
}: {
  bid: BidSummary;
  requestStatus: string;
  canAward: boolean;
  busy: boolean;
  onAward: () => void;
}) {
  return (
    <li
      className="rounded-xl border p-3"
      style={{ borderColor: "var(--border-warm)", background: "var(--bg-card)" }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold" style={{ color: "var(--ink-900)" }}>
            {bid.providerCompany ?? bid.providerName}
            {bid.providerVerified ? (
              <span className="ml-2 text-xs" style={{ color: "#15803d" }}>
                verified
              </span>
            ) : null}
          </p>
          <BidPrice bid={bid} />
          {bid.estimatedDurationLabel ? <p className="mt-1 text-xs" style={{ color: "var(--ink-400)" }}>{bid.estimatedDurationLabel}</p> : null}
          {bid.pricingBasis !== "total" && bid.status === "submitted" ? <LegacyBidNotice requestStatus={requestStatus} /> : null}
        </div>
        {canAward && bid.status === "submitted" ? (
          <Button disabled={busy || bid.pricingBasis !== "total"} onClick={onAward} variant="warm">
            Award this provider
          </Button>
        ) : (
          <span className="text-xs" style={{ color: "var(--ink-400)" }}>
            {bid.status}
          </span>
        )}
      </div>
      <p className="mt-2 text-xs" style={{ color: "var(--ink-700)" }}>
        {bid.scope}
      </p>
      {bid.exclusions ? (
        <p className="mt-1 text-xs" style={{ color: "var(--ink-400)" }}>
          Excludes: {bid.exclusions}
        </p>
      ) : null}
    </li>
  );
}
