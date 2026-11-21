"use client";
import { useEffect, useRef, useState } from "react";
type Photo = { id: string; src: string };
export function QualityEvidence({ claimId, canUpload = false }: { claimId: string; canUpload?: boolean }) {
  const [photos, setPhotos] = useState<Photo[]>([]), [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const lock = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/quality/${encodeURIComponent(claimId)}/photos`, { cache: "no-store", signal: controller.signal }).then(async response => {
      const result = await response.json(); if (!response.ok) throw new Error(result.error ?? "Unable to load evidence.");
      if (!controller.signal.aborted) setPhotos(result.photos);
    }).catch(error => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Unable to load evidence."); });
    return () => controller.abort();
  }, [claimId]);
  return <div className="space-y-3"><h3 className="font-semibold">Private evidence photos</h3>
    <ul className="flex flex-wrap gap-3">{photos.map((photo, i) => <li key={photo.id}><a href={photo.src} target="_blank" rel="noreferrer" className="underline">View evidence photo {i + 1}</a></li>)}</ul>
    {canUpload && <form className="space-y-2" onSubmit={async event => {
      event.preventDefault(); if (lock.current) return;
      const form = event.currentTarget, data = new FormData(form);
      lock.current = true; setBusy(true); setError(null);
      try {
        const response = await fetch(`/api/quality/${encodeURIComponent(claimId)}/photos`, { method: "POST", credentials: "same-origin", body: data });
        const result = await response.json(); if (!response.ok) throw new Error(result.error ?? "Upload failed.");
        setPhotos(current => [...current, result.photo]); form.reset();
      } catch (error) { setError(error instanceof Error ? error.message : "Upload failed."); }
      finally { lock.current = false; setBusy(false); }
    }}>
      <p className="text-xs">Up to eight JPEG, PNG or WebP photos, 4 MiB each, within 72 hours of completion. Shared only with you, the assigned provider and authorized administrators. Photos are never used for marketing.</p>
      <label className="block text-sm">Evidence photo<input type="file" name="file" accept="image/jpeg,image/png,image/webp" required disabled={busy || photos.length >= 8} className="block max-w-full" /></label>
      <button className="bb-btn bb-btn-secondary min-h-11" disabled={busy || photos.length >= 8}>{busy ? "Uploading…" : "Add evidence photo"}</button>
    </form>}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
  </div>;
}
