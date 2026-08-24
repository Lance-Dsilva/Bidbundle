"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import {
  CATEGORY_LABELS,
  CUSTOMER_STATUS_LABELS,
} from "@/components/admin/support/supportPresentation";
import {
  MAX_TICKET_MESSAGE_LENGTH,
  MAX_TICKET_SUBJECT_LENGTH,
  SUPPORT_TICKET_CATEGORIES,
  type SupportTicketCategoryValue,
  type SupportTicketStatusValue,
} from "@/lib/validation/support";

/**
 * The customer support centre: raise a ticket, then follow it as a
 * conversation.
 *
 * Everything shown here comes from `/api/support/**`, which scopes every read
 * to the signed-in account. Internal notes and AI explanations are excluded on
 * the server, so this component has no filtering responsibility it could get
 * wrong.
 */

type TicketSummary = {
  id: string;
  ticketNumber: string;
  subject: string;
  category: SupportTicketCategoryValue;
  status: SupportTicketStatusValue;
  messageCount: number;
  lastActivityAt: string;
  createdAt: string;
};

const STATUS_STYLES: Record<SupportTicketStatusValue, string> = {
  new: "bg-sky-50 text-sky-700",
  open: "bg-violet-50 text-violet-700",
  pending_customer: "bg-amber-50 text-amber-800",
  pending_internal: "bg-violet-50 text-violet-700",
  resolved: "bg-emerald-50 text-emerald-700",
  closed: "bg-slate-100 text-slate-600",
};

function relative(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function SupportCenter({ basePath = "/app/support" }: { basePath?: string }) {
  const [tickets, setTickets] = useState<TicketSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [subject, setSubject] = useState("");
  const [category, setCategory] = useState<SupportTicketCategoryValue>("account");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const response = await fetch("/api/support/tickets", { credentials: "same-origin" });
      if (!response.ok) throw new Error("load failed");
      const payload = (await response.json()) as { tickets: TicketSummary[] };
      setTickets(payload.tickets);
    } catch {
      setLoadError("We could not load your support requests. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch("/api/support/tickets", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject, category, message }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { ticket?: TicketSummary; error?: string; fields?: Record<string, string> }
        | null;

      if (!response.ok || !payload?.ticket) {
        const firstFieldError = payload?.fields ? Object.values(payload.fields)[0] : undefined;
        setError(firstFieldError ?? payload?.error ?? "We could not open your request.");
        return;
      }

      setSuccess(
        `Ticket ${payload.ticket.ticketNumber} opened. We will email you when we reply.`,
      );
      setSubject("");
      setMessage("");
      setComposerOpen(false);
      await load();
    } catch {
      setError("We could not reach Bundleen. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-teal-700">Support</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">
            Get help from Bundleen
          </h1>
          <p className="mt-1 max-w-prose text-[13px] leading-5 text-slate-500">
            Open a request and we will reply in this thread. You will get an email and an in-app
            notification when we respond.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setComposerOpen((open) => !open)}
          className="h-10 shrink-0 rounded-xl bg-teal-600 px-4 text-[13px] font-bold text-white transition hover:bg-teal-700"
        >
          {composerOpen ? "Cancel" : "New request"}
        </button>
      </header>

      {success ? (
        <p role="status" className="rounded-xl bg-emerald-50 px-4 py-3 text-[13px] font-medium text-emerald-800">
          {success}
        </p>
      ) : null}

      {composerOpen ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-[15px] font-bold text-slate-900">What do you need help with?</h2>

          <label className="mt-4 block">
            <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-500">
              Topic
            </span>
            <select
              value={category}
              onChange={(event) =>
                setCategory(event.target.value as SupportTicketCategoryValue)
              }
              className="mt-1.5 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-[14px]"
            >
              {SUPPORT_TICKET_CATEGORIES.map((value) => (
                <option key={value} value={value}>
                  {CATEGORY_LABELS[value]}
                </option>
              ))}
            </select>
          </label>

          <label className="mt-3 block">
            <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-500">
              Subject
            </span>
            <input
              type="text"
              value={subject}
              maxLength={MAX_TICKET_SUBJECT_LENGTH}
              onChange={(event) => setSubject(event.target.value)}
              placeholder="A one-line summary"
              className="mt-1.5 h-11 w-full rounded-xl border border-slate-300 bg-white px-3.5 text-[14px]"
            />
          </label>

          <label className="mt-3 block">
            <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-500">
              Details
            </span>
            <textarea
              value={message}
              rows={6}
              maxLength={MAX_TICKET_MESSAGE_LENGTH}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="What happened, what you expected, and anything you already tried."
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
            disabled={busy || !subject.trim() || !message.trim()}
            onClick={() => void submit()}
            className="mt-4 h-11 rounded-xl bg-teal-600 px-5 text-[13px] font-bold text-white transition hover:bg-teal-700 disabled:opacity-40"
          >
            {busy ? "Sending…" : "Send request"}
          </button>
        </section>
      ) : null}

      <section>
        <h2 className="px-1 text-[13px] font-bold text-slate-900">Your requests</h2>
        {loading ? (
          <p role="status" className="mt-3 px-1 text-[13px] text-slate-500">
            Loading…
          </p>
        ) : loadError ? (
          <div role="alert" className="mt-3 rounded-xl bg-red-50 px-4 py-3">
            <p className="text-[13px] font-medium text-red-700">{loadError}</p>
            <button
              type="button"
              onClick={() => void load()}
              className="mt-2 text-[12px] font-bold text-red-700 underline"
            >
              Try again
            </button>
          </div>
        ) : tickets.length === 0 ? (
          <div className="mt-3 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-6 py-10 text-center">
            <p className="text-[14px] font-bold text-slate-800">No requests yet</p>
            <p className="mx-auto mt-1 max-w-sm text-[12px] text-slate-500">
              When you open a request it appears here with our replies.
            </p>
          </div>
        ) : (
          <ul className="mt-3 space-y-2">
            {tickets.map((ticket) => (
              <li key={ticket.id}>
                <Link
                  href={`${basePath}/${ticket.id}`}
                  className="block rounded-2xl border border-slate-200 bg-white p-4 transition hover:border-slate-300 hover:shadow-sm"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-md px-2 py-0.5 text-[10px] font-bold ${STATUS_STYLES[ticket.status]}`}
                    >
                      {CUSTOMER_STATUS_LABELS[ticket.status]}
                    </span>
                    <span className="text-[11px] text-slate-500">{ticket.ticketNumber}</span>
                    <span className="ml-auto text-[11px] text-slate-400">
                      {relative(ticket.lastActivityAt)}
                    </span>
                  </div>
                  <p className="mt-1.5 truncate text-[14px] font-bold text-slate-900">
                    {ticket.subject}
                  </p>
                  <p className="mt-0.5 text-[11px] text-slate-500">
                    {CATEGORY_LABELS[ticket.category]} · {ticket.messageCount} message
                    {ticket.messageCount === 1 ? "" : "s"}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
