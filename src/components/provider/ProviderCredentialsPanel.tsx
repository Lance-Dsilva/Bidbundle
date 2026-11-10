"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

import type { ProviderCredentials } from "@/lib/provider-credential-types";
import { coverageLabel } from "./credential-format";

const MAX_BYTES = 4 * 1024 * 1024;
const kinds = ["license", "insurance"] as const;
const label = { license: "License", insurance: "Insurance" };

export function ProviderCredentialsPanel({ onUpdated }: { onUpdated: () => void | Promise<unknown> }) {
  const [credentials, setCredentials] = useState<ProviderCredentials | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState<(typeof kinds)[number] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const mounted = useRef(false);
  const inFlight = useRef(false);
  const generation = useRef(0);

  const load = useCallback(async (signal?: AbortSignal) => {
    const current = ++generation.current;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/provider/credentials", {
        credentials: "same-origin", cache: "no-store", signal,
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error ?? "Could not load your credential documents.");
      if (mounted.current && current === generation.current && !signal?.aborted) {
        setCredentials(payload);
        return true;
      }
    } catch (caught) {
      if (mounted.current && current === generation.current && !signal?.aborted) {
        setError(caught instanceof Error ? caught.message : "Could not load your credential documents.");
      }
    } finally {
      if (mounted.current && current === generation.current && !signal?.aborted) setLoading(false);
    }
    return false;
  }, []);

  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    void load(controller.signal);
    return () => { mounted.current = false; generation.current++; controller.abort(); };
  }, [load]);

  async function upload(event: FormEvent<HTMLFormElement>, kind: (typeof kinds)[number]) {
    event.preventDefault();
    if (inFlight.current) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const file = data.get("file");
    if (!(file instanceof File) || !file.size) { setError("Choose a credential document first."); return; }
    if (file.size > MAX_BYTES) { setError("Choose a document of 4 MiB or less."); return; }
    data.set("kind", kind);
    inFlight.current = true;
    setUploading(kind);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/provider/credentials", {
        method: "POST", credentials: "same-origin", body: data,
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error ?? `Document upload failed (HTTP ${response.status}).`);
      if (!mounted.current) return;
      form.reset();
      const refreshed = await load();
      await onUpdated();
      if (mounted.current) setMessage(refreshed
        ? `${label[kind]} document uploaded for review. Replacing a document requires a new Bundleen review.`
        : `${label[kind]} document uploaded, but the current review could not be reloaded. Refresh documents before uploading again.`);
    } catch (caught) {
      if (mounted.current) setError(caught instanceof Error ? caught.message : "Could not upload the document.");
    } finally {
      inFlight.current = false;
      if (mounted.current) setUploading(null);
    }
  }

  return (
    <section className="rounded-[18px] border border-[var(--border-warm)] bg-[var(--bg-card)] p-5" aria-labelledby="credential-documents-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="credential-documents-title" className="text-base font-semibold text-[var(--ink-900)]">License &amp; insurance documents</h2>
          <p className="mt-1 text-sm leading-6 text-[var(--ink-500)]">Private evidence for Bundleen review. Other providers, residents and HOA members cannot download these documents.</p>
        </div>
        <button type="button" className="rounded-lg border px-3 py-2 text-xs font-semibold disabled:opacity-50" disabled={loading || uploading !== null} onClick={() => void load()}>Refresh documents</button>
      </div>
      <p className="mt-2 text-xs leading-5 text-[var(--ink-500)]">PDF, JPEG, PNG or WebP, up to 4 MiB. Do not upload tax IDs, Social Security numbers or W-9 forms. Expiry dates are valid through the stated UTC date.</p>
      {loading && <p role="status" className="mt-3 text-sm">Loading credential documents…</p>}
      {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {message && <p role="status" className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{message}</p>}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {kinds.map((kind) => {
          const document = credentials?.[kind];
          const expires = kind === "license" ? credentials?.licenseExpiresOn : credentials?.insuranceExpiresOn;
          return (
            <div key={kind} className="min-w-0 rounded-xl border border-[var(--border-warm)] p-4">
              <h3 className="text-sm font-semibold text-[var(--ink-900)]">{label[kind]}</h3>
              {document ? <>
                <p className="mt-2 text-sm">Review: {document.reviewStatus === "pending" ? "Awaiting review" : document.reviewStatus === "approved" ? "Approved document" : "Rejected — replacement needed"}</p>
                {document.reviewReason && <p className="mt-1 break-words text-sm text-[var(--ink-500)]">Review note: {document.reviewReason}</p>}
                <a className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold text-[var(--teal-800)] underline" href={document.url} target="_blank" rel="noopener noreferrer">Download current {kind} document</a>
                <p className="text-xs text-[var(--ink-500)]">Valid through {expires ?? "not yet reviewed"}{expires ? " (UTC)" : ""}. Approval alone does not keep an expired credential current.</p>
              </> : <p className="mt-2 text-sm text-[var(--ink-500)]">No {kind} document uploaded.</p>}
              {kind === "insurance" && credentials && <p className="mt-2 text-xs text-[var(--ink-500)]">Reviewed coverage: {coverageLabel(credentials.insuranceCoverageCents)}. Additional-insured endorsement reviewed: {credentials.insuranceAdditionalInsured ? "Yes" : "No"}.</p>}
              <form className="mt-3 space-y-2" onSubmit={(event) => void upload(event, kind)}>
                <label className="block text-xs font-semibold">
                  {document ? `Replace ${kind} document` : `Upload ${kind} document`}
                  <input className="mt-2 block w-full min-w-0 text-xs" type="file" name="file" accept=".pdf,image/jpeg,image/png,image/webp" required disabled={loading || uploading !== null} />
                </label>
                <button className="min-h-10 rounded-lg bg-[var(--teal-800)] px-4 py-2 text-xs font-semibold text-white disabled:opacity-50" type="submit" disabled={loading || uploading !== null}>{uploading === kind ? "Uploading…" : document ? "Upload replacement for review" : "Upload for review"}</button>
              </form>
            </div>
          );
        })}
      </div>
    </section>
  );
}
