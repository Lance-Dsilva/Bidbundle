"use client";

import { useCallback, useEffect, useState } from "react";

import { AdminCard, AdminStatusBadge, formatDateTime } from "@/components/admin/primitives";
import type { AdminTicketDetailView } from "@/components/admin/support/AdminTicketWorkspace";

/**
 * AI assistance for one ticket: a draft reply the admin owns, and a separate
 * internal explanation the customer never sees.
 *
 * The safety story this component is part of:
 *
 * - `Generate reply` calls POST, which only ever writes a draft row. There is
 *   no code path from generation to delivery.
 * - `Approve and send` calls PUT with the text currently in the textarea, so
 *   what the customer receives is what the admin approved after editing — not
 *   the model's original output.
 * - The explanation lives in its own collapsed section, is labelled internal in
 *   the UI, and is never copied into the reply composer by any action here.
 */

type DraftView = {
  id: string;
  kind: "reply" | "explanation";
  status: "generated" | "discarded" | "approved";
  content: string;
  model: string;
  generatedByName: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
  createdAt: string;
};

type PanelState = { tone: "error" | "info"; message: string } | null;

export function TicketAiPanel({
  ticketId,
  expectedUpdatedAt,
  onSent,
  onConflict,
}: {
  ticketId: string;
  expectedUpdatedAt: string;
  onSent: (ticket: AdminTicketDetailView) => void;
  onConflict: () => void;
}) {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [draft, setDraft] = useState<DraftView | null>(null);
  const [editedText, setEditedText] = useState("");
  const [explanation, setExplanation] = useState<DraftView | null>(null);
  const [explanationOpen, setExplanationOpen] = useState(false);
  const [generating, setGenerating] = useState<"reply" | "explanation" | null>(null);
  const [sending, setSending] = useState(false);
  const [state, setState] = useState<PanelState>(null);

  const load = useCallback(async () => {
    try {
      const [draftResponse, explanationResponse] = await Promise.all([
        fetch(`/api/admin/support/tickets/${ticketId}/ai-draft`, { credentials: "same-origin" }),
        fetch(`/api/admin/support/tickets/${ticketId}/ai-explanation`, {
          credentials: "same-origin",
        }),
      ]);
      if (draftResponse.ok) {
        const payload = (await draftResponse.json()) as {
          available: boolean;
          drafts: DraftView[];
        };
        setAvailable(payload.available);
        const pending = payload.drafts.find((entry) => entry.status === "generated") ?? null;
        setDraft(pending);
        setEditedText(pending?.content ?? "");
      }
      if (explanationResponse.ok) {
        const payload = (await explanationResponse.json()) as { explanations: DraftView[] };
        setExplanation(payload.explanations[0] ?? null);
      }
    } catch {
      setState({ tone: "error", message: "AI assistance could not be loaded." });
    }
  }, [ticketId]);

  useEffect(() => {
    void load();
  }, [load]);

  const generate = async (kind: "reply" | "explanation") => {
    // Guarding here as well as server-side stops a double click from spending
    // two model calls before the rate limiter ever sees the second one.
    if (generating) return;
    setGenerating(kind);
    setState(null);
    try {
      const response = await fetch(
        `/api/admin/support/tickets/${ticketId}/${kind === "reply" ? "ai-draft" : "ai-explanation"}`,
        { method: "POST", credentials: "same-origin" },
      );
      const payload = (await response.json().catch(() => null)) as
        | { draft?: DraftView; explanation?: DraftView; error?: string; available?: boolean }
        | null;

      if (!response.ok) {
        if (payload?.available === false) setAvailable(false);
        setState({
          tone: "error",
          message:
            response.status === 429
              ? "You have generated several drafts for this ticket recently. Wait a moment before trying again."
              : (payload?.error ?? "The draft could not be generated. Try again shortly."),
        });
        return;
      }

      if (kind === "reply" && payload?.draft) {
        setDraft(payload.draft);
        setEditedText(payload.draft.content);
      }
      if (kind === "explanation" && payload?.explanation) {
        setExplanation(payload.explanation);
        setExplanationOpen(true);
      }
    } catch {
      setState({ tone: "error", message: "We could not reach the AI service. Try again." });
    } finally {
      setGenerating(null);
    }
  };

  const discard = async () => {
    if (!draft) return;
    setState(null);
    try {
      const response = await fetch(`/api/admin/support/tickets/${ticketId}/ai-draft`, {
        method: "DELETE",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftId: draft.id }),
      });
      if (!response.ok) throw new Error("discard failed");
      setDraft(null);
      setEditedText("");
      setState({ tone: "info", message: "Draft discarded. Nothing was sent." });
    } catch {
      setState({ tone: "error", message: "The draft could not be discarded." });
    }
  };

  const approveAndSend = async () => {
    if (!draft || !editedText.trim() || sending) return;
    setSending(true);
    setState(null);
    try {
      const response = await fetch(`/api/admin/support/tickets/${ticketId}/ai-draft`, {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draftId: draft.id,
          // The admin's edited text is the payload. The stored draft is only
          // the starting point.
          message: editedText,
          expectedUpdatedAt,
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { ticket?: AdminTicketDetailView; error?: string }
        | null;

      if (!response.ok) {
        if (response.status === 409) onConflict();
        setState({
          tone: "error",
          message: payload?.error ?? "The reply could not be sent. Reload and try again.",
        });
        return;
      }

      setDraft(null);
      setEditedText("");
      if (payload?.ticket) onSent(payload.ticket);
      await load();
    } catch {
      setState({ tone: "error", message: "We could not reach Bundleen. Try again." });
    } finally {
      setSending(false);
    }
  };

  if (available === false) {
    return (
      <AdminCard title="AI assistance" subtitle="Not configured">
        <p className="text-[12px] leading-5 text-slate-600">
          Drafting and diagnostics need an OpenAI key. Set{" "}
          <code className="rounded bg-slate-100 px-1">OPENAI_API_KEY</code> in this
          environment to turn them on. Everything else on this ticket works normally without it.
        </p>
      </AdminCard>
    );
  }

  return (
    <AdminCard
      title="AI assistance"
      subtitle="Prepares text for you to review. It cannot send anything on its own."
    >
      {state ? (
        <p
          role={state.tone === "error" ? "alert" : "status"}
          className={`mb-3 rounded-lg px-3 py-2 text-[12px] font-medium ${
            state.tone === "error" ? "bg-rose-50 text-rose-700" : "bg-slate-100 text-slate-600"
          }`}
        >
          {state.message}
        </p>
      ) : null}

      {/* ── Draft reply ─────────────────────────────────────────────────── */}
      <section>
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-[12px] font-bold text-slate-900">Draft reply</h3>
          {draft ? <AdminStatusBadge label="Not sent" tone="warning" withDot={false} /> : null}
          <button
            type="button"
            disabled={generating !== null || sending}
            onClick={() => void generate("reply")}
            className="ml-auto h-8 rounded-lg border border-slate-300 bg-white px-3 text-[12px] font-bold text-slate-700 transition hover:border-slate-400 disabled:opacity-40"
          >
            {generating === "reply"
              ? "Generating…"
              : draft
                ? "Regenerate"
                : "Generate reply"}
          </button>
        </div>

        {draft ? (
          <>
            <textarea
              value={editedText}
              onChange={(event) => setEditedText(event.target.value)}
              rows={8}
              aria-label="Draft reply, editable"
              className="mt-3 w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-[12px] leading-5 text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
            />
            <p className="mt-1.5 text-[11px] text-slate-500">
              Generated {formatDateTime(draft.createdAt)} by {draft.model}. Edit freely — the text
              above is exactly what will be sent, and your name is recorded against it.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={sending || !editedText.trim()}
                onClick={() => void approveAndSend()}
                className="h-10 rounded-lg bg-emerald-600 px-5 text-[12px] font-bold text-white transition hover:bg-emerald-700 disabled:opacity-40"
              >
                {sending ? "Sending…" : "Approve and send"}
              </button>
              <button
                type="button"
                disabled={sending}
                onClick={() => void discard()}
                className="h-10 rounded-lg border border-slate-300 bg-white px-4 text-[12px] font-semibold text-slate-700 disabled:opacity-40"
              >
                Discard
              </button>
              {editedText !== draft.content ? (
                <button
                  type="button"
                  onClick={() => setEditedText(draft.content)}
                  className="h-10 rounded-lg px-3 text-[12px] font-semibold text-slate-500 underline"
                >
                  Reset to generated text
                </button>
              ) : null}
            </div>
          </>
        ) : (
          <p className="mt-2 text-[12px] leading-5 text-slate-500">
            Generates a customer-facing draft from this ticket&apos;s conversation and the
            requester&apos;s own records. Nothing is sent until you approve it.
          </p>
        )}
      </section>

      {/* ── Internal explanation ────────────────────────────────────────── */}
      <section className="mt-5 border-t border-slate-200 pt-4">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            aria-expanded={explanationOpen}
            onClick={() => setExplanationOpen((open) => !open)}
            className="flex items-center gap-1.5 text-[12px] font-bold text-slate-900"
          >
            <span aria-hidden="true" className={explanationOpen ? "rotate-90" : ""}>
              ›
            </span>
            Explain what may be wrong
          </button>
          <AdminStatusBadge label="Internal only" tone="warning" withDot={false} />
          <button
            type="button"
            disabled={generating !== null}
            onClick={() => void generate("explanation")}
            className="ml-auto h-8 rounded-lg border border-slate-300 bg-white px-3 text-[12px] font-bold text-slate-700 transition hover:border-slate-400 disabled:opacity-40"
          >
            {generating === "explanation"
              ? "Analyzing…"
              : explanation
                ? "Re-analyze"
                : "Analyze"}
          </button>
        </div>

        {explanationOpen ? (
          explanation ? (
            <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3.5">
              <p className="whitespace-pre-wrap break-words text-[12px] leading-5 text-slate-800">
                {explanation.content}
              </p>
              <p className="mt-3 border-t border-amber-200 pt-2 text-[11px] text-amber-800">
                Never shown to the customer and never copied into a reply automatically.
                Generated {formatDateTime(explanation.createdAt)} by {explanation.model}.
              </p>
            </div>
          ) : (
            <p className="mt-3 text-[12px] leading-5 text-slate-500">
              Summarizes the complaint, the relevant account and service records, likely causes with
              stated uncertainty, what information is missing, and which checks to run next.
            </p>
          )
        ) : null}
      </section>
    </AdminCard>
  );
}
