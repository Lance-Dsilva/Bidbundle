"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { serviceCategoryLabel } from "@/lib/service-categories";

type Policy = { category: string; requiresAfterPhoto: boolean };

/** Global category defaults; server snapshots them only for future requests. */
export function CategoryVisitProofPolicyPanel() {
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [category, setCategory] = useState("");
  const [edits, setEdits] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [denied, setDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const mounted = useRef(false);
  const inFlight = useRef(false);
  const generation = useRef(0);

  const load = useCallback(async (signal?: AbortSignal) => {
    const version = ++generation.current;
    setLoading(true); setError(null);
    try {
      const response = await fetch("/api/admin/visit-proof-policy", { credentials: "same-origin", cache: "no-store", signal });
      const payload = await response.json().catch(() => null) as { policies?: Policy[]; error?: string } | null;
      if (!mounted.current || signal?.aborted || version !== generation.current) return false;
      if (response.status === 403) { setDenied(true); return false; }
      if (!response.ok || !Array.isArray(payload?.policies)) throw new Error(payload?.error ?? "Could not load the category photo requirements.");
      setPolicies(payload.policies); setEdits({}); setDenied(false);
      setCategory((current) => payload.policies!.some((entry) => entry.category === current) ? current : payload.policies![0]?.category ?? "");
      return true;
    } catch (caught) { if (mounted.current && !signal?.aborted && version === generation.current) setError(caught instanceof Error ? caught.message : "Could not load the category photo requirements."); }
    finally { if (mounted.current && !signal?.aborted && version === generation.current) setLoading(false); }
    return false;
  }, []);

  useEffect(() => {
    mounted.current = true; const controller = new AbortController(); void load(controller.signal);
    return () => { mounted.current = false; generation.current++; controller.abort(); };
  }, [load]);
  const selected = policies.find((entry) => entry.category === category);
  const required = selected ? edits[category] ?? selected.requiresAfterPhoto : false;

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || !selected) return;
    inFlight.current = true; setSaving(true); setError(null); setMessage(null);
    try {
      const response = await fetch("/api/admin/visit-proof-policy", { method: "PATCH", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ category, requiresAfterPhoto: required }) });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error ?? "Could not save the photo requirement.");
      const refreshed = await load();
      if (mounted.current) setMessage(refreshed ? "Category requirement saved for future requests. Existing requests and visits keep their current requirements." : "Requirement saved, but the latest settings could not be loaded. Reload requirements before making another change.");
    } catch (caught) { if (mounted.current) setError(caught instanceof Error ? caught.message : "Could not save the photo requirement."); }
    finally { inFlight.current = false; if (mounted.current) setSaving(false); }
  }

  if (denied) return null;
  return <section className="rounded-2xl border border-[var(--line)] bg-[var(--paper)] p-5" aria-labelledby="category-visit-photo-policy">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 id="category-visit-photo-policy" className="text-base font-semibold text-[var(--ink-900)]">Platform visit-photo requirements</h2><p className="mt-1 text-sm leading-6 text-[var(--muted)]">Global category defaults for all communities. Changes apply only to requests created afterward; existing requests and visits keep their saved requirements.</p></div><button type="button" className="min-h-11 rounded-lg border border-[var(--line)] px-3 text-xs font-semibold disabled:opacity-50" disabled={loading || saving} onClick={() => void load()}>Reload requirements</button></div>
    {loading && <p role="status" className="mt-3 text-sm">Loading category photo requirements…</p>}
    {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {message && <p role="status" className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">{message}</p>}
    <form onSubmit={save} className="mt-4 space-y-3"><fieldset className="space-y-3" disabled={loading || saving || !selected}>
      <legend className="sr-only">Category photo policy</legend>
      <label className="block max-w-md text-sm font-semibold">Service category<select className="mt-1 block min-h-11 w-full rounded-lg border border-[var(--line)] bg-white px-3 text-sm" value={category} onChange={(event) => setCategory(event.target.value)}>{policies.map((entry) => <option key={entry.category} value={entry.category}>{serviceCategoryLabel(entry.category)}</option>)}</select></label>
      <label className="flex min-h-11 items-start gap-2 text-sm"><input className="mt-1" type="checkbox" checked={required} onChange={(event) => setEdits((current) => ({ ...current, [category]: event.target.checked }))} /><span>Require at least one after photo before a visit is marked complete.</span></label>
      <button type="submit" className="min-h-11 rounded-lg bg-[var(--teal-800)] px-4 text-sm font-semibold text-white disabled:opacity-50">{saving ? "Saving…" : "Save category requirement"}</button>
    </fieldset></form>
  </section>;
}
