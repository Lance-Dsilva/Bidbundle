"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  CATEGORY_LABELS,
  CUSTOMER_STATUS_LABELS,
} from "@/components/admin/support/supportPresentation";
import {
  MAX_TICKET_MESSAGE_LENGTH,
  type SupportTicketCategoryValue,
  type SupportTicketStatusValue,
} from "@/lib/validation/support";

/**
 * One support conversation, from the customer's side.
 *
 * The thread it renders comes from `/api/support/tickets/[ticketId]`, which
 * excludes internal notes and never touches the AI draft table — so there is no
 * server data here that could leak staff-only content even if this component
 * rendered everything it received.
 */

type ThreadMessage = {
  id: string;
  kind: "customer_reply" | "admin_reply" | "internal_note";
  body: string;
  authorName: string;
  authorSide: "you" | "support" | "customer";
  createdAt: string;
};

type TicketDetail = {
  id: string;
  ticketNumber: string;
  subject: string;
  category: SupportTicketCategoryValue;
  status: SupportTicketStatusValue;
  messages: ThreadMessage[];
  canReply: boolean;
  canReopen: boolean;
  createdAt: string;
  lastActivityAt: string;
};

function timestamp(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function SupportThread({
  ticketId,
  basePath = "/app/support",
}: {
  ticketId: string;
  basePath?: string;
}) {
  const [ticket, setTicket] = useState<TicketDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const response = await fetch(`/api/support/tickets/${ticketId}`, {
        credentials: "same-origin",
      });
      if (!response.ok) {
        setLoadError(
          response.status === 404
            ? "This request could not be found."
            : "We could not load this request. Try again shortly.",
        );
        return;
      }
      const payload = (await response.json()) as { ticket: TicketDetail };
      setTicket(payload.ticket);
    } catch {
      setLoadError("We could not reach Bundleen. Check your connection and try again.");
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

  const send = async (path: string, successReset = true) => {
    if (!reply.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(path, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: reply }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { ticket?: TicketDetail; error?: string; fields?: Record<string, string> }
        | null;

      if (!response.ok || !payload?.ticket) {
        const firstFieldError = payload?.fields ? Object.values(payload.fields)[0] : undefined;
        setError(firstFieldError ?? payload?.error ?? "Your message could not be sent.");
        return;
      }

      setTicket(payload.ticket);
      if (successReset) setReply("");
      // A reopen can create a *linked follow-up* rather than reopening in
      // place, in which case the customer belongs on that new thread.
      if (payload.ticket.id !== ticketId) {
        window.location.assign(`${basePath}/${payload.ticket.id}`);
      }
    } catch {
      setError("We could not reach Bundleen. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  if (loading && !ticket) {
    return (
      <p role="status" className="mx-auto max-w-3xl px-1 text-[13px] text-slate-500">
        Loading your request…
      </p>
    );
  }

  if (loadError) {
    return (
      <div role="alert" className="mx-auto max-w-3xl rounded-2xl bg-red-50 px-5 py-4">
        <p className="text-[14px] font-bold text-red-800">{loadError}</p>
        <Link href={basePath} className="mt-2 inline-block text-[12px] font-bold text-red-700 underline">
          Back to your requests
        </Link>
      </div>
    );
  }

  if (!ticket) return null;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4">
      <Link
        href={basePath}
        className="inline-flex items-center gap-1 text-[12px] font-bold text-slate-500 transition hover:text-slate-800"
      >
        <span aria-hidden="true">←</span> Your requests
      </Link>

      <header className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600">
            {CUSTOMER_STATUS_LABELS[ticket.status]}
          </span>
          <span className="text-[11px] text-slate-500">{ticket.ticketNumber}</span>
        </div>
        <h1 className="mt-2 text-xl font-bold tracking-tight text-slate-900">{ticket.subject}</h1>
        <p className="mt-1 text-[12px] text-slate-500">
          {CATEGORY_LABELS[ticket.category]} · opened {timestamp(ticket.createdAt)}
        </p>
      </header>

      <div
        ref={threadRef}
        className="max-h-[520px] space-y-3 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-4"
      >
        {ticket.messages.map((message) => (
          <article
            key={message.id}
            className={`rounded-xl p-4 ${
              message.authorSide === "support"
                ? "bg-teal-50"
                : "border border-slate-200 bg-white"
            }`}
          >
            <header className="flex flex-wrap items-baseline gap-2">
              <span className="text-[12px] font-bold text-slate-900">{message.authorName}</span>
              <span className="ml-auto text-[11px] text-slate-500">
                {timestamp(message.createdAt)}
              </span>
            </header>
            {/* Plain text. Nothing a customer or an agent writes is ever
                rendered as markup. */}
            <p className="mt-2 whitespace-pre-wrap break-words text-[13px] leading-6 text-slate-700">
              {message.body}
            </p>
          </article>
        ))}
      </div>

      {ticket.canReply ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <label className="block">
            <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-500">
              Reply
            </span>
            <textarea
              value={reply}
              rows={4}
              maxLength={MAX_TICKET_MESSAGE_LENGTH}
              onChange={(event) => setReply(event.target.value)}
              placeholder="Add anything else that would help us."
              className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3.5 py-3 text-[14px] leading-6"
            />
          </label>
          {error ? (
            <p role="alert" className="mt-2 text-[13px] font-medium text-red-600">
              {error}
            </p>
          ) : null}
          <button
            type="button"
            disabled={busy || !reply.trim()}
            onClick={() => void send(`/api/support/tickets/${ticket.id}/messages`)}
            className="mt-3 h-11 rounded-xl bg-teal-600 px-5 text-[13px] font-bold text-white transition hover:bg-teal-700 disabled:opacity-40"
          >
            {busy ? "Sending…" : "Send reply"}
          </button>
        </section>
      ) : ticket.canReopen ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-[13px] font-bold text-slate-900">Still not right?</p>
          <p className="mt-0.5 text-[12px] leading-5 text-slate-500">
            Tell us what is still wrong and we will pick this back up.
          </p>
          <textarea
            value={reply}
            rows={4}
            maxLength={MAX_TICKET_MESSAGE_LENGTH}
            onChange={(event) => setReply(event.target.value)}
            className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3.5 py-3 text-[14px] leading-6"
          />
          {error ? (
            <p role="alert" className="mt-2 text-[13px] font-medium text-red-600">
              {error}
            </p>
          ) : null}
          <button
            type="button"
            disabled={busy || !reply.trim()}
            onClick={() => void send(`/api/support/tickets/${ticket.id}/reopen`)}
            className="mt-3 h-11 rounded-xl bg-teal-600 px-5 text-[13px] font-bold text-white disabled:opacity-40"
          >
            {busy ? "Reopening…" : "Reopen this request"}
          </button>
        </section>
      ) : (
        <section className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-center">
          <p className="text-[13px] font-medium text-slate-600">
            This request is closed.{" "}
            <Link className="font-bold text-teal-700 underline" href={basePath}>
              Open a new one
            </Link>{" "}
            and we will link it to this conversation.
          </p>
        </section>
      )}
    </div>
  );
}
