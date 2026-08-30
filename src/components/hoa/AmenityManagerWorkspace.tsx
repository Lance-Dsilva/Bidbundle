"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type {
  AmenityIssueView,
  ManagerAmenityWorkspace,
  ManagerBookingView,
} from "@/lib/amenity-types";
import { AMENITY_TYPE_LABELS, OPERATIONAL_STATUS_LABELS } from "@/lib/amenity-types";

/**
 * "Amenities & spaces" — the HOA manager's operational surface.
 *
 * Every control here is a thin wrapper over an endpoint that re-checks the
 * manager's scoped assignment. The tabs are for the manager's convenience;
 * they are not a permission boundary, and nothing on this screen is the reason
 * an action is allowed.
 *
 * Destructive and resident-affecting actions (closing an amenity, cancelling
 * someone's reservation, archiving) ask for confirmation first, because the
 * person on the other end of them finds out by email.
 */

type Tab = "amenities" | "calendar" | "approvals" | "issues" | "messages";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "amenities", label: "Amenities" },
  { id: "calendar", label: "Calendar" },
  { id: "approvals", label: "Approvals" },
  { id: "issues", label: "Issues" },
  { id: "messages", label: "Messages" },
];

async function send(path: string, body: unknown, method = "POST") {
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = (await response.json().catch(() => null)) as
    | Record<string, unknown>
    | null;
  if (!response.ok) {
    throw new Error(
      (result?.error as string) ?? "Something went wrong. Please try again.",
    );
  }
  return result;
}

function BookingRow({
  booking,
  onDecision,
  busy,
}: {
  booking: ManagerBookingView;
  onDecision: (bookingId: string, decision: string, reason?: string) => void;
  busy: boolean;
}) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--line,#e2e8f0)] px-3 py-2.5">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-[var(--ink-900,#0f172a)]">
          {booking.amenityName} · {booking.whenLabel}
        </p>
        <p className="text-xs text-slate-500">
          {booking.residentName}
          {booking.unitLabel ? ` (${booking.unitLabel})` : ""} · {booking.resourceLabel} ·{" "}
          {booking.statusLabel} · {booking.reference}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {booking.status === "pending_approval" ? (
          <>
            <button
              className="bb-btn bb-btn-primary"
              disabled={busy}
              onClick={() => onDecision(booking.id, "approve")}
              type="button"
            >
              Approve
            </button>
            <button
              className="bb-btn bb-btn-secondary"
              disabled={busy}
              onClick={() => onDecision(booking.id, "decline")}
              type="button"
            >
              Decline
            </button>
          </>
        ) : booking.status === "confirmed" ? (
          <>
            <button
              className="bb-btn bb-btn-secondary"
              disabled={busy}
              onClick={() => onDecision(booking.id, "complete")}
              type="button"
            >
              Mark complete
            </button>
            <button
              className="bb-btn bb-btn-secondary"
              disabled={busy}
              onClick={() => onDecision(booking.id, "no_show")}
              type="button"
            >
              No show
            </button>
            <button
              className="bb-btn bb-btn-secondary"
              disabled={busy}
              onClick={() => onDecision(booking.id, "cancel")}
              type="button"
            >
              Cancel
            </button>
          </>
        ) : null}
      </div>
    </li>
  );
}

function IssueCard({
  issue,
  staff,
  onUpdate,
  onReply,
  busy,
}: {
  issue: AmenityIssueView;
  staff: ManagerAmenityWorkspace["staff"];
  onUpdate: (issueId: string, body: Record<string, unknown>) => void;
  onReply: (issueId: string, body: string, internal: boolean) => void;
  busy: boolean;
}) {
  const [reply, setReply] = useState("");
  const [internal, setInternal] = useState(false);
  const [open, setOpen] = useState(false);

  return (
    <li className="rounded-xl border border-[var(--line,#e2e8f0)] p-3">
      <button
        aria-expanded={open}
        className="flex w-full flex-wrap items-center justify-between gap-2 text-left"
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-[var(--ink-900,#0f172a)]">
            {issue.subject}
          </span>
          <span className="block text-xs text-slate-500">
            {issue.amenityName} · {issue.categoryLabel} · {issue.reporterName} ·{" "}
            {issue.reference}
          </span>
        </span>
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
          {issue.statusLabel}
        </span>
      </button>

      {open ? (
        <div className="mt-3 space-y-3">
          <p className="whitespace-pre-line text-sm text-slate-700">{issue.description}</p>

          {issue.photos.length > 0 ? (
            <div className="flex gap-2 overflow-x-auto">
              {issue.photos.map((photo) => (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  alt=""
                  className="h-24 w-32 shrink-0 rounded-lg object-cover"
                  key={photo.id}
                  loading="lazy"
                  src={photo.url}
                />
              ))}
            </div>
          ) : null}

          <ul className="space-y-2">
            {issue.messages.map((message) => (
              <li
                className={`rounded-lg px-3 py-2 text-sm ${
                  message.kind === "internal_note"
                    ? "border border-dashed border-amber-300 bg-amber-50 text-amber-900"
                    : "bg-slate-50 text-slate-700"
                }`}
                key={message.id}
              >
                <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                  {message.authorName}
                  {message.kind === "internal_note" ? " · internal note (staff only)" : ""}
                </p>
                <p className="mt-1">{message.body}</p>
              </li>
            ))}
          </ul>

          <div className="flex flex-wrap gap-2">
            <label className="text-sm">
              <span className="sr-only">Status</span>
              <select
                className="rounded-lg border border-[var(--line,#e2e8f0)] px-3 py-2 text-sm"
                disabled={busy}
                onChange={(event) =>
                  onUpdate(issue.id, { status: event.target.value })
                }
                value=""
              >
                <option value="" disabled>
                  Set status…
                </option>
                {[
                  "acknowledged",
                  "investigating",
                  "waiting_on_resident",
                  "resolved",
                  "closed",
                ].map((status) => (
                  <option key={status} value={status}>
                    {status.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-sm">
              <span className="sr-only">Assign</span>
              <select
                className="rounded-lg border border-[var(--line,#e2e8f0)] px-3 py-2 text-sm"
                disabled={busy}
                onChange={(event) =>
                  onUpdate(issue.id, {
                    assignedToUserId: event.target.value || null,
                  })
                }
                value=""
              >
                <option value="" disabled>
                  Assign to…
                </option>
                {staff.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <form
            className="space-y-2"
            onSubmit={(event) => {
              event.preventDefault();
              onReply(issue.id, reply, internal);
              setReply("");
            }}
          >
            <label className="block text-sm">
              <span className="font-semibold text-slate-700">
                {internal ? "Internal note (the resident never sees this)" : "Reply to resident"}
              </span>
              <textarea
                className="mt-1 w-full rounded-lg border border-[var(--line,#e2e8f0)] px-3 py-2 text-sm"
                maxLength={4000}
                onChange={(event) => setReply(event.target.value)}
                required
                rows={3}
                value={reply}
              />
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                checked={internal}
                onChange={(event) => setInternal(event.target.checked)}
                type="checkbox"
              />
              Keep this internal
            </label>
            <button className="bb-btn bb-btn-primary" disabled={busy} type="submit">
              Send
            </button>
          </form>
        </div>
      ) : null}
    </li>
  );
}

export function AmenityManagerWorkspace({
  workspace,
}: {
  workspace: ManagerAmenityWorkspace;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("amenities");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [audience, setAudience] =
    useState<"all_residents" | "upcoming_bookings" | "affected_by_closure">(
      "all_residents",
    );
  const [messageAmenityId, setMessageAmenityId] = useState(
    workspace.amenities[0]?.id ?? "",
  );
  const [subject, setSubject] = useState("");
  const [messageBody, setMessageBody] = useState("");
  const [urgent, setUrgent] = useState(false);
  const [justification, setJustification] = useState("");
  const [preview, setPreview] = useState<{
    recipientCount: number;
    emailCount: number;
    sample: string[];
  } | null>(null);

  const run = async (action: () => Promise<void>, success: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(success);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  const decide = (bookingId: string, decision: string) => {
    if (
      (decision === "cancel" || decision === "decline") &&
      !window.confirm(
        "This tells the resident their reservation is off. Send that now?",
      )
    ) {
      return;
    }
    void run(async () => {
      await send(`/api/hoa/amenities/bookings/${bookingId}/decision`, { decision });
    }, "Reservation updated.");
  };

  const setStatus = (amenityId: string, status: string) => {
    if (
      status === "archived" &&
      !window.confirm(
        "Archiving hides this amenity from residents. Its bookings, reviews, and reports are kept. Continue?",
      )
    ) {
      return;
    }
    void run(async () => {
      await send(`/api/hoa/amenities/${amenityId}/status`, { status });
    }, "Amenity updated.");
  };

  const setOperational = (amenityId: string, operationalStatus: string) => {
    const note =
      operationalStatus === "open"
        ? null
        : window.prompt("What should residents be told? (shown on the amenity)");
    if (operationalStatus !== "open" && note === null) return;

    void run(async () => {
      await send(
        `/api/hoa/amenities/${amenityId}`,
        { operationalStatus, operationalNote: note },
        "PATCH",
      );
    }, "Status updated. Residents will see the reason on the amenity page.");
  };

  const updateIssue = (issueId: string, body: Record<string, unknown>) =>
    void run(async () => {
      await send(`/api/hoa/amenities/issues/${issueId}`, body, "PATCH");
    }, "Report updated.");

  const replyToIssue = (issueId: string, body: string, internal: boolean) =>
    void run(async () => {
      await send(`/api/hoa/amenities/issues/${issueId}/messages`, { body, internal });
    }, internal ? "Internal note saved." : "Reply sent to the resident.");

  const composeMessage = (mode: "preview" | "test" | "send") => {
    if (
      mode === "send" &&
      !window.confirm(
        `Send this to ${preview?.recipientCount ?? "the selected"} residents of ${workspace.communityName}?`,
      )
    ) {
      return;
    }

    void run(async () => {
      const query = messageAmenityId ? `&amenityId=${messageAmenityId}` : "";
      const result = (await send(
        `/api/hoa/amenities/broadcast?communityId=${workspace.communityId}${query}`,
        {
          audience,
          subject,
          body: messageBody,
          urgent,
          urgentJustification: justification || null,
          mode,
        },
      )) as { recipientCount?: number; emailCount?: number; sample?: string[] } | null;

      if (mode === "preview" && result) {
        setPreview({
          recipientCount: result.recipientCount ?? 0,
          emailCount: result.emailCount ?? 0,
          sample: result.sample ?? [],
        });
      }
      if (mode === "send") {
        setSubject("");
        setMessageBody("");
        setPreview(null);
      }
    }, mode === "preview" ? "Audience resolved." : mode === "test" ? "Test sent to you." : "Message sent.");
  };

  return (
    <div className="space-y-5">
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

      <div className="flex gap-2 overflow-x-auto pb-1" role="tablist">
        {TABS.map((entry) => (
          <button
            aria-selected={tab === entry.id}
            className={`shrink-0 rounded-full px-4 py-2 text-sm font-semibold transition ${
              tab === entry.id
                ? "bg-[var(--ink-900,#0f172a)] text-white"
                : "bg-white text-slate-600 hover:text-slate-900"
            }`}
            key={entry.id}
            onClick={() => setTab(entry.id)}
            role="tab"
            type="button"
          >
            {entry.label}
            {entry.id === "approvals" && workspace.pendingApprovals.length > 0
              ? ` (${workspace.pendingApprovals.length})`
              : ""}
            {entry.id === "issues" && workspace.openIssues.length > 0
              ? ` (${workspace.openIssues.length})`
              : ""}
          </button>
        ))}
      </div>

      {tab === "amenities" ? (
        <section className="bb-card bb-card-pad">
          <h2 className="bb-card-title">Amenities</h2>
          <p className="bb-card-copy">
            Drafts are visible only to you and Bundleen staff. Publishing is
            blocked until hours, spaces, and a description are in place.
          </p>
          <ul className="mt-4 space-y-3">
            {workspace.amenities.map((amenity) => {
              const stats = workspace.utilization.find(
                (row) => row.amenityId === amenity.id,
              );
              return (
                <li
                  className="rounded-xl border border-[var(--line,#e2e8f0)] p-3"
                  key={amenity.id}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-bold text-[var(--ink-900,#0f172a)]">
                        {amenity.name}
                      </p>
                      <p className="text-xs text-slate-500">
                        {AMENITY_TYPE_LABELS[amenity.type]} ·{" "}
                        {amenity.bookingRequired ? "Bookable" : "Drop-in"} ·{" "}
                        {OPERATIONAL_STATUS_LABELS[amenity.operationalStatus]}
                        {stats
                          ? ` · ${stats.bookingsLast30Days} bookings in 30 days · ${stats.openIssues} open issues`
                          : ""}
                      </p>
                    </div>
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold uppercase tracking-wide text-slate-700">
                      {amenity.status}
                    </span>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    {amenity.status === "draft" ? (
                      <button
                        className="bb-btn bb-btn-primary"
                        disabled={busy}
                        onClick={() => setStatus(amenity.id, "published")}
                        type="button"
                      >
                        Publish
                      </button>
                    ) : amenity.status === "published" ? (
                      <button
                        className="bb-btn bb-btn-secondary"
                        disabled={busy}
                        onClick={() => setStatus(amenity.id, "draft")}
                        type="button"
                      >
                        Unpublish
                      </button>
                    ) : null}

                    {amenity.status !== "archived" ? (
                      <button
                        className="bb-btn bb-btn-secondary"
                        disabled={busy}
                        onClick={() => setStatus(amenity.id, "archived")}
                        type="button"
                      >
                        Archive
                      </button>
                    ) : null}

                    {amenity.operationalStatus === "open" ? (
                      <button
                        className="bb-btn bb-btn-secondary"
                        disabled={busy}
                        onClick={() => setOperational(amenity.id, "maintenance")}
                        type="button"
                      >
                        Close for maintenance
                      </button>
                    ) : (
                      <button
                        className="bb-btn bb-btn-secondary"
                        disabled={busy}
                        onClick={() => setOperational(amenity.id, "open")}
                        type="button"
                      >
                        Reopen
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {tab === "calendar" ? (
        <section className="bb-card bb-card-pad">
          <h2 className="bb-card-title">Upcoming bookings</h2>
          {workspace.upcomingBookings.length === 0 ? (
            <p className="bb-card-copy">Nothing booked yet.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {workspace.upcomingBookings.map((booking) => (
                <BookingRow
                  booking={booking}
                  busy={busy}
                  key={booking.id}
                  onDecision={decide}
                />
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {tab === "approvals" ? (
        <section className="bb-card bb-card-pad">
          <h2 className="bb-card-title">Waiting for you</h2>
          {workspace.pendingApprovals.length === 0 ? (
            <p className="bb-card-copy">No requests need a decision.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {workspace.pendingApprovals.map((booking) => (
                <BookingRow
                  booking={booking}
                  busy={busy}
                  key={booking.id}
                  onDecision={decide}
                />
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {tab === "issues" ? (
        <section className="bb-card bb-card-pad">
          <h2 className="bb-card-title">Open reports</h2>
          <p className="bb-card-copy">
            These are your HOA&apos;s own tickets. They never reach Bundleen
            support, and internal notes are never shown to the resident.
          </p>
          {workspace.openIssues.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">Nothing open. </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {workspace.openIssues.map((issue) => (
                <IssueCard
                  busy={busy}
                  issue={issue}
                  key={issue.id}
                  onReply={replyToIssue}
                  onUpdate={updateIssue}
                  staff={workspace.staff}
                />
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {tab === "messages" ? (
        <section className="bb-card bb-card-pad">
          <h2 className="bb-card-title">Message residents</h2>
          <p className="bb-card-copy">
            Scoped to {workspace.communityName}. You cannot reach another HOA or
            the Bundleen-wide audience from here.
          </p>

          <div className="mt-4 space-y-3">
            <label className="block text-sm">
              <span className="font-semibold text-slate-700">Who</span>
              <select
                className="mt-1 w-full rounded-lg border border-[var(--line,#e2e8f0)] px-3 py-2 text-sm"
                onChange={(event) => {
                  setAudience(event.target.value as typeof audience);
                  setPreview(null);
                }}
                value={audience}
              >
                <option value="all_residents">All active residents</option>
                <option value="upcoming_bookings">
                  Residents with an upcoming booking
                </option>
                <option value="affected_by_closure">
                  Residents affected by a closure
                </option>
              </select>
            </label>

            {audience !== "all_residents" ? (
              <label className="block text-sm">
                <span className="font-semibold text-slate-700">Which amenity</span>
                <select
                  className="mt-1 w-full rounded-lg border border-[var(--line,#e2e8f0)] px-3 py-2 text-sm"
                  onChange={(event) => {
                    setMessageAmenityId(event.target.value);
                    setPreview(null);
                  }}
                  value={messageAmenityId}
                >
                  {workspace.amenities.map((amenity) => (
                    <option key={amenity.id} value={amenity.id}>
                      {amenity.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            <label className="block text-sm">
              <span className="font-semibold text-slate-700">Subject</span>
              <input
                className="mt-1 w-full rounded-lg border border-[var(--line,#e2e8f0)] px-3 py-2 text-sm"
                maxLength={160}
                onChange={(event) => setSubject(event.target.value)}
                value={subject}
              />
            </label>

            <label className="block text-sm">
              <span className="font-semibold text-slate-700">Message</span>
              <textarea
                className="mt-1 w-full rounded-lg border border-[var(--line,#e2e8f0)] px-3 py-2 text-sm"
                maxLength={5000}
                onChange={(event) => setMessageBody(event.target.value)}
                rows={5}
                value={messageBody}
              />
            </label>

            <label className="flex items-start gap-2 text-sm text-slate-700">
              <input
                checked={urgent}
                className="mt-1"
                onChange={(event) => setUrgent(event.target.checked)}
                type="checkbox"
              />
              <span>
                Urgent safety or closure notice — overrides residents&apos; email
                preferences. Recorded in the audit log with your justification.
              </span>
            </label>

            {urgent ? (
              <label className="block text-sm">
                <span className="font-semibold text-slate-700">Why is this urgent?</span>
                <input
                  className="mt-1 w-full rounded-lg border border-[var(--line,#e2e8f0)] px-3 py-2 text-sm"
                  maxLength={200}
                  onChange={(event) => setJustification(event.target.value)}
                  value={justification}
                />
              </label>
            ) : null}

            {preview ? (
              <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
                {preview.recipientCount} resident
                {preview.recipientCount === 1 ? "" : "s"} · {preview.emailCount} will
                also get an email
                {preview.sample.length > 0 ? ` · e.g. ${preview.sample.join(", ")}` : ""}
              </p>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <button
                className="bb-btn bb-btn-secondary"
                disabled={busy}
                onClick={() => composeMessage("preview")}
                type="button"
              >
                Preview audience
              </button>
              <button
                className="bb-btn bb-btn-secondary"
                disabled={busy}
                onClick={() => composeMessage("test")}
                type="button"
              >
                Send me a test
              </button>
              <button
                className="bb-btn bb-btn-primary"
                disabled={busy || !preview || !subject || !messageBody}
                onClick={() => composeMessage("send")}
                type="button"
              >
                Send to residents
              </button>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
