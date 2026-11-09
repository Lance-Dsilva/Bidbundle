"use client";

import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";

import {
  AdminEmptyState,
  formatDate,
  formatDateTime,
  PersonLine,
  PROVIDER_STATUS_TONE,
  SectionCard,
  StatusPill,
} from "@/components/admin/AdminPrimitives";
import { AdminRequestError, updateProvider, type ProviderAdminPatchBody } from "@/lib/admin-client";
import type { ProviderDetail } from "@/lib/community-types";
import { ProviderCredentialReview } from "@/components/admin/ProviderCredentialReview";
import { PROVIDER_ACCOUNT_STATUSES, type ProviderAccountStatus } from "@/lib/validation/community";
import {
  MAX_TICKET_MESSAGE_LENGTH,
  MAX_TICKET_SUBJECT_LENGTH,
  SUPPORT_TICKET_CATEGORIES,
  SUPPORT_TICKET_PRIORITIES,
  type SupportTicketCategoryValue,
  type SupportTicketPriorityValue,
} from "@/lib/validation/support";
import {
  CATEGORY_LABELS,
  PRIORITY_LABELS,
} from "@/components/admin/support/supportPresentation";

const STATUS_EXPLANATION: Record<ProviderAccountStatus, string> = {
  pending: "Awaiting Bundleen review. The provider cannot bid yet.",
  active: "Can bid and take part in the marketplace.",
  suspended: "Blocked from new bids and provider-only changes. Existing bids and jobs are kept.",
};

/**
 * The controls only Bundleen staff have over a provider account.
 *
 * These fields are absent from `providerProfileUpdateSchema`, so a provider
 * cannot write any of them about themselves — which is the whole point of the
 * separation between a *claim* (a licence number they typed) and a
 * *verification* (a current document and expiry a reviewer has checked).
 *
 * Suspending is confirmed explicitly and the whole panel disables while a
 * request is in flight, so a double click cannot fire two status changes.
 */
export function ProviderAdminControls({ initialProvider }: { initialProvider: ProviderDetail }) {
  const [provider, setProvider] = useState(initialProvider);
  const [status, setStatus] = useState<ProviderAccountStatus>(initialProvider.accountStatus);
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [ticketComposerOpen, setTicketComposerOpen] = useState(false);
  const [ticketSubject, setTicketSubject] = useState("");
  const [ticketCategory, setTicketCategory] =
    useState<SupportTicketCategoryValue>("provider_issue");
  const [ticketPriority, setTicketPriority] =
    useState<SupportTicketPriorityValue>("normal");
  const [ticketMessage, setTicketMessage] = useState("");
  const [ticketPending, setTicketPending] = useState(false);
  const [ticketError, setTicketError] = useState<string | null>(null);
  const [createdTicket, setCreatedTicket] = useState<{
    id: string;
    ticketNumber: string;
    subject: string;
  } | null>(null);
  const ticketInFlight = useRef(false);
  const operationInFlight = useRef(false);

  async function apply(body: ProviderAdminPatchBody, confirmation?: string) {
    if (operationInFlight.current) return;
    if (confirmation && !window.confirm(confirmation)) return;

    operationInFlight.current = true;
    setPending(true);
    setError(null);
    setMessage(null);

    try {
      const next = await updateProvider(provider.userId, body);
      setProvider(next);
      setStatus(next.accountStatus);
      setNote("");
      setMessage(next.changed ? "Saved." : "Already in that state — nothing changed.");
    } catch (caught) {
      setError(
        caught instanceof AdminRequestError
          ? caught.message
          : "Something went wrong. Please try again.",
      );
    } finally {
      operationInFlight.current = false;
      setPending(false);
    }
  }

  async function reloadProvider() {
    if (operationInFlight.current) return;
    operationInFlight.current = true;
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`/api/admin/providers/${encodeURIComponent(provider.userId)}`, {
        credentials: "same-origin", cache: "no-store",
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error ?? "Could not reload the provider.");
      const next = payload as ProviderDetail;
      setProvider(next);
      setStatus(next.accountStatus);
      setNote("");
      setMessage("Current provider and document review loaded. Review the current evidence before approving.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not reload the provider.");
    } finally {
      operationInFlight.current = false;
      setPending(false);
    }
  }

  async function createProviderTicket(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (ticketInFlight.current) return;
    ticketInFlight.current = true;
    setTicketPending(true);
    setTicketError(null);
    setCreatedTicket(null);

    try {
      const response = await fetch(
        `/api/admin/providers/${encodeURIComponent(provider.userId)}/tickets`,
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            subject: ticketSubject,
            category: ticketCategory,
            priority: ticketPriority,
            message: ticketMessage,
          }),
        },
      );
      const payload = (await response.json().catch(() => null)) as
        | {
            ticket?: { id: string; ticketNumber: string; subject: string };
            error?: string;
            fields?: Record<string, string>;
            reference?: string;
          }
        | null;
      if (!response.ok || !payload?.ticket) {
        const fieldMessage = payload?.fields
          ? Object.values(payload.fields).find(Boolean)
          : null;
        throw new Error(
          fieldMessage ??
            payload?.error ??
            `Could not create the ticket (HTTP ${response.status}).`,
        );
      }

      setCreatedTicket(payload.ticket);
      setTicketSubject("");
      setTicketMessage("");
      setTicketCategory("provider_issue");
      setTicketPriority("normal");
      setTicketComposerOpen(false);
    } catch (caught) {
      setTicketError(
        caught instanceof Error ? caught.message : "Could not create the provider ticket.",
      );
    } finally {
      ticketInFlight.current = false;
      setTicketPending(false);
    }
  }

  const inputClass = "h-9 w-full rounded-xl border px-3 text-[13px] outline-none";
  const inputStyle = {
    background: "var(--paper)",
    borderColor: "var(--line)",
    color: "var(--ink-900)",
  };

  return (
    <div className="space-y-5">
      {error && (
        <p
          role="alert"
          className="rounded-xl px-4 py-3 text-[13px]"
          style={{ background: "#FEF3F2", color: "var(--danger-600)" }}
        >
          {error}
        </p>
      )}
      {message && (
        <p
          className="rounded-xl px-4 py-3 text-[13px]"
          style={{ background: "var(--teal-50)", color: "var(--teal-800)" }}
        >
          {message}
        </p>
      )}

      <SectionCard
        title="Account"
        action={
          <StatusPill
            label={provider.accountStatus[0].toUpperCase() + provider.accountStatus.slice(1)}
            tone={PROVIDER_STATUS_TONE[provider.accountStatus]}
          />
        }
      >
        <PersonLine
          person={provider.user}
          meta={
            <>
              {provider.user.email}
              {provider.phone ? ` · ${provider.phone}` : ""}
              {` · joined ${formatDate(provider.createdAt)}`}
            </>
          }
        />

        <dl className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4">
          <Field label="Company" value={provider.companyName ?? "—"} />
          <Field label="Service area" value={provider.serviceArea ?? "—"} />
          <Field label="Trades" value={provider.trades.length > 0 ? provider.trades.join(", ") : "—"} />
          <Field
            label="Status changed"
            value={
              provider.accountStatusUpdatedAt
                ? `${formatDate(provider.accountStatusUpdatedAt)}${
                    provider.accountStatusUpdatedBy
                      ? ` by ${provider.accountStatusUpdatedBy.fullName}`
                      : ""
                  }`
                : "Never"
            }
          />
        </dl>

        {provider.bio && (
          <p className="mt-4 text-[13px] leading-relaxed" style={{ color: "var(--ink-700)" }}>
            {provider.bio}
          </p>
        )}
        {provider.accountStatusNote && (
          <p className="mt-3 text-[12px]" style={{ color: "var(--muted)" }}>
            Internal note: {provider.accountStatusNote}
          </p>
        )}
      </SectionCard>

      <SectionCard
        title="Account status"
        subtitle="Suspension blocks new bids and provider-only changes. It never deletes bid or job history."
      >
        <div className="grid gap-3 md:grid-cols-3">
          <label className="block">
            <span className="mb-1 block text-[12px] font-semibold" style={{ color: "var(--ink-900)" }}>
              Status
            </span>
            <select
              className={inputClass}
              style={inputStyle}
              value={status}
              disabled={pending}
              onChange={(event) => setStatus(event.target.value as ProviderAccountStatus)}
            >
              {PROVIDER_ACCOUNT_STATUSES.map((option) => (
                <option key={option} value={option}>
                  {option[0].toUpperCase() + option.slice(1)}
                </option>
              ))}
            </select>
          </label>

          <label className="block md:col-span-2">
            <span className="mb-1 block text-[12px] font-semibold" style={{ color: "var(--ink-900)" }}>
              Internal account note (not shown to the provider)
            </span>
            <input
              className={inputClass}
              style={inputStyle}
              value={note}
              disabled={pending}
              maxLength={500}
              onChange={(event) => setNote(event.target.value)}
            />
          </label>
        </div>

        <p className="mt-2 text-[11px]" style={{ color: "var(--muted)" }}>
          {STATUS_EXPLANATION[status]}
        </p>

        <button
          type="button"
          disabled={pending || status === provider.accountStatus}
          onClick={() =>
            apply(
              {
                accountStatus: status,
                expectedUpdatedAt: provider.updatedAt,
                ...(note.trim() ? { note: note.trim() } : {}),
              },
              status === "suspended"
                ? `Suspend ${provider.companyName ?? provider.user.fullName}? They will be unable to bid until reinstated.`
                : undefined,
            )
          }
          className="mt-3 inline-flex h-9 items-center rounded-xl px-4 text-[13px] font-semibold text-white disabled:opacity-60"
          style={{ background: status === "suspended" ? "var(--danger-600)" : "var(--teal-800)" }}
        >
          {pending ? "Saving…" : "Save status"}
        </button>
      </SectionCard>

      <SectionCard
        title="Provider communication"
        subtitle="Open a tracked support thread when Bundleen needs documents, clarification, or action from this provider."
        action={
          <button
            type="button"
            className="h-9 rounded-xl px-4 text-[12px] font-semibold text-white disabled:opacity-60"
            style={{ background: "var(--teal-800)" }}
            disabled={ticketPending}
            onClick={() => {
              setTicketError(null);
              setTicketComposerOpen((open) => !open);
            }}
          >
            {ticketComposerOpen ? "Cancel" : "Create ticket"}
          </button>
        }
      >
        <p className="text-[12px] leading-5" style={{ color: "var(--muted)" }}>
          The provider receives an email and in-app notification and replies through their
          secure Bundleen support page. The new ticket is assigned to you automatically.
        </p>

        {createdTicket ? (
          <div
            className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3"
            style={{ borderColor: "var(--sage-100)", background: "var(--teal-50)" }}
            role="status"
          >
            <div className="min-w-0">
              <p className="text-[12px] font-semibold" style={{ color: "var(--teal-800)" }}>
                {createdTicket.ticketNumber} sent to {provider.user.fullName}
              </p>
              <p className="truncate text-[11px]" style={{ color: "var(--muted)" }}>
                {createdTicket.subject}
              </p>
            </div>
            <Link
              className="rounded-lg border px-3 py-1.5 text-[11px] font-semibold"
              href={`/app/admin/support/${encodeURIComponent(createdTicket.id)}`}
              style={{ borderColor: "var(--line)", color: "var(--teal-800)", background: "white" }}
            >
              Open thread
            </Link>
          </div>
        ) : null}

        {ticketError ? (
          <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-[12px] text-red-700" role="alert">
            {ticketError}
          </p>
        ) : null}

        {ticketComposerOpen ? (
          <form className="mt-4 space-y-3" onSubmit={createProviderTicket}>
            <label className="block">
              <span className="mb-1 block text-[12px] font-semibold" style={{ color: "var(--ink-900)" }}>
                Subject
              </span>
              <input
                className={inputClass}
                style={inputStyle}
                value={ticketSubject}
                onChange={(event) => setTicketSubject(event.currentTarget.value)}
                maxLength={MAX_TICKET_SUBJECT_LENGTH}
                placeholder="For example: Updated insurance document required"
                required
              />
            </label>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-[12px] font-semibold" style={{ color: "var(--ink-900)" }}>
                  Category
                </span>
                <select
                  className={inputClass}
                  style={inputStyle}
                  value={ticketCategory}
                  onChange={(event) =>
                    setTicketCategory(event.currentTarget.value as SupportTicketCategoryValue)
                  }
                >
                  {SUPPORT_TICKET_CATEGORIES.map((category) => (
                    <option value={category} key={category}>
                      {CATEGORY_LABELS[category]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-[12px] font-semibold" style={{ color: "var(--ink-900)" }}>
                  Priority
                </span>
                <select
                  className={inputClass}
                  style={inputStyle}
                  value={ticketPriority}
                  onChange={(event) =>
                    setTicketPriority(event.currentTarget.value as SupportTicketPriorityValue)
                  }
                >
                  {SUPPORT_TICKET_PRIORITIES.map((priority) => (
                    <option value={priority} key={priority}>
                      {PRIORITY_LABELS[priority]}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label className="block">
              <span className="mb-1 block text-[12px] font-semibold" style={{ color: "var(--ink-900)" }}>
                Message to provider
              </span>
              <textarea
                className="min-h-32 w-full rounded-xl border px-3 py-2.5 text-[13px] outline-none"
                style={inputStyle}
                value={ticketMessage}
                onChange={(event) => setTicketMessage(event.currentTarget.value)}
                maxLength={MAX_TICKET_MESSAGE_LENGTH}
                placeholder="Explain what Bundleen needs, any deadline, and how the provider should respond."
                required
              />
            </label>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="submit"
                disabled={ticketPending}
                className="h-9 rounded-xl px-4 text-[12px] font-semibold text-white disabled:opacity-60"
                style={{ background: "var(--teal-800)" }}
              >
                {ticketPending ? "Creating and notifying…" : "Create ticket and email provider"}
              </button>
              <span className="text-[11px]" style={{ color: "var(--muted)" }}>
                The message is saved in the ticket; email links to the secure thread.
              </span>
            </div>
          </form>
        ) : null}
      </SectionCard>

      {provider.credentials != null && <SectionCard
        title="Credential verification"
        subtitle="Compare the current private document with the provider's claim, then confirm its expiry and reviewed coverage. Replacements require a new review."
        action={<button type="button" disabled={pending} onClick={() => void reloadProvider()} className="min-h-10 rounded-lg border px-3 py-2 text-xs font-semibold disabled:opacity-50">Reload provider &amp; documents</button>}
      >
        <div className="space-y-3">
          <ProviderCredentialReview
            key={`license:${provider.updatedAt}:${provider.credentials?.license?.id ?? "none"}`}
            kind="license"
            details={[["License number", provider.licenseNumber], ["Issuing state", provider.licenseState]]}
            document={provider.credentials?.license ?? null}
            expiresOn={provider.credentials?.licenseExpiresOn ?? null}
            coverage={null}
            additionalInsured={false}
            verified={provider.isLicenseVerified}
            verifiedAt={provider.licenseVerifiedAt}
            expectedUpdatedAt={provider.updatedAt}
            pending={pending}
            onApply={apply}
          />
          <ProviderCredentialReview
            key={`insurance:${provider.updatedAt}:${provider.credentials?.insurance?.id ?? "none"}`}
            kind="insurance"
            details={[["Insurance provider", provider.insuranceProvider], ["Policy number", provider.insurancePolicyNumber]]}
            document={provider.credentials?.insurance ?? null}
            expiresOn={provider.credentials?.insuranceExpiresOn ?? null}
            coverage={provider.credentials?.insuranceCoverageCents ?? null}
            additionalInsured={provider.credentials?.insuranceAdditionalInsured ?? false}
            verified={provider.isInsuranceVerified}
            verifiedAt={provider.insuranceVerifiedAt}
            expectedUpdatedAt={provider.updatedAt}
            pending={pending}
            onApply={apply}
          />
        </div>
      </SectionCard>}

      <SectionCard title="Change history" subtitle="From the append-only admin audit log">
        {provider.recentAudit.length === 0 ? (
          <AdminEmptyState
            title="No recorded changes"
            body="Status and verification changes made from this page will appear here."
          />
        ) : (
          <ul className="space-y-2">
            {provider.recentAudit.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[13px]" style={{ color: "var(--ink-900)" }}>
                  {entry.actor ? `${entry.actor.fullName} ` : ""}
                  {entry.summary}
                </span>
                <time className="text-[11px]" style={{ color: "var(--muted)" }}>
                  {formatDateTime(entry.createdAt)}
                </time>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-[0.12em]" style={{ color: "var(--muted)" }}>
        {label}
      </dt>
      <dd className="mt-1 text-[13px] font-semibold" style={{ color: "var(--ink-900)" }}>
        {value}
      </dd>
    </div>
  );
}
