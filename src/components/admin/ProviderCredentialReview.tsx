"use client";

import { useState, type FormEvent } from "react";

import type { ProviderAdminPatchBody } from "@/lib/admin-client";
import type { ProviderCredentialRef } from "@/lib/provider-credential-types";
import { coverageCents, coverageDollars } from "@/components/provider/credential-format";

type Props = {
  kind: "license" | "insurance";
  details: Array<readonly [string, string | null]>;
  document: ProviderCredentialRef | null;
  expiresOn: string | null;
  coverage: number | null;
  additionalInsured: boolean;
  verified: boolean;
  verifiedAt: string | null;
  expectedUpdatedAt: string;
  pending: boolean;
  onApply: (body: ProviderAdminPatchBody, confirmation?: string) => Promise<void>;
};

export function ProviderCredentialReview(props: Props) {
  const { kind, document, pending } = props;
  const title = kind === "license" ? "License" : "Insurance";
  const [expiresOn, setExpiresOn] = useState(props.expiresOn ?? "");
  const [coverage, setCoverage] = useState(coverageDollars(props.coverage));
  const [additional, setAdditional] = useState(props.additionalInsured);
  const [reviewed, setReviewed] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const today = new Date().toISOString().slice(0, 10);

  async function decide(decision: "verify" | "revoke" | "reject") {
    if (pending || (!document && decision !== "revoke")) return;
    setError(null);
    if (decision === "reject" && !note.trim()) { setError("Give the provider a reason before rejecting this document."); return; }
    const body: ProviderAdminPatchBody = {
      [kind]: decision,
      expectedUpdatedAt: props.expectedUpdatedAt,
      ...(note.trim() ? { note: note.trim() } : {}),
    };
    if (document) Object.assign(body, kind === "license"
      ? { licenseDocumentId: document.id, licenseDocumentChecksum: document.checksum }
      : { insuranceDocumentId: document.id, insuranceDocumentChecksum: document.checksum });
    if (decision === "verify") {
      if (!document) return;
      if (!reviewed) { setError("Open and review the current document, then confirm your review."); return; }
      if (!expiresOn || expiresOn < today) { setError("Choose a current expiry date. It remains valid through that UTC date."); return; }
      if (kind === "license") Object.assign(body, { licenseExpiresOn: expiresOn });
      else {
        const cents = coverageCents(coverage);
        if (cents === null || cents <= 0) { setError("Enter the reviewed insurance coverage as a positive USD amount with up to two decimal places."); return; }
        Object.assign(body, { insuranceExpiresOn: expiresOn, insuranceCoverageCents: cents, insuranceAdditionalInsured: additional });
      }
    }
    await props.onApply(body, decision === "revoke" ? `Revoke this ${kind} approval? This removes its current verified status.` : undefined);
  }

  function approve(event: FormEvent<HTMLFormElement>) { event.preventDefault(); void decide("verify"); }

  return (
    <form onSubmit={approve} className="rounded-xl border border-[var(--line)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-[var(--ink-900)]">{title} review</h3>
        <span className={`rounded-full px-2 py-1 text-xs font-semibold ${props.verified ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"}`}>{props.verified ? "Current and verified" : document?.reviewStatus === "rejected" ? "Rejected" : "Review needed"}</span>
      </div>
      <div className="mt-3 grid gap-4 md:grid-cols-2">
        <div>
          <p className="text-xs font-semibold text-[var(--muted)]">Provider-entered claim</p>
          <dl className="mt-2 space-y-2">{props.details.map(([name, value]) => <div key={name}><dt className="text-xs text-[var(--muted)]">{name}</dt><dd className="break-words text-sm text-[var(--ink-900)]">{value || "Not provided"}</dd></div>)}</dl>
          {document ? <div className="mt-3 rounded-lg bg-[var(--canvas)] p-3">
            <a href={document.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center text-sm font-semibold text-[var(--teal-800)] underline">Download current {kind} document</a>
            <p className="text-xs text-[var(--muted)]">Uploaded <time dateTime={document.uploadedAt}>{document.uploadedAt.slice(0, 16).replace("T", " ")} UTC</time>. This approval is bound to this exact document.</p>
            {document.reviewReason && <p className="mt-2 break-words text-xs text-[var(--muted)]">Previous review: {document.reviewReason}</p>}
          </div> : <div className="mt-3 space-y-2"><p className="text-sm text-[var(--muted)]">No current document. Ask the provider to upload evidence before approving.</p>{props.verifiedAt && <button type="button" disabled={pending} className="min-h-10 rounded-lg border px-3 py-2 text-xs font-semibold text-red-700 disabled:opacity-50" onClick={() => void decide("revoke")}>Revoke previous verification</button>}</div>}
        </div>
        <fieldset className="space-y-3" disabled={pending || !document}>
          <legend className="sr-only">{title} decision</legend>
          <label className="block text-xs font-semibold">Valid through (UTC date)<input className="mt-1 block min-h-10 w-full rounded-lg border border-[var(--line)] bg-[var(--paper)] px-3 text-sm" type="date" value={expiresOn} onChange={(event) => setExpiresOn(event.target.value)} min={today} required /><span className="mt-1 block text-xs font-normal text-[var(--muted)]">Valid through the stated UTC date, including its last day.</span></label>
          {kind === "insurance" && <>
            <label className="block text-xs font-semibold">Reviewed coverage (USD)<input className="mt-1 block min-h-10 w-full rounded-lg border border-[var(--line)] bg-[var(--paper)] px-3 text-sm" inputMode="decimal" type="text" value={coverage} onChange={(event) => setCoverage(event.target.value)} required /></label>
            <label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={additional} onChange={(event) => setAdditional(event.target.checked)} /><span>Additional-insured endorsement is supported by the reviewed evidence.</span></label>
          </>}
          <label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} /><span>I reviewed this current document against the claim and expiry{kind === "insurance" ? ", coverage and endorsement" : ""}.</span></label>
          <label className="block text-xs font-semibold">Review reason (required to reject)<textarea className="mt-1 block min-h-20 w-full rounded-lg border border-[var(--line)] bg-[var(--paper)] p-2 text-sm" value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} /></label>
          <div className="flex flex-wrap gap-2">
            <button type="submit" className="min-h-10 rounded-lg bg-[var(--teal-800)] px-3 py-2 text-xs font-semibold text-white">Approve {kind}</button>
            <button type="button" className="min-h-10 rounded-lg border px-3 py-2 text-xs font-semibold" onClick={() => void decide("reject")}>Reject document</button>
            {(props.verifiedAt || document?.reviewStatus === "approved") && <button type="button" className="min-h-10 rounded-lg border px-3 py-2 text-xs font-semibold text-red-700" onClick={() => void decide("revoke")}>Revoke approval</button>}
          </div>
        </fieldset>
      </div>
      {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
    </form>
  );
}
