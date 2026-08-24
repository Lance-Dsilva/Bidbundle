"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type CSSProperties } from "react";

import {
  CATEGORY_LABELS,
  CUSTOMER_STATUS_LABELS,
} from "@/components/admin/support/supportPresentation";
import { EmptyState } from "@/components/ui/EmptyState";
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

const cardStyle: CSSProperties = {
  background: "var(--bg-card)",
  border: "1px solid var(--border-warm)",
  borderRadius: 18,
  boxShadow: "var(--shadow-warm-sm)",
};

const primaryButtonStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  height: 38,
  padding: "0 16px",
  borderRadius: 999,
  border: 0,
  background: "var(--terracotta-600)",
  color: "white",
  fontFamily: "var(--font-body)",
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
  boxShadow: "0 1px 0 rgba(0,0,0,0.05) inset, 0 6px 14px -6px rgba(15,157,138,0.5)",
};

const fieldStyle: CSSProperties = {
  width: "100%",
  border: "1px solid var(--border-warm-strong)",
  borderRadius: 12,
  background: "var(--bg-card)",
  color: "var(--ink-900)",
  fontFamily: "var(--font-body)",
  fontSize: 14,
  outline: "none",
};

function IconSupport() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="28"
      height="28"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 15a4 4 0 0 1-4 4H8l-5 3 1.6-4.8A8 8 0 1 1 21 15Z" />
      <path d="M8.5 11.5h7M8.5 15h4" />
    </svg>
  );
}

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
    <div style={{ background: "var(--bg-app)", minHeight: "100vh" }}>
      <header className="flex flex-col gap-4 px-4 pb-4 pt-6 md:flex-row md:items-end md:justify-between md:px-9 md:pb-5 md:pt-7">
        <div className="min-w-0">
          <h1
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: 500,
              fontSize: "clamp(24px, 6vw, 30px)",
              letterSpacing: "-0.02em",
              margin: "0 0 4px",
              color: "var(--ink-900)",
            }}
          >
            Get help from Bundleen
          </h1>
          <p style={{ margin: 0, color: "var(--ink-500)", fontSize: 14 }}>
            Open a request and we will reply in this thread. You will get an email and an in-app
            notification when we respond.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setComposerOpen((open) => !open)}
          style={primaryButtonStyle}
        >
          {composerOpen ? "Cancel" : "New request"}
        </button>
      </header>

      <div className="space-y-5 px-4 pb-8 md:px-9 md:pb-9">
      {success ? (
        <p role="status" className="rounded-xl bg-emerald-50 px-4 py-3 text-[13px] font-medium text-emerald-800" style={{ border: "1px solid var(--sage-100)" }}>
          {success}
        </p>
      ) : null}

      {composerOpen ? (
        <section style={{ ...cardStyle, padding: 22 }}>
          <h2 style={{ margin: 0, color: "var(--ink-900)", fontFamily: "var(--font-display)", fontSize: 19, fontWeight: 500 }}>
            What do you need help with?
          </h2>
          <p style={{ margin: "5px 0 0", color: "var(--ink-500)", fontSize: 13 }}>
            Share the issue and our support team will keep every update in one thread.
          </p>

          <label className="mt-4 block">
            <span className="text-[11px] font-bold uppercase tracking-[0.1em]" style={{ color: "var(--ink-500)" }}>
              Topic
            </span>
            <select
              value={category}
              onChange={(event) =>
                setCategory(event.target.value as SupportTicketCategoryValue)
              }
              className="mt-1.5 h-11 px-3"
              style={fieldStyle}
            >
              {SUPPORT_TICKET_CATEGORIES.map((value) => (
                <option key={value} value={value}>
                  {CATEGORY_LABELS[value]}
                </option>
              ))}
            </select>
          </label>

          <label className="mt-3 block">
            <span className="text-[11px] font-bold uppercase tracking-[0.1em]" style={{ color: "var(--ink-500)" }}>
              Subject
            </span>
            <input
              type="text"
              value={subject}
              maxLength={MAX_TICKET_SUBJECT_LENGTH}
              onChange={(event) => setSubject(event.target.value)}
              placeholder="A one-line summary"
              className="mt-1.5 h-11 px-3.5"
              style={fieldStyle}
            />
          </label>

          <label className="mt-3 block">
            <span className="text-[11px] font-bold uppercase tracking-[0.1em]" style={{ color: "var(--ink-500)" }}>
              Details
            </span>
            <textarea
              value={message}
              rows={6}
              maxLength={MAX_TICKET_MESSAGE_LENGTH}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="What happened, what you expected, and anything you already tried."
              className="mt-1.5 px-3.5 py-3 leading-6"
              style={fieldStyle}
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
            className="mt-4 disabled:cursor-not-allowed disabled:opacity-40"
            style={{ ...primaryButtonStyle, height: 42, padding: "0 20px" }}
          >
            {busy ? "Sending…" : "Send request"}
          </button>
        </section>
      ) : null}

      <section>
        <div className="flex items-end justify-between gap-3 px-1">
          <div>
            <h2 style={{ margin: 0, color: "var(--ink-900)", fontFamily: "var(--font-display)", fontSize: 20, fontWeight: 500 }}>
              Your requests
            </h2>
            <p style={{ margin: "3px 0 0", color: "var(--ink-500)", fontSize: 12.5 }}>
              Track replies and keep the conversation together.
            </p>
          </div>
          {!loading ? (
            <span style={{ color: "var(--ink-400)", fontSize: 12 }}>
              {tickets.length} ticket{tickets.length === 1 ? "" : "s"}
            </span>
          ) : null}
        </div>
        {loading ? (
          <p role="status" className="mt-3 px-1 text-[13px]" style={{ color: "var(--ink-500)" }}>
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
          <div className="mt-3 overflow-hidden" style={cardStyle}>
            <EmptyState
              icon={<IconSupport />}
              title="No support requests yet"
              hint="Open a request when you need help. Replies and status updates will appear here."
              ctaLabel="Open your first request"
              onCta={() => setComposerOpen(true)}
            />
          </div>
        ) : (
          <ul className="mt-3 space-y-2">
            {tickets.map((ticket) => (
              <li key={ticket.id}>
                <Link
                  href={`${basePath}/${ticket.id}`}
                  className="block p-4 transition hover:-translate-y-0.5 md:px-[22px]"
                  style={{ ...cardStyle, color: "inherit", textDecoration: "none" }}
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
                  <p className="mt-1.5 truncate text-[14px] font-bold" style={{ color: "var(--ink-900)" }}>
                    {ticket.subject}
                  </p>
                  <p className="mt-0.5 text-[11px]" style={{ color: "var(--ink-500)" }}>
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
    </div>
  );
}
