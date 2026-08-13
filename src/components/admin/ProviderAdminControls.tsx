"use client";

import { useState } from "react";

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
import { PROVIDER_ACCOUNT_STATUSES, type ProviderAccountStatus } from "@/lib/validation/community";

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
 * *verification* (a timestamp a staff member recorded after checking it).
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

  async function apply(body: ProviderAdminPatchBody, confirmation?: string) {
    if (pending) return;
    if (confirmation && !window.confirm(confirmation)) return;

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
      setPending(false);
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
                note: note.trim() || null,
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
        title="Credential verification"
        subtitle="The provider supplies the claim; only Bundleen staff record the verification timestamp."
      >
        <div className="space-y-3">
          <CredentialRow
            title="Licence"
            claim={
              provider.licenseNumber
                ? `${provider.licenseNumber}${provider.licenseState ? ` · ${provider.licenseState}` : ""}`
                : null
            }
            verifiedAt={provider.licenseVerifiedAt}
            verifiedBy={provider.licenseVerifiedBy?.fullName ?? null}
            pending={pending}
            onVerify={() =>
              apply({
                license: "verify",
                expectedUpdatedAt: provider.updatedAt,
              })
            }
            onRevoke={() =>
              apply(
                {
                  license: "revoke",
                  expectedUpdatedAt: provider.updatedAt,
                },
                "Revoke this licence verification? The provider's profile will stop showing it as verified.",
              )
            }
          />
          <CredentialRow
            title="Insurance"
            claim={
              provider.insuranceProvider
                ? `${provider.insuranceProvider}${
                    provider.insurancePolicyNumber ? ` · policy on file` : ""
                  }`
                : null
            }
            verifiedAt={provider.insuranceVerifiedAt}
            verifiedBy={provider.insuranceVerifiedBy?.fullName ?? null}
            pending={pending}
            onVerify={() =>
              apply({
                insurance: "verify",
                expectedUpdatedAt: provider.updatedAt,
              })
            }
            onRevoke={() =>
              apply(
                {
                  insurance: "revoke",
                  expectedUpdatedAt: provider.updatedAt,
                },
                "Revoke this insurance verification? The provider's profile will stop showing it as verified.",
              )
            }
          />
        </div>
      </SectionCard>

      <SectionCard
        title="Approved communities"
        subtitle="Recorded for the job and bid flow. Nothing is assigned here until that flow consumes it."
      >
        {provider.approvedCommunities.length === 0 ? (
          <AdminEmptyState
            title="No community approvals recorded"
            body="This relationship is modelled but not yet used by bidding, so no approvals are shown."
          />
        ) : (
          <ul className="flex flex-wrap gap-2">
            {provider.approvedCommunities.map((community) => (
              <li key={community.id}>
                <StatusPill label={community.name} tone="info" withDot={false} />
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

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

/**
 * One credential. "Submitted" and "Verified" are deliberately different words:
 * a claim with no timestamp behind it is never shown as verified anywhere.
 */
function CredentialRow({
  title,
  claim,
  verifiedAt,
  verifiedBy,
  pending,
  onVerify,
  onRevoke,
}: {
  title: string;
  claim: string | null;
  verifiedAt: string | null;
  verifiedBy: string | null;
  pending: boolean;
  onVerify: () => void;
  onRevoke: () => void;
}) {
  const isVerified = verifiedAt !== null;

  return (
    <div
      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3"
      style={{ borderColor: "var(--line)" }}
    >
      <div className="min-w-0">
        <p className="text-[13px] font-semibold" style={{ color: "var(--ink-900)" }}>
          {title}
        </p>
        <p className="text-[12px]" style={{ color: "var(--muted)" }}>
          {claim ? `Submitted: ${claim}` : "Nothing submitted"}
          {isVerified
            ? ` · verified ${formatDate(verifiedAt)}${verifiedBy ? ` by ${verifiedBy}` : ""}`
            : ""}
        </p>
      </div>

      <div className="flex items-center gap-2">
        <StatusPill
          label={isVerified ? "Verified" : claim ? "Submitted" : "Not submitted"}
          tone={isVerified ? "positive" : claim ? "warning" : "neutral"}
        />
        {isVerified ? (
          <button
            type="button"
            disabled={pending}
            onClick={onRevoke}
            className="rounded-xl border px-3 py-1.5 text-[12px] font-semibold disabled:opacity-60"
            style={{ borderColor: "var(--line)", color: "var(--danger-600)" }}
          >
            Revoke
          </button>
        ) : (
          <button
            type="button"
            disabled={pending || !claim}
            onClick={onVerify}
            className="rounded-xl px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-60"
            style={{ background: "var(--teal-800)" }}
          >
            Verify
          </button>
        )}
      </div>
    </div>
  );
}
