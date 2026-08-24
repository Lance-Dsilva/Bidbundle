"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  AdminCard,
  AdminDetailLayout,
  AdminErrorState,
  AdminLoadingState,
  AdminPropertyRow,
  AdminStatusBadge,
  formatDateTime,
  formatRelative,
} from "@/components/admin/primitives";
import { TicketAiPanel } from "@/components/admin/support/TicketAiPanel";
import {
  CATEGORY_LABELS,
  PRIORITY_LABELS,
  PRIORITY_TONES,
  STATUS_LABELS,
  STATUS_TONES,
  eventLabel,
  optionsFrom,
} from "@/components/admin/support/supportPresentation";
import type {
  SupportTicketCategoryValue,
  SupportTicketPriorityValue,
  SupportTicketStatusValue,
} from "@/lib/validation/support";

/**
 * One ticket, end to end: the conversation, the reply composer, internal notes,
 * the property rail, the event timeline, and the AI assistance panel.
 *
 * Every mutation sends `expectedUpdatedAt` — the value this view was rendered
 * from — so a second admin working the same ticket gets a clear 409 rather
 * than silently losing their reply.
 */

export type AdminTicketMessage = {
  id: string;
  kind: "customer_reply" | "admin_reply" | "internal_note";
  body: string;
  authorName: string;
  authorSide: "you" | "support" | "customer";
  fromAi: boolean;
  createdAt: string;
};

export type AdminTicketDetailView = {
  id: string;
  ticketNumber: string;
  subject: string;
  category: SupportTicketCategoryValue;
  status: SupportTicketStatusValue;
  priority: SupportTicketPriorityValue;
  requesterName: string;
  requesterEmail: string;
  requesterRole: string;
  requesterUserId: string;
  communityId: string | null;
  communityName: string | null;
  assignedAdminUserId: string | null;
  assignedAdminName: string | null;
  awaitingAdminReply: boolean;
  firstResponseOverdue: boolean;
  ageHours: number;
  lastActivityAt: string;
  createdAt: string;
  updatedAt: string;
  messages: AdminTicketMessage[];
  events: {
    id: string;
    type: string;
    actorName: string | null;
    fromValue: string | null;
    toValue: string | null;
    createdAt: string;
  }[];
  relatedRequestId: string | null;
  relatedBidId: string | null;
  relatedVisitId: string | null;
  reopenedFromTicketId: string | null;
};

type Feedback = { tone: "success" | "error"; message: string } | null;

export function AdminTicketWorkspace({ ticketId }: { ticketId: string }) {
  const [ticket, setTicket] = useState<AdminTicketDetailView | null>(null);
  const [assignees, setAssignees] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [internal, setInternal] = useState(false);
  const [replyStatus, setReplyStatus] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const threadRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [ticketResponse, queueResponse] = await Promise.all([
        fetch(`/api/admin/support/tickets/${ticketId}`, { credentials: "same-origin" }),
        fetch("/api/admin/support/tickets?pageSize=1", { credentials: "same-origin" }),
      ]);
      if (!ticketResponse.ok) throw new Error("load failed");
      const payload = (await ticketResponse.json()) as { ticket: AdminTicketDetailView };
      setTicket(payload.ticket);
      if (queueResponse.ok) {
        const queue = (await queueResponse.json()) as {
          assignees: { id: string; name: string }[];
        };
        setAssignees(queue.assignees);
      }
    } catch {
      setLoadError("This ticket could not be loaded. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, [ticketId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight });
  }, [ticket?.messages.length]);

  /** Every mutation funnels through here so the conflict path is written once. */
  const mutate = async (
    input: RequestInfo,
    init: RequestInit,
    successMessage: string,
  ): Promise<boolean> => {
    setBusy(true);
    setFeedback(null);
    try {
      const response = await fetch(input, { credentials: "same-origin", ...init });
      const payload = (await response.json().catch(() => null)) as
        | { ticket?: AdminTicketDetailView; error?: string; fields?: Record<string, string> }
        | null;

      if (!response.ok) {
        if (response.status === 409) {
          // Reload so the admin sees the colleague's change before retrying.
          await load();
        }
        const firstFieldError = payload?.fields ? Object.values(payload.fields)[0] : undefined;
        setFeedback({
          tone: "error",
          message: firstFieldError ?? payload?.error ?? "That did not work. Please try again.",
        });
        return false;
      }

      if (payload?.ticket) setTicket(payload.ticket);
      else await load();
      setFeedback({ tone: "success", message: successMessage });
      return true;
    } catch {
      setFeedback({
        tone: "error",
        message: "We could not reach Bundleen. Check your connection and try again.",
      });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const sendMessage = async () => {
    if (!ticket || !reply.trim()) return;
    const sent = await mutate(
      `/api/admin/support/tickets/${ticket.id}/messages`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedUpdatedAt: ticket.updatedAt,
          message: reply,
          internal,
          ...(replyStatus ? { status: replyStatus } : {}),
        }),
      },
      internal ? "Internal note added." : "Reply sent to the customer.",
    );
    if (sent) {
      setReply("");
      setReplyStatus("");
    }
  };

  const updateField = (patch: Record<string, unknown>, message: string) => {
    if (!ticket) return;
    void mutate(
      `/api/admin/support/tickets/${ticket.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedUpdatedAt: ticket.updatedAt, ...patch }),
      },
      message,
    );
  };

  if (loading && !ticket) return <AdminLoadingState label="Loading the ticket…" />;
  if (loadError) {
    return (
      <AdminErrorState
        body={loadError}
        retry={
          <button
            type="button"
            onClick={() => void load()}
            className="h-9 rounded-lg bg-rose-600 px-4 text-[12px] font-bold text-white"
          >
            Try again
          </button>
        }
      />
    );
  }
  if (!ticket) return null;

  return (
    <AdminDetailLayout
      main={
        <>
          <AdminCard title="Conversation" subtitle={`${ticket.messages.length} messages`} padded={false}>
            <div ref={threadRef} className="max-h-[560px] space-y-3 overflow-y-auto p-5">
              {ticket.messages.map((message) => (
                <article
                  key={message.id}
                  className={`rounded-xl border p-3.5 ${
                    message.kind === "internal_note"
                      ? "border-amber-200 bg-amber-50"
                      : message.kind === "admin_reply"
                        ? "border-emerald-200 bg-emerald-50/60"
                        : "border-slate-200 bg-white"
                  }`}
                >
                  <header className="flex flex-wrap items-center gap-2">
                    <span className="text-[11px] font-bold text-slate-900">
                      {message.authorName}
                    </span>
                    {message.kind === "internal_note" ? (
                      <AdminStatusBadge label="Internal only" tone="warning" withDot={false} />
                    ) : null}
                    {message.fromAi ? (
                      <AdminStatusBadge label="AI-assisted" tone="accent" withDot={false} />
                    ) : null}
                    <span className="ml-auto text-[10px] text-slate-500">
                      {formatDateTime(message.createdAt)}
                    </span>
                  </header>
                  {/* Plain text, rendered as text. Customer content is never
                      interpreted as markup anywhere in this product. */}
                  <p className="mt-2 whitespace-pre-wrap break-words text-[12px] leading-5 text-slate-700">
                    {message.body}
                  </p>
                </article>
              ))}
            </div>

            <div className="border-t border-slate-200 bg-slate-50/60 p-4">
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex rounded-lg border border-slate-300 bg-white p-0.5">
                  <button
                    type="button"
                    onClick={() => setInternal(false)}
                    className={`h-8 rounded-md px-3 text-[12px] font-bold transition ${
                      internal ? "text-slate-500" : "bg-emerald-600 text-white"
                    }`}
                  >
                    Reply to customer
                  </button>
                  <button
                    type="button"
                    onClick={() => setInternal(true)}
                    className={`h-8 rounded-md px-3 text-[12px] font-bold transition ${
                      internal ? "bg-amber-500 text-white" : "text-slate-500"
                    }`}
                  >
                    Internal note
                  </button>
                </div>
                <label className="ml-auto flex items-center gap-2 text-[11px] font-semibold text-slate-600">
                  Then set status
                  <select
                    value={replyStatus}
                    onChange={(event) => setReplyStatus(event.target.value)}
                    className="h-8 rounded-lg border border-slate-300 bg-white px-2 text-[12px]"
                  >
                    <option value="">Leave as is</option>
                    {optionsFrom(STATUS_LABELS).map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <textarea
                value={reply}
                onChange={(event) => setReply(event.target.value)}
                rows={5}
                placeholder={
                  internal
                    ? "Notes for the team. The customer never sees this."
                    : "Write your reply. The customer receives this by email and in-app."
                }
                className="mt-3 w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-[12px] leading-5 text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
              />

              {feedback ? (
                <p
                  role={feedback.tone === "error" ? "alert" : "status"}
                  className={`mt-2 text-[12px] font-medium ${
                    feedback.tone === "error" ? "text-rose-700" : "text-emerald-700"
                  }`}
                >
                  {feedback.message}
                </p>
              ) : null}

              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  disabled={busy || !reply.trim()}
                  onClick={() => void sendMessage()}
                  className={`h-10 rounded-lg px-5 text-[12px] font-bold text-white transition disabled:opacity-40 ${
                    internal ? "bg-amber-500 hover:bg-amber-600" : "bg-emerald-600 hover:bg-emerald-700"
                  }`}
                >
                  {busy ? "Sending…" : internal ? "Add internal note" : "Send reply"}
                </button>
                <p className="text-[11px] text-slate-500">
                  {internal
                    ? "Internal notes never appear in customer APIs, exports, or email."
                    : "Sends an email and an in-app notification linking back to this thread."}
                </p>
              </div>
            </div>
          </AdminCard>

          <TicketAiPanel
            ticketId={ticket.id}
            expectedUpdatedAt={ticket.updatedAt}
            onSent={(updated) => {
              setTicket(updated);
              setFeedback({ tone: "success", message: "AI-assisted reply sent." });
            }}
            onConflict={() => void load()}
          />

          <AdminCard title="Activity" subtitle="Assignment, status, priority, and AI events">
            <ol className="space-y-2.5">
              {ticket.events.map((event) => (
                <li key={event.id} className="flex flex-wrap items-baseline gap-x-2 text-[12px]">
                  <span className="font-semibold text-slate-800">
                    {event.actorName ?? "Bundleen"}
                  </span>
                  <span className="text-slate-600">{eventLabel(event.type)}</span>
                  {event.fromValue || event.toValue ? (
                    <span className="text-slate-500">
                      {event.fromValue ? `${event.fromValue} → ` : ""}
                      {event.toValue ?? "—"}
                    </span>
                  ) : null}
                  <span className="ml-auto text-[10px] text-slate-400">
                    {formatDateTime(event.createdAt)}
                  </span>
                </li>
              ))}
            </ol>
          </AdminCard>
        </>
      }
      aside={
        <>
          <AdminCard title="Ticket">
            <dl className="divide-y divide-slate-100">
              <AdminPropertyRow label="Number">{ticket.ticketNumber}</AdminPropertyRow>
              <AdminPropertyRow label="Status">
                <select
                  value={ticket.status}
                  disabled={busy}
                  onChange={(event) =>
                    updateField({ status: event.target.value }, "Status updated.")
                  }
                  className="h-8 rounded-lg border border-slate-300 bg-white px-2 text-[12px] font-medium"
                >
                  {optionsFrom(STATUS_LABELS).map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </AdminPropertyRow>
              <AdminPropertyRow label="Priority">
                <select
                  value={ticket.priority}
                  disabled={busy}
                  onChange={(event) =>
                    updateField({ priority: event.target.value }, "Priority updated.")
                  }
                  className="h-8 rounded-lg border border-slate-300 bg-white px-2 text-[12px] font-medium"
                >
                  {optionsFrom(PRIORITY_LABELS).map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </AdminPropertyRow>
              <AdminPropertyRow label="Assignee">
                <select
                  value={ticket.assignedAdminUserId ?? ""}
                  disabled={busy}
                  onChange={(event) =>
                    updateField(
                      { assignedAdminUserId: event.target.value || null },
                      event.target.value ? "Ticket assigned." : "Assignee removed.",
                    )
                  }
                  className="h-8 max-w-[170px] rounded-lg border border-slate-300 bg-white px-2 text-[12px] font-medium"
                >
                  <option value="">Unassigned</option>
                  {assignees.map((admin) => (
                    <option key={admin.id} value={admin.id}>
                      {admin.name}
                    </option>
                  ))}
                </select>
              </AdminPropertyRow>
              <AdminPropertyRow label="Category">
                {CATEGORY_LABELS[ticket.category]}
              </AdminPropertyRow>
              <AdminPropertyRow label="Opened">
                {formatDateTime(ticket.createdAt)}
              </AdminPropertyRow>
              <AdminPropertyRow label="Last activity">
                {formatRelative(ticket.lastActivityAt)}
              </AdminPropertyRow>
            </dl>
            {ticket.firstResponseOverdue ? (
              <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-[11px] font-semibold text-rose-700">
                No first response yet — past the SLA for {PRIORITY_LABELS[ticket.priority]} priority.
              </p>
            ) : null}
          </AdminCard>

          <AdminCard title="Requester">
            <dl className="divide-y divide-slate-100">
              <AdminPropertyRow label="Name">{ticket.requesterName}</AdminPropertyRow>
              <AdminPropertyRow label="Email">
                <span className="break-all">{ticket.requesterEmail}</span>
              </AdminPropertyRow>
              <AdminPropertyRow label="Role">
                <span className="capitalize">{ticket.requesterRole}</span>
              </AdminPropertyRow>
              {ticket.communityName ? (
                <AdminPropertyRow label="Community">
                  <a
                    className="text-emerald-700 underline"
                    href={`/app/admin/communities/${ticket.communityId}`}
                  >
                    {ticket.communityName}
                  </a>
                </AdminPropertyRow>
              ) : null}
              {ticket.requesterRole === "provider" ? (
                <AdminPropertyRow label="Provider record">
                  <a
                    className="text-emerald-700 underline"
                    href={`/app/admin/providers/${ticket.requesterUserId}`}
                  >
                    Open
                  </a>
                </AdminPropertyRow>
              ) : null}
            </dl>
          </AdminCard>

          {ticket.relatedRequestId || ticket.relatedBidId || ticket.relatedVisitId ? (
            <AdminCard title="Linked records">
              <dl className="divide-y divide-slate-100">
                {ticket.relatedRequestId ? (
                  <AdminPropertyRow label="Request">
                    <code className="text-[10px]">{ticket.relatedRequestId}</code>
                  </AdminPropertyRow>
                ) : null}
                {ticket.relatedBidId ? (
                  <AdminPropertyRow label="Bid">
                    <code className="text-[10px]">{ticket.relatedBidId}</code>
                  </AdminPropertyRow>
                ) : null}
                {ticket.relatedVisitId ? (
                  <AdminPropertyRow label="Visit">
                    <code className="text-[10px]">{ticket.relatedVisitId}</code>
                  </AdminPropertyRow>
                ) : null}
              </dl>
            </AdminCard>
          ) : null}
        </>
      }
    />
  );
}

export { STATUS_TONES, PRIORITY_TONES };
