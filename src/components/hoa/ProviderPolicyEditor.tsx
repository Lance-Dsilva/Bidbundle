"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

import { coverageCents, coverageDollars } from "@/components/provider/credential-format";

type Policy = { minimumInsuranceCoverageCents: number; requiresAdditionalInsured: boolean };

export function ProviderPolicyEditor({ communityId, onSaved }: { communityId: string; onSaved?: () => void }) {
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [minimum, setMinimum] = useState("");
  const [additional, setAdditional] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [denied, setDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const mounted = useRef(false);
  const inFlight = useRef(false);
  const requestVersion = useRef(0);
  const path = `/api/hoa/communities/${encodeURIComponent(communityId)}/provider-policy`;

  const load = useCallback(async (signal?: AbortSignal) => {
    const version = ++requestVersion.current;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(path, { credentials: "same-origin", cache: "no-store", signal });
      const payload = await response.json();
      if (!mounted.current || version !== requestVersion.current || signal?.aborted) return;
      if (response.status === 403 || response.status === 404) { setDenied(true); return; }
      if (!response.ok) throw new Error(payload?.error ?? "Could not load provider requirements.");
      setPolicy(payload);
      setMinimum(coverageDollars(payload.minimumInsuranceCoverageCents));
      setAdditional(payload.requiresAdditionalInsured);
      setDenied(false);
      return true;
    } catch (caught) {
      if (mounted.current && version === requestVersion.current && !signal?.aborted) setError(caught instanceof Error ? caught.message : "Could not load provider requirements.");
    } finally {
      if (mounted.current && version === requestVersion.current && !signal?.aborted) setLoading(false);
    }
    return false;
  }, [path]);

  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    void load(controller.signal);
    return () => { mounted.current = false; requestVersion.current++; controller.abort(); };
  }, [load]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || !policy) return;
    const cents = coverageCents(minimum);
    if (cents === null) { setError("Enter a non-negative USD amount with up to two decimal places."); return; }
    inFlight.current = true;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(path, {
        method: "PATCH", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ minimumInsuranceCoverageCents: cents, requiresAdditionalInsured: additional }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error ?? "Could not save provider requirements.");
      if (!mounted.current) return;
      const refreshed = await load();
      if (mounted.current) {
        setMessage(refreshed ? "Provider requirements saved. New awards use these requirements." : "Requirements saved, but the current policy could not be reloaded. Reload requirements before making further changes.");
        onSaved?.();
      }
    } catch (caught) {
      if (mounted.current) setError(caught instanceof Error ? caught.message : "Could not save provider requirements.");
    } finally {
      inFlight.current = false;
      if (mounted.current) setSaving(false);
    }
  }

  if (denied) return null;
  return (
    <section className="rounded-2xl border border-[var(--line)] bg-[var(--paper)] p-5" aria-labelledby={`provider-policy-${communityId}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-[var(--ink-900)]" id={`provider-policy-${communityId}`}>Provider insurance requirements</h2>
          <p className="mt-1 text-sm leading-6 text-[var(--muted)]">These requirements apply to new provider awards for this HOA. Changes are recorded in the audit log.</p>
        </div>
        <button type="button" disabled={loading || saving} className="min-h-10 rounded-lg border px-3 py-2 text-xs font-semibold disabled:opacity-50" onClick={() => void load()}>Reload requirements</button>
      </div>
      {loading && <p role="status" className="mt-3 text-sm">Loading provider requirements…</p>}
      {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {message && <p role="status" className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{message}</p>}
      <form className="mt-4 space-y-3" onSubmit={(event) => void save(event)}>
        <label className="block max-w-sm text-sm font-semibold">
          Minimum insurance coverage (USD)
          <input type="text" inputMode="decimal" value={minimum} onChange={(event) => setMinimum(event.target.value)} required disabled={!policy || loading || saving} className="mt-2 block min-h-11 w-full rounded-lg border border-[var(--line)] bg-[var(--paper)] px-3 text-sm font-normal" />
          <span className="mt-1 block text-xs font-normal text-[var(--muted)]">Use 0 for no additional minimum. A current, reviewed insurance document is still required.</span>
        </label>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={additional} onChange={(event) => setAdditional(event.target.checked)} disabled={!policy || loading || saving} /><span>Require an additional-insured endorsement for this HOA.</span></label>
        <button type="submit" disabled={!policy || loading || saving} className="min-h-11 rounded-lg bg-[var(--teal-800)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving ? "Saving…" : "Save provider requirements"}</button>
      </form>
    </section>
  );
}
