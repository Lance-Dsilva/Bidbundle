"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { VisitPhotoRef } from "@/lib/hoa-types";

const MAX_PHOTO_BYTES = 4 * 1024 * 1024;
const PURPOSES = ["visit_before", "visit_after"] as const;

/** Shared presentation; every upload, byte read and consent is authorized server-side. */
export function VisitPhotoPanel({ visitId, photos: initialPhotos, requiresAfterPhoto = false, canUpload = false, canConsent = false, disabled = false, onUpdated, onBusyChange }: {
  visitId: string; photos: VisitPhotoRef[]; requiresAfterPhoto?: boolean; canUpload?: boolean; canConsent?: boolean; disabled?: boolean;
  onUpdated?: () => void | Promise<unknown>; onBusyChange?: (busy: boolean) => void;
}) {
  // Retain only server-confirmed responses while the parent reloads its canonical visit.
  const [photos, setPhotos] = useState(initialPhotos);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const inFlight = useRef(false);
  const mounted = useRef(false);
  useEffect(() => { setPhotos(initialPhotos); }, [initialPhotos]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const afterCount = photos.filter((photo) => photo.purpose === "visit_after").length;

  async function refresh() {
    try {
      const result = await onUpdated?.();
      return !(result && typeof result === "object" && "ok" in result && result.ok === false);
    } catch { return false; }
  }

  async function upload(event: FormEvent<HTMLFormElement>, purpose: typeof PURPOSES[number]) {
    event.preventDefault();
    if (disabled || inFlight.current) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const file = data.get("file");
    if (!(file instanceof File) || !file.size) { setError("Choose a photo first."); return; }
    if (file.size > MAX_PHOTO_BYTES) { setError("Choose a JPEG, PNG or WebP photo of 4 MiB or less."); return; }
    data.set("purpose", purpose);
    inFlight.current = true; setPending(purpose); setError(null); setMessage(null); onBusyChange?.(true);
    try {
      const response = await fetch(`/api/provider/marketplace/visits/${encodeURIComponent(visitId)}/photos`, { method: "POST", credentials: "same-origin", body: data });
      const payload = await response.json().catch(() => null) as { photo?: VisitPhotoRef; error?: string } | null;
      if (!response.ok || !payload?.photo) throw new Error(payload?.error ?? `Photo upload failed (HTTP ${response.status}).`);
      if (!mounted.current) return;
      const photo = payload.photo;
      setPhotos((existing) => [...existing.filter((entry) => entry.id !== photo.id), photo]);
      form.reset();
      setMessage("Photo uploaded privately. Refreshing the visit…");
      const refreshed = await refresh();
      if (mounted.current) setMessage(refreshed ? "Photo saved privately. The resident and authorized service team can view it." : "Photo saved, but the visit could not be refreshed. Reload the visit before marking it complete; do not upload the same photo again.");
    } catch (caught) { if (mounted.current) setError(caught instanceof Error ? caught.message : "Could not upload the photo."); }
    finally { inFlight.current = false; if (mounted.current) setPending(null); onBusyChange?.(false); }
  }

  async function consent(photo: VisitPhotoRef, value: boolean) {
    if (disabled || inFlight.current) return;
    inFlight.current = true; setPending(photo.id); setError(null); setMessage(null);
    try {
      const response = await fetch(`/api/hoa/visits/${encodeURIComponent(visitId)}/photos/${encodeURIComponent(photo.id)}/consent`, { method: "PATCH", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ consent: value }) });
      const payload = await response.json().catch(() => null) as { photo?: VisitPhotoRef; error?: string } | null;
      if (!response.ok || !payload?.photo) throw new Error(payload?.error ?? "Could not save your photo permission.");
      if (!mounted.current) return;
      const updated = payload.photo;
      setPhotos((existing) => existing.map((entry) => entry.id === updated.id ? updated : entry));
      setMessage(value ? "Permission saved for this photo only. The photo remains private and has not been published." : "Permission withdrawn for this photo. It remains private.");
      await refresh();
    } catch (caught) { if (mounted.current) setError(caught instanceof Error ? caught.message : "Could not save your photo permission."); }
    finally { inFlight.current = false; if (mounted.current) setPending(null); }
  }

  return <section className="mt-3 min-w-0 rounded-xl border border-[var(--line)] bg-[var(--paper)] p-3" aria-label="Private visit photos">
    <h4 className="text-sm font-semibold text-[var(--ink-900)]">Before &amp; after photos</h4>
    <p className="mt-1 text-xs leading-5 text-[var(--muted)]">Private proof of this visit. Photos are visible only to the resident and authorized service team.</p>
    {requiresAfterPhoto && canUpload && <p className={`mt-2 text-xs font-semibold ${afterCount ? "text-emerald-800" : "text-amber-800"}`} role="status">{afterCount ? "After-photo evidence uploaded. Refresh the visit if completion is still unavailable." : "At least one after photo is required before this visit can be marked complete."}</p>}
    {error && <p className="mt-2 rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert">{error}</p>}
    {message && <p className="mt-2 rounded-lg bg-emerald-50 p-3 text-xs text-emerald-900" role="status">{message}</p>}
    <div className="mt-3 grid min-w-0 gap-4 sm:grid-cols-2">
      {PURPOSES.map((purpose) => {
        const entries = photos.filter((photo) => photo.purpose === purpose);
        const label = purpose === "visit_before" ? "Before" : "After";
        return <div className="min-w-0" key={purpose}><h5 className="text-xs font-semibold text-[var(--ink-700)]">{label}</h5>
          {entries.length ? <ul className="mt-2 space-y-3">{entries.map((photo) => <li key={photo.id} className="min-w-0 rounded-lg border border-[var(--line)] p-2">
            {photo.src.startsWith("/api/visit-photos/") ? <a href={photo.src} target="_blank" rel="noopener noreferrer" className="block rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--teal-800)]"><img src={photo.src} alt={`${label} photo for this service visit`} width={640} height={480} loading="lazy" className="aspect-[4/3] w-full rounded-md object-contain" /></a> : <p className="text-xs">Photo unavailable.</p>}
            <p className="mt-1 text-[11px] text-[var(--muted)]">Uploaded <time dateTime={photo.createdAt}>{photo.createdAt.slice(0, 16).replace("T", " ")} UTC</time></p>
            {canConsent && photo.canConsent === true && <label className="mt-2 flex items-start gap-2 text-xs leading-5"><input className="mt-1" type="checkbox" checked={photo.marketingConsented} disabled={disabled || pending !== null} onChange={(event) => void consent(photo, event.target.checked)} /><span>Allow future marketing use of this specific {label.toLowerCase()} photo (optional).</span></label>}
          </li>)}</ul> : <p className="mt-2 text-xs text-[var(--muted)]">No {label.toLowerCase()} photos yet.</p>}
          {canUpload && <form className="mt-3 space-y-2" onSubmit={(event) => void upload(event, purpose)}>
            <label className="block text-xs font-semibold">Take or choose {purpose === "visit_after" ? "an after" : "a before"} photo<input className="mt-2 block min-h-11 w-full min-w-0 text-xs" name="file" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" required disabled={disabled || pending !== null} /></label>
            <button className="min-h-11 rounded-lg bg-[var(--teal-800)] px-3 py-2 text-xs font-semibold text-white disabled:opacity-50" type="submit" disabled={disabled || pending !== null}>{pending === purpose ? "Uploading…" : `Upload ${label.toLowerCase()} photo`}</button>
          </form>}
        </div>;
      })}
    </div>
    {canUpload && <p className="mt-3 text-xs leading-5 text-[var(--muted)]">JPEG, PNG or WebP · up to 4 MiB each. Choose photos of the work; avoid people, personal documents and unrelated property. Camera capture depends on your browser.</p>}
    {canConsent && <p className="mt-3 text-xs leading-5 text-[var(--muted)]">Marketing permission is optional and separate from your rating and service. You can withdraw it for each photo. Giving permission does not publish a photo; all photos on this screen remain private.</p>}
    {onUpdated && <button className="mt-3 min-h-11 rounded-lg border border-[var(--line)] px-3 text-xs font-semibold disabled:opacity-50" type="button" disabled={disabled || pending !== null} onClick={() => { setError(null); void refresh().then((ok) => { if (mounted.current && !ok) setError("Could not refresh the visit. Please try again."); }).catch(() => { if (mounted.current) setError("Could not refresh the visit. Please try again."); }); }}>Refresh visit photos</button>}
  </section>;
}
