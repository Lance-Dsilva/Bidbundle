"use client";

import { useCallback, useEffect, useState } from "react";

import {
  AdminCard,
  AdminEmptyState,
  AdminErrorState,
  AdminLoadingState,
  AdminStatusBadge,
  formatDateTime,
  type Tone,
} from "@/components/admin/primitives";
import {
  AdminDialog,
  AdminSearchInput,
} from "@/components/admin/primitives/AdminFilterBar";
import {
  BROADCAST_SEGMENTS,
  BROADCAST_SEVERITIES,
  GLOBAL_SEND_CONFIRMATION,
  MAX_BROADCAST_MESSAGE_LENGTH,
  MAX_BROADCAST_SUBJECT_LENGTH,
  URGENT_OPERATIONAL_SEVERITIES,
  type BroadcastSegment,
  type BroadcastSeverityValue,
} from "@/lib/validation/communications";

/**
 * The Communications module: compose, preview, test, review, send, and audit
 * platform-wide operational messages.
 *
 * The send path deliberately makes the risk visible rather than convenient —
 * a server-calculated recipient count, a sample of real addresses, an explicit
 * statement when preferences are being overridden, and a typed confirmation
 * phrase before anything is delivered.
 */

type BroadcastView = {
  id: string;
  subject: string;
  body: string;
  severity: BroadcastSeverityValue;
  status: "draft" | "queued" | "processing" | "completed" | "failed" | "cancelled";
  inAppTitle: string | null;
  inAppBody: string | null;
  linkPath: string | null;
  audienceSegments: string[];
  overridesEmailPreference: boolean;
  recipientCount: number;
  createdByName: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
  queuedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  delivery: { sent: number; pending: number; failed: number; suppressed: number };
};

type Preview = {
  recipientCount: number;
  sample: { name: string; email: string; role: string }[];
  optedOutCount: number;
  bypassesPreference: boolean;
};

const SEVERITY_LABELS: Record<BroadcastSeverityValue, string> = {
  announcement: "Announcement",
  maintenance: "Planned maintenance",
  degraded: "Degraded service",
  outage: "Outage",
  security: "Security notice",
};

const SEVERITY_TONES: Record<BroadcastSeverityValue, Tone> = {
  announcement: "info",
  maintenance: "accent",
  degraded: "warning",
  outage: "danger",
  security: "danger",
};

const STATUS_TONES: Record<BroadcastView["status"], Tone> = {
  draft: "neutral",
  queued: "info",
  processing: "info",
  completed: "positive",
  failed: "danger",
  cancelled: "neutral",
};

const SEGMENT_LABELS: Record<BroadcastSegment, string> = {
  homeowner: "Homeowners",
  hoa_manager: "HOA managers",
  provider: "Service providers",
};

type Composer = {
  subject: string;
  body: string;
  severity: BroadcastSeverityValue;
  inAppTitle: string;
  inAppBody: string;
  linkPath: string;
  audienceSegments: BroadcastSegment[];
  overridesEmailPreference: boolean;
};

const EMPTY_COMPOSER: Composer = {
  subject: "",
  body: "",
  severity: "announcement",
  inAppTitle: "",
  inAppBody: "",
  linkPath: "",
  audienceSegments: [],
  overridesEmailPreference: false,
};

type Feedback = { tone: "success" | "error"; message: string } | null;

export function BroadcastWorkspace() {
  const [broadcasts, setBroadcasts] = useState<BroadcastView[]>([]);
  const [canSendGlobal, setCanSendGlobal] = useState(false);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [composer, setComposer] = useState<Composer>(EMPTY_COMPOSER);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const [reviewOpen, setReviewOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const response = await fetch(
        `/api/admin/communications/broadcasts?search=${encodeURIComponent(search)}`,
        { credentials: "same-origin" },
      );
      if (!response.ok) throw new Error("load failed");
      const payload = (await response.json()) as {
        broadcasts: BroadcastView[];
        canSendGlobal: boolean;
      };
      setBroadcasts(payload.broadcasts);
      setCanSendGlobal(payload.canSendGlobal);
    } catch {
      setLoadError("Broadcast history could not be loaded. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    void load();
  }, [load]);

  // The recipient count is always the server's answer for the audience as it
  // stands right now, recalculated whenever the audience definition changes.
  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setPreviewing(true);
      void fetch("/api/admin/communications/preview", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          audienceSegments: composer.audienceSegments,
          severity: composer.severity,
          overridesEmailPreference: composer.overridesEmailPreference,
        }),
      })
        .then(async (response) => {
          if (!response.ok) throw new Error("preview failed");
          const payload = (await response.json()) as { preview: Preview };
          if (!cancelled) setPreview(payload.preview);
        })
        .catch(() => {
          if (!cancelled) setPreview(null);
        })
        .finally(() => {
          if (!cancelled) setPreviewing(false);
        });
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [composer.audienceSegments, composer.severity, composer.overridesEmailPreference]);

  const canOverride = (URGENT_OPERATIONAL_SEVERITIES as readonly string[]).includes(
    composer.severity,
  );

  const composerPayload = () => ({
    subject: composer.subject,
    body: composer.body,
    severity: composer.severity,
    inAppTitle: composer.inAppTitle || null,
    inAppBody: composer.inAppBody || null,
    linkPath: composer.linkPath || null,
    audienceSegments: composer.audienceSegments,
    overridesEmailPreference: canOverride && composer.overridesEmailPreference,
  });

  const saveDraft = async (): Promise<string | null> => {
    setBusy(true);
    setFeedback(null);
    try {
      const response = await fetch(
        draftId
          ? `/api/admin/communications/broadcasts/${draftId}`
          : "/api/admin/communications/broadcasts",
        {
          method: draftId ? "PUT" : "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(composerPayload()),
        },
      );
      const payload = (await response.json().catch(() => null)) as
        | { broadcast?: BroadcastView; error?: string; fields?: Record<string, string> }
        | null;

      if (!response.ok || !payload?.broadcast) {
        const firstFieldError = payload?.fields ? Object.values(payload.fields)[0] : undefined;
        setFeedback({
          tone: "error",
          message: firstFieldError ?? payload?.error ?? "The draft could not be saved.",
        });
        return null;
      }

      setDraftId(payload.broadcast.id);
      setFeedback({ tone: "success", message: "Draft saved." });
      await load();
      return payload.broadcast.id;
    } catch {
      setFeedback({ tone: "error", message: "We could not reach Bundleen. Try again." });
      return null;
    } finally {
      setBusy(false);
    }
  };

  const sendTest = async () => {
    const id = draftId ?? (await saveDraft());
    if (!id) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/admin/communications/broadcasts/${id}/test`, {
        method: "POST",
        credentials: "same-origin",
      });
      const payload = (await response.json().catch(() => null)) as
        | { sentTo?: string; error?: string }
        | null;
      setFeedback(
        response.ok
          ? {
              tone: "success",
              message: `Test sent to ${payload?.sentTo ?? "your address"} only. No customer received it.`,
            }
          : { tone: "error", message: payload?.error ?? "The test could not be sent." },
      );
    } catch {
      setFeedback({ tone: "error", message: "We could not reach Bundleen. Try again." });
    } finally {
      setBusy(false);
    }
  };

  const discardDraft = async () => {
    if (!draftId) {
      setComposer(EMPTY_COMPOSER);
      return;
    }
    setBusy(true);
    try {
      await fetch(`/api/admin/communications/broadcasts/${draftId}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      setDraftId(null);
      setComposer(EMPTY_COMPOSER);
      setFeedback({ tone: "success", message: "Draft discarded." });
      await load();
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    if (!draftId || !preview) return;
    setBusy(true);
    setFeedback(null);
    try {
      const response = await fetch(`/api/admin/communications/broadcasts/${draftId}/send`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          confirmation,
          // The count the reviewer actually saw. The server refuses if the
          // audience has drifted materially since.
          acknowledgedRecipientCount: preview.recipientCount,
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { queued?: number; suppressed?: number; error?: string; fields?: Record<string, string> }
        | null;

      if (!response.ok) {
        const firstFieldError = payload?.fields ? Object.values(payload.fields)[0] : undefined;
        setFeedback({
          tone: "error",
          message: firstFieldError ?? payload?.error ?? "The broadcast could not be sent.",
        });
        return;
      }

      setReviewOpen(false);
      setConfirmation("");
      setDraftId(null);
      setComposer(EMPTY_COMPOSER);
      setFeedback({
        tone: "success",
        message: `Queued ${payload?.queued ?? 0} email${payload?.queued === 1 ? "" : "s"}${
          payload?.suppressed ? `, ${payload.suppressed} skipped for preferences` : ""
        }. Delivery runs through the outbox.`,
      });
      await load();
    } catch {
      setFeedback({ tone: "error", message: "We could not reach Bundleen. Try again." });
    } finally {
      setBusy(false);
    }
  };

  const retry = async (broadcastId: string) => {
    setBusy(true);
    try {
      const response = await fetch(
        `/api/admin/communications/broadcasts/${broadcastId}/retry`,
        { method: "POST", credentials: "same-origin" },
      );
      const payload = (await response.json().catch(() => null)) as
        | { retried?: number; error?: string }
        | null;
      setFeedback(
        response.ok
          ? {
              tone: "success",
              message: `Re-queued ${payload?.retried ?? 0} failed delivery attempt${
                payload?.retried === 1 ? "" : "s"
              }. Nobody who already received it will get a second copy.`,
            }
          : { tone: "error", message: payload?.error ?? "The retry could not be started." },
      );
      await load();
    } finally {
      setBusy(false);
    }
  };

  const composerReady = composer.subject.trim().length > 0 && composer.body.trim().length > 0;

  return (
    <div className="space-y-5">
      {feedback ? (
        <p
          role={feedback.tone === "error" ? "alert" : "status"}
          className={`rounded-xl px-4 py-3 text-[12px] font-medium ${
            feedback.tone === "error" ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-800"
          }`}
        >
          {feedback.message}
        </p>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        {/* ── Compose ───────────────────────────────────────────────────── */}
        <AdminCard
          title="Compose"
          subtitle="Urgent, platform-wide operational messages only"
        >
          <div className="space-y-4">
            <label className="block">
              <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-500">
                Type
              </span>
              <select
                value={composer.severity}
                onChange={(event) => {
                  const severity = event.target.value as BroadcastSeverityValue;
                  setComposer((current) => ({
                    ...current,
                    severity,
                    // Dropping to `announcement` must also drop the override,
                    // which that severity is not allowed to hold.
                    overridesEmailPreference:
                      (URGENT_OPERATIONAL_SEVERITIES as readonly string[]).includes(severity) &&
                      current.overridesEmailPreference,
                  }));
                }}
                className="mt-1.5 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-[13px] font-medium"
              >
                {BROADCAST_SEVERITIES.map((severity) => (
                  <option key={severity} value={severity}>
                    {SEVERITY_LABELS[severity]}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-500">
                Subject
              </span>
              <input
                type="text"
                value={composer.subject}
                maxLength={MAX_BROADCAST_SUBJECT_LENGTH}
                onChange={(event) =>
                  setComposer((current) => ({ ...current, subject: event.target.value }))
                }
                placeholder="Scheduled maintenance on Saturday 06:00–08:00 UTC"
                className="mt-1.5 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-[13px]"
              />
            </label>

            <label className="block">
              <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-500">
                Message
              </span>
              <textarea
                value={composer.body}
                rows={7}
                maxLength={MAX_BROADCAST_MESSAGE_LENGTH}
                onChange={(event) =>
                  setComposer((current) => ({ ...current, body: event.target.value }))
                }
                placeholder="Plain language. What is happening, who it affects, what they should do, and when you will update them next."
                className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-[13px] leading-5"
              />
              <span className="mt-1 block text-[11px] text-slate-400">
                Sent as plain text. Anything typed here reaches customers exactly as written.
              </span>
            </label>

            <fieldset>
              <legend className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-500">
                Audience
              </legend>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setComposer((current) => ({ ...current, audienceSegments: [] }))}
                  className={`h-9 rounded-lg border px-3 text-[12px] font-bold transition ${
                    composer.audienceSegments.length === 0
                      ? "border-emerald-500 bg-emerald-50 text-emerald-800"
                      : "border-slate-300 bg-white text-slate-600"
                  }`}
                >
                  All active users
                </button>
                {BROADCAST_SEGMENTS.map((segment) => {
                  const selected = composer.audienceSegments.includes(segment);
                  return (
                    <button
                      key={segment}
                      type="button"
                      onClick={() =>
                        setComposer((current) => ({
                          ...current,
                          audienceSegments: selected
                            ? current.audienceSegments.filter((value) => value !== segment)
                            : [...current.audienceSegments, segment],
                        }))
                      }
                      className={`h-9 rounded-lg border px-3 text-[12px] font-bold transition ${
                        selected
                          ? "border-emerald-500 bg-emerald-50 text-emerald-800"
                          : "border-slate-300 bg-white text-slate-600"
                      }`}
                    >
                      {SEGMENT_LABELS[segment]}
                    </button>
                  );
                })}
              </div>
            </fieldset>

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5">
              <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-500">
                In-app notification (optional)
              </p>
              <div className="mt-2 space-y-2">
                <input
                  type="text"
                  value={composer.inAppTitle}
                  onChange={(event) =>
                    setComposer((current) => ({ ...current, inAppTitle: event.target.value }))
                  }
                  placeholder="Notification title"
                  className="h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-[12px]"
                />
                <input
                  type="text"
                  value={composer.inAppBody}
                  onChange={(event) =>
                    setComposer((current) => ({ ...current, inAppBody: event.target.value }))
                  }
                  placeholder="One-line summary shown in the bell"
                  className="h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-[12px]"
                />
                <input
                  type="text"
                  value={composer.linkPath}
                  onChange={(event) =>
                    setComposer((current) => ({ ...current, linkPath: event.target.value }))
                  }
                  placeholder="/app/homeowner/dashboard"
                  className="h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-[12px]"
                />
                <p className="text-[11px] text-slate-500">
                  In-app paths only. Broadcast notifications are counted separately from support
                  ticket unread counts.
                </p>
              </div>
            </div>

            {canOverride ? (
              <label className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 p-3.5">
                <input
                  type="checkbox"
                  checked={composer.overridesEmailPreference}
                  onChange={(event) =>
                    setComposer((current) => ({
                      ...current,
                      overridesEmailPreference: event.target.checked,
                    }))
                  }
                  className="mt-0.5 h-4 w-4"
                />
                <span className="text-[12px] leading-5 text-amber-900">
                  <strong className="block">
                    Send to every affected account, including announcement opt-outs
                  </strong>
                  Only for genuine operational or security notices. This overrides a customer&apos;s
                  own email preference, and the override is written to the immutable audit log with
                  your name against it.
                </span>
              </label>
            ) : null}

            <div className="flex flex-wrap gap-2 border-t border-slate-200 pt-4">
              <button
                type="button"
                disabled={busy || !composerReady}
                onClick={() => void saveDraft()}
                className="h-10 rounded-lg border border-slate-300 bg-white px-4 text-[12px] font-bold text-slate-700 disabled:opacity-40"
              >
                {busy ? "Working…" : draftId ? "Update draft" : "Save draft"}
              </button>
              <button
                type="button"
                disabled={busy || !composerReady}
                onClick={() => void sendTest()}
                className="h-10 rounded-lg border border-slate-300 bg-white px-4 text-[12px] font-bold text-slate-700 disabled:opacity-40"
              >
                Send test to me
              </button>
              {draftId || composer.subject || composer.body ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void discardDraft()}
                  className="h-10 rounded-lg px-3 text-[12px] font-semibold text-slate-500 underline disabled:opacity-40"
                >
                  Discard draft
                </button>
              ) : null}
              {canSendGlobal ? (
                <button
                  type="button"
                  disabled={busy || !composerReady || !preview || preview.recipientCount === 0}
                  onClick={async () => {
                    const id = draftId ?? (await saveDraft());
                    if (id) setReviewOpen(true);
                  }}
                  className="ml-auto h-10 rounded-lg bg-rose-600 px-5 text-[12px] font-bold text-white transition hover:bg-rose-700 disabled:opacity-40"
                >
                  Review and send
                </button>
              ) : (
                <p className="ml-auto self-center text-[11px] text-slate-500">
                  Sending needs the “Send global operational emails” permission.
                </p>
              )}
            </div>
          </div>
        </AdminCard>

        {/* ── Recipients ────────────────────────────────────────────────── */}
        <AdminCard title="Recipients" subtitle="Calculated on the server, live">
          {previewing && !preview ? (
            <p className="text-[12px] text-slate-500">Counting…</p>
          ) : preview ? (
            <>
              <p className="text-[30px] font-extrabold leading-none text-slate-900">
                {preview.recipientCount.toLocaleString()}
              </p>
              <p className="mt-1 text-[12px] text-slate-500">
                {composer.audienceSegments.length === 0
                  ? "All active homeowner and provider accounts"
                  : composer.audienceSegments
                      .map((segment) => SEGMENT_LABELS[segment])
                      .join(", ")}
              </p>

              {preview.optedOutCount > 0 ? (
                <p
                  className={`mt-3 rounded-lg px-3 py-2 text-[11px] font-medium ${
                    preview.bypassesPreference
                      ? "bg-amber-50 text-amber-800"
                      : "bg-slate-100 text-slate-600"
                  }`}
                >
                  {preview.bypassesPreference
                    ? `Includes ${preview.optedOutCount.toLocaleString()} account${
                        preview.optedOutCount === 1 ? "" : "s"
                      } that turned announcement email off. This is an operational override.`
                    : `${preview.optedOutCount.toLocaleString()} account${
                        preview.optedOutCount === 1 ? "" : "s"
                      } with announcement email off will be skipped.`}
                </p>
              ) : null}

              {preview.sample.length > 0 ? (
                <div className="mt-4">
                  <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-500">
                    Sample
                  </p>
                  <ul className="mt-1.5 space-y-1">
                    {preview.sample.map((person) => (
                      <li key={person.email} className="truncate text-[11px] text-slate-600">
                        {person.name} · {person.email}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </>
          ) : (
            <p className="text-[12px] text-slate-500">
              The recipient count could not be calculated. Reload the page.
            </p>
          )}
        </AdminCard>
      </div>

      {/* ── History ─────────────────────────────────────────────────────── */}
      <AdminCard
        title="Broadcast history"
        subtitle="Immutable record of every message and its delivery"
        action={
          <div className="w-56">
            <AdminSearchInput
              value={search}
              onChange={setSearch}
              label="Search"
              placeholder="Subject or body"
            />
          </div>
        }
      >
        {loadError ? (
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
        ) : loading ? (
          <AdminLoadingState label="Loading broadcast history…" />
        ) : broadcasts.length === 0 ? (
          <AdminEmptyState
            title="No broadcasts yet"
            body="Messages you send to the whole platform are recorded here, with their delivery outcome."
          />
        ) : (
          <ul className="space-y-3">
            {broadcasts.map((broadcast) => (
              <li
                key={broadcast.id}
                className="rounded-xl border border-slate-200 p-4"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <AdminStatusBadge
                    label={SEVERITY_LABELS[broadcast.severity]}
                    tone={SEVERITY_TONES[broadcast.severity]}
                    withDot={false}
                  />
                  <AdminStatusBadge
                    label={broadcast.status}
                    tone={STATUS_TONES[broadcast.status]}
                  />
                  {broadcast.overridesEmailPreference ? (
                    <AdminStatusBadge label="Preference override" tone="warning" withDot={false} />
                  ) : null}
                  <span className="ml-auto text-[10px] text-slate-500">
                    {formatDateTime(broadcast.queuedAt ?? broadcast.createdAt)}
                  </span>
                </div>
                <p className="mt-2 text-[13px] font-bold text-slate-900">{broadcast.subject}</p>
                <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-[11px] leading-4 text-slate-500">
                  {broadcast.body}
                </p>
                <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-slate-600">
                  <div>
                    <dt className="inline font-semibold">Delivered </dt>
                    <dd className="inline">{broadcast.delivery.sent}</dd>
                  </div>
                  <div>
                    <dt className="inline font-semibold">Pending </dt>
                    <dd className="inline">{broadcast.delivery.pending}</dd>
                  </div>
                  <div>
                    <dt className="inline font-semibold">Failed </dt>
                    <dd className="inline">{broadcast.delivery.failed}</dd>
                  </div>
                  <div>
                    <dt className="inline font-semibold">Skipped </dt>
                    <dd className="inline">{broadcast.delivery.suppressed}</dd>
                  </div>
                  {broadcast.approvedByName ? (
                    <div>
                      <dt className="inline font-semibold">Approved by </dt>
                      <dd className="inline">{broadcast.approvedByName}</dd>
                    </div>
                  ) : null}
                </dl>
                {broadcast.delivery.failed > 0 && canSendGlobal ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void retry(broadcast.id)}
                    className="mt-3 h-8 rounded-lg border border-slate-300 bg-white px-3 text-[11px] font-bold text-slate-700 disabled:opacity-40"
                  >
                    Retry {broadcast.delivery.failed} failed
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </AdminCard>

      {/* ── Final review ────────────────────────────────────────────────── */}
      <AdminDialog
        open={reviewOpen}
        title="Send to every matching account"
        description="This delivers real email to real customers. Read it once more."
        onClose={() => {
          setReviewOpen(false);
          setConfirmation("");
        }}
        footer={
          <>
            <button
              type="button"
              onClick={() => {
                setReviewOpen(false);
                setConfirmation("");
              }}
              className="h-10 rounded-lg border border-slate-300 bg-white px-4 text-[12px] font-bold text-slate-700"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={busy || confirmation !== GLOBAL_SEND_CONFIRMATION}
              onClick={() => void send()}
              className="h-10 rounded-lg bg-rose-600 px-5 text-[12px] font-bold text-white disabled:opacity-40"
            >
              {busy ? "Queueing…" : `Send to ${preview?.recipientCount.toLocaleString() ?? "—"}`}
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5">
            <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-500">
              Subject
            </p>
            <p className="mt-0.5 text-[13px] font-bold text-slate-900">{composer.subject}</p>
            <p className="mt-2 whitespace-pre-wrap text-[12px] leading-5 text-slate-700">
              {composer.body}
            </p>
          </div>

          <dl className="space-y-1.5 text-[12px]">
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">Recipients</dt>
              <dd className="font-bold text-slate-900">
                {preview?.recipientCount.toLocaleString() ?? "—"}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">Audience</dt>
              <dd className="text-right font-medium text-slate-900">
                {composer.audienceSegments.length === 0
                  ? "All active users"
                  : composer.audienceSegments.map((s) => SEGMENT_LABELS[s]).join(", ")}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">Type</dt>
              <dd className="font-medium text-slate-900">
                {SEVERITY_LABELS[composer.severity]}
              </dd>
            </div>
          </dl>

          {preview?.bypassesPreference ? (
            <p className="rounded-lg bg-amber-50 px-3 py-2.5 text-[12px] font-medium leading-5 text-amber-900">
              This message will reach {preview.optedOutCount.toLocaleString()} account
              {preview.optedOutCount === 1 ? "" : "s"} that turned announcement email off, because
              you classified it as an urgent operational notice. That decision is recorded against
              your name permanently.
            </p>
          ) : null}

          <label className="block">
            <span className="text-[11px] font-bold text-slate-700">
              Type {GLOBAL_SEND_CONFIRMATION} to confirm
            </span>
            <input
              type="text"
              value={confirmation}
              autoComplete="off"
              onChange={(event) => setConfirmation(event.target.value)}
              className="mt-1.5 h-10 w-full rounded-lg border border-slate-300 px-3 text-[13px] font-bold tracking-wide"
            />
          </label>
        </div>
      </AdminDialog>
    </div>
  );
}
