"use client";

import { useEffect, useId, useRef, useState, type CSSProperties, type FormEvent } from "react";

import { BidPrice, LegacyBidNotice } from "@/components/ui/BidPrice";
import { compareBidQuotes } from "@/lib/bid-pricing";
import { ConfirmAction } from "@/components/ui/ConfirmAction";
import { Button } from "@/components/ui/Button";
import type { BidSummary } from "@/lib/hoa-types";
import type { NeighborhoodRequestView } from "@/lib/neighborhood-types";
import { useNeighbourhood } from "@/hooks/useNeighbourhood";
import { CATEGORY_LABELS, SERVICE_CATEGORIES, editOwnerRequestSchema, type EditOwnerRequestInput } from "@/lib/validation/homeowner-requests";

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
  const { hub, loading, error, busy, missingAddresses, act, setError, ownerError, ownerSuccess, clearOwnerFeedback } = useNeighbourhood();

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
          <RequestCard key={request.id} busy={busy} onAct={act} request={request} actionError={error} ownerError={ownerError?.requestId === request.id ? ownerError : null} ownerSuccess={ownerSuccess?.requestId === request.id ? ownerSuccess.action : null} onPrepare={() => { setError(null); clearOwnerFeedback?.(); }} />
        ))
      )}
    </div>
  );
}

function RequestCard({
  request,
  busy,
  onAct,
  actionError,
  ownerError,
  ownerSuccess,
  onPrepare,
}: {
  request: NeighborhoodRequestView;
  busy: boolean;
  onAct: ReturnType<typeof useNeighbourhood>["act"];
  actionError: string | null;
  ownerError: { message: string; fields?: Record<string, string> } | null;
  ownerSuccess: "edit" | "cancel" | null;
  onPrepare: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const editButton = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const headingId = useId();
  const wasEditing = useRef(false);
  useEffect(() => {
    if (wasEditing.current && !editing) (editButton.current ?? heading.current)?.focus();
    wasEditing.current = editing;
  }, [editing]);
  useEffect(() => {
    if (ownerSuccess === "cancel") heading.current?.focus();
  }, [ownerSuccess]);
  const canEditOwn = request.isOwner && request.permissions.canEdit &&
    ["draft", "collecting_interest"].includes(request.status) && request.participantsLockedAt === null &&
    request.bidCount === 0 && request.agreement === null;
  const finishEditing = () => setEditing(false);
  const [confirmation, setConfirmation] = useState<{
    action: "cancel" | "owner_cancel" | "complete" | "award"; status: string; title: string; joinedCount: number; bid?: BidSummary;
  } | null>(null);
  const ask = (action: "cancel" | "owner_cancel" | "complete" | "award", bid?: BidSummary) => {
    onPrepare();
    setConfirmation({ action, status: request.status, title: request.title, joinedCount: request.joinedCount, bid: bid ? { ...bid } : undefined });
  };
  const currentBid = confirmation?.bid ? request.bids?.find((bid) => bid.id === confirmation.bid?.id) : null;
  const validConfirmation = Boolean(confirmation &&
    (confirmation.action === "owner_cancel" ? canEditOwn && confirmation.joinedCount === request.joinedCount : request.permissions.canManage) &&
    confirmation.status === request.status && confirmation.title === request.title &&
    (confirmation.action === "award"
      ? request.status === "bidding_closed" && currentBid?.status === "submitted" && currentBid.pricingBasis === "total" &&
        currentBid.version === confirmation.bid?.version && currentBid.amountCents === confirmation.bid.amountCents && currentBid.currency === confirmation.bid.currency &&
        currentBid.providerUserId === confirmation.bid.providerUserId && !request.bids?.some((bid) => bid.status === "accepted")
      : confirmation.action === "complete" ? ["awarded", "scheduled", "in_progress"].includes(request.status)
        : confirmation.action === "owner_cancel" ? ["draft", "collecting_interest"].includes(request.status)
          : ["collecting_interest", "open_for_bids", "bidding_closed"].includes(request.status)));


  return (
    <article aria-labelledby={headingId} className="p-5" style={card}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 ref={heading} id={headingId} tabIndex={-1} className="text-base font-semibold" style={{ color: "var(--ink-900)" }}>
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

      {ownerSuccess ? (
        <p role="status" className="mt-3 text-sm font-medium" style={{ color: "var(--sage-700)" }}>
          {ownerSuccess === "edit" ? "Your request changes are saved." : "Your request is cancelled."}
        </p>
      ) : null}

      {/* Owners can change their request only before its scope is locked. */}
      {canEditOwn && !editing ? (
        <div className="mt-4 flex flex-wrap gap-2">
          <button ref={editButton} type="button" disabled={busy} onClick={() => { onPrepare(); setEditing(true); }}
            className="min-h-11 rounded-lg border px-4 text-sm font-medium focus-visible:outline focus-visible:outline-2 disabled:opacity-40"
            style={{ borderColor: "var(--border-warm)", color: "var(--ink-900)" }}>
            Edit request
          </button>
          <Button className="min-h-11" disabled={busy} onClick={() => ask("owner_cancel")} variant="danger">
            Cancel request
          </Button>
        </div>
      ) : null}
      {editing ? (
        <OwnerRequestEditor request={request} valid={canEditOwn} busy={busy} error={ownerError}
          onDiscard={finishEditing} onSave={async (input) => {
            const saved = await onAct({ kind: "edit", requestId: request.id, input });
            if (saved) finishEditing();
            return saved;
          }} />
      ) : null}

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
                  ask("complete")
                }
                variant="secondary"
              >
                Mark complete
              </Button>
            ) : null}
            {["collecting_interest", "open_for_bids", "bidding_closed"].includes(
              request.status,
            ) && !canEditOwn ? (
              <Button
                disabled={busy}
                onClick={() =>
                  ask("cancel")
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
                    ask("award", bid)
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
      {confirmation ? (
        <ConfirmAction
          open
          title={confirmation.action === "award" ? "Award this provider?" : confirmation.action === "complete" ? "Mark this request complete?" : "Cancel this request?"}
          confirmLabel={confirmation.action === "award" ? "Award provider" : confirmation.action === "complete" ? "Mark complete" : "Cancel request"}
          destructive={confirmation.action === "cancel" || confirmation.action === "owner_cancel"}
          valid={validConfirmation}
          error={confirmation.action === "owner_cancel" ? ownerError?.message : actionError}
          onCancel={() => setConfirmation(null)}
          onConfirm={async () => {
            if (!validConfirmation || busy) return false;
            if (confirmation.action === "owner_cancel") return onAct({ kind: "cancel", requestId: request.id });
            return confirmation.action === "award" && confirmation.bid
              ? onAct({ kind: "award", requestId: request.id, bidId: confirmation.bid.id, expectedBidVersion: confirmation.bid.version })
              : onAct({ kind: "transition", requestId: request.id, action: confirmation.action as "cancel" | "complete" });
          }}
          description={confirmation.action === "award" && confirmation.bid ? <>
            <p>Award “{confirmation.title}” to {confirmation.bid.providerCompany ?? confirmation.bid.providerName} (quote version {confirmation.bid.version})?</p>
            <BidPrice bid={confirmation.bid} />
            <p>This accepts this quote, rejects other submitted quotes, and creates the agreement and service visits. The provider, affected residents and other bidders may be notified according to their preferences.</p>
          </> : confirmation.action === "complete" ? <p>Mark “{confirmation.title}” and its agreement complete? All service cycles must already be closed. You may receive a prompt to review the provider.</p>
            : confirmation.action === "owner_cancel" ? <p>Cancel “{confirmation.title}” for {confirmation.joinedCount} {confirmation.joinedCount === 1 ? "joined home" : "joined homes"}? This ends sign-ups and cannot be undone. Affected residents and the neighbourhood manager may be notified according to their preferences.</p>
            : <p>Cancel “{confirmation.title}”? This ends the request and bidding, and expires submitted quotes. Affected residents and quoting providers may be notified according to their preferences.</p>}
        />
      ) : null}
    </article>
  );
}

const editorInput = "min-h-11 w-full rounded-lg border px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50";

type OwnerDraft = { title: string; category: string; description: string; minimum: string; maximum: string };

function requestDraft(request: NeighborhoodRequestView): OwnerDraft {
  return {
    title: request.title,
    category: request.category,
    description: request.description,
    minimum: request.budgetMinCents === null ? "" : (request.budgetMinCents / 100).toFixed(2),
    maximum: request.budgetMaxCents === null ? "" : (request.budgetMaxCents / 100).toFixed(2),
  };
}

/** Parse decimal dollars without rounding a fractional cent or accepting an exponent. */
function budgetInCents(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  if (!/^\d+(?:\.\d{1,2})?$/.test(trimmed)) return Number.NaN;
  const [dollars, fraction = ""] = trimmed.split(".");
  return Number(dollars) * 100 + Number(fraction.padEnd(2, "0"));
}

function OwnerRequestEditor({ request, valid, busy, error, onDiscard, onSave }: {
  request: NeighborhoodRequestView;
  valid: boolean;
  busy: boolean;
  error: { message: string; fields?: Record<string, string> } | null;
  onDiscard: () => void;
  onSave: (input: EditOwnerRequestInput) => Promise<boolean>;
}) {
  const id = useId();
  const firstInput = useRef<HTMLInputElement>(null);
  const inFlight = useRef(false);
  const initial = useRef(requestDraft(request));
  const [draft, setDraft] = useState<OwnerDraft>(initial.current);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const current = requestDraft(request);
  const unchanged = Object.keys(initial.current).every((key) =>
    current[key as keyof OwnerDraft] === initial.current[key as keyof OwnerDraft]);
  const editable = valid && unchanged;
  const shownFields = { ...error?.fields, ...fields };
  useEffect(() => { firstInput.current?.focus(); }, []);

  const change = (name: keyof OwnerDraft, value: string) => {
    setDraft((previous) => ({ ...previous, [name]: value }));
    setFields({});
    setFailure(null);
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editable || busy || inFlight.current) return;
    const minimum = budgetInCents(draft.minimum);
    const maximum = budgetInCents(draft.maximum);
    const parsed = editOwnerRequestSchema.safeParse({
      action: "edit", title: draft.title, category: draft.category, description: draft.description,
      budgetMinCents: minimum, budgetMaxCents: maximum,
    });
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) next[String(issue.path[0] ?? "form")] ??= issue.message;
      if (Number.isNaN(minimum)) next.budgetMinCents = "Enter a non-negative amount with at most two decimal places.";
      if (Number.isNaN(maximum)) next.budgetMaxCents = "Enter a non-negative amount with at most two decimal places.";
      setFields(next);
      setFailure("Check the highlighted fields before saving.");
      return;
    }
    inFlight.current = true;
    setFields({});
    setFailure(null);
    try {
      if (!await onSave(parsed.data)) setFailure("Your changes were not saved. Your entries are still here; please try again.");
    } catch (caught) {
      setFailure(caught instanceof Error ? caught.message : "Your changes were not saved. Please try again.");
    } finally {
      inFlight.current = false;
    }
  };
  const fieldError = (name: string) => shownFields[name]
    ? <span id={`${id}-${name}-error`} className="text-xs" style={{ color: "#b91c1c" }}>{shownFields[name]}</span>
    : null;
  const fieldA11y = (name: string) => ({
    "aria-invalid": Boolean(shownFields[name]),
    "aria-describedby": shownFields[name] ? `${id}-${name}-error` : undefined,
  });
  const inputStyle = { borderColor: "var(--border-warm)", background: "var(--bg-card)", color: "var(--ink-900)" };

  return (
    <form aria-labelledby={`${id}-heading`} className="mt-4 space-y-3 rounded-xl border p-4" style={{ borderColor: "var(--border-warm)" }} onSubmit={(event) => void submit(event)} noValidate>
      <h3 id={`${id}-heading`} className="font-semibold" style={{ color: "var(--ink-900)" }}>Edit your request</h3>
      <p className="text-xs" style={{ color: "var(--ink-700)" }}>Changes apply to the request your neighbours have joined. You can edit only before bidding starts.</p>
      {!editable ? <p role="alert" className="text-sm" style={{ color: "#92400e" }}>This request has changed or is no longer editable. Discard these edits and review the latest details.</p> : null}
      <fieldset disabled={busy || !editable} className="space-y-3">
        <label className="block space-y-1 text-sm">
          <span>Title</span>
          <input ref={firstInput} className={editorInput} style={inputStyle} value={draft.title} onChange={(event) => change("title", event.target.value)} {...fieldA11y("title")} />
          {fieldError("title")}
        </label>
        <label className="block space-y-1 text-sm">
          <span>Service category</span>
          <select className={editorInput} style={inputStyle} value={draft.category} onChange={(event) => change("category", event.target.value)} {...fieldA11y("category")}>
            {!SERVICE_CATEGORIES.some((category) => category === draft.category) ? <option value={draft.category}>{draft.category}</option> : null}
            {SERVICE_CATEGORIES.map((category) => <option key={category} value={category}>{CATEGORY_LABELS[category]}</option>)}
          </select>
          {fieldError("category")}
        </label>
        <label className="block space-y-1 text-sm">
          <span>Description</span>
          <textarea className={`${editorInput} min-h-28`} style={inputStyle} rows={4} value={draft.description} onChange={(event) => change("description", event.target.value)} {...fieldA11y("description")} />
          {fieldError("description")}
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block space-y-1 text-sm">
            <span>Minimum budget ($)</span>
            <input className={editorInput} style={inputStyle} inputMode="decimal" value={draft.minimum} onChange={(event) => change("minimum", event.target.value)} {...fieldA11y("budgetMinCents")} />
            {fieldError("budgetMinCents")}
          </label>
          <label className="block space-y-1 text-sm">
            <span>Maximum budget ($)</span>
            <input className={editorInput} style={inputStyle} inputMode="decimal" value={draft.maximum} onChange={(event) => change("maximum", event.target.value)} {...fieldA11y("budgetMaxCents")} />
            {fieldError("budgetMaxCents")}
          </label>
        </div>
        <p className="text-xs" style={{ color: "var(--ink-700)" }}>Amounts are in US dollars. Leave both amounts blank if no budget is set.</p>
      </fieldset>
      {error?.message || failure ? <p role="alert" className="text-sm" style={{ color: "#b91c1c" }}>{error?.message ?? failure}</p> : null}
      {busy ? <p role="status" className="text-sm">Saving your request…</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button className="min-h-11" disabled={busy || !editable} type="submit" variant="warm">{busy ? "Saving…" : "Save changes"}</Button>
        <Button className="min-h-11" disabled={busy} onClick={onDiscard} variant="secondary">Discard edits</Button>
      </div>
    </form>
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
