"use client";
import { useState } from "react";

export function VendorReferralForm({ requestId }: { requestId: string }) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null); const [saved, setSaved] = useState(false);
  return <details className="mt-4 rounded-lg border border-[#dce7e4] p-3">
    <summary className="cursor-pointer text-sm font-semibold">Recommend your current service provider</summary>
    <p className="mt-2 text-xs text-[#64748b]">Share a business contact for the Bundleen team to review. A referral does not verify a provider or send them a message.</p>
    <form className="mt-3 grid gap-3 sm:grid-cols-2" onSubmit={async event => {
      event.preventDefault(); if (busy) return; setBusy(true); setError(null); setSaved(false);
      const form = event.currentTarget; const data = new FormData(form);
      try {
        const response = await fetch(`/api/hoa/requests/${encodeURIComponent(requestId)}/vendor-referrals`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ businessName: data.get("businessName"), email: String(data.get("email") ?? "").trim() || null, phone: String(data.get("phone") ?? "").trim() || null, notes: String(data.get("notes") ?? "").trim() || null }) });
        const result = await response.json(); if (!response.ok) throw new Error(result.error || "Could not save the referral.");
        setSaved(true); form.reset();
      } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not save the referral."); }
      finally { setBusy(false); }
    }}>
      <label className="text-sm">Business name<input className="mt-1 block min-h-11 w-full rounded border p-2" name="businessName" maxLength={160} required /></label>
      <label className="text-sm">Business email<input className="mt-1 block min-h-11 w-full rounded border p-2" name="email" type="email" maxLength={254} /></label>
      <label className="text-sm">Business phone<input className="mt-1 block min-h-11 w-full rounded border p-2" name="phone" type="tel" maxLength={40} /></label>
      <label className="text-sm">Note for the team<input className="mt-1 block min-h-11 w-full rounded border p-2" name="notes" maxLength={1000} /></label>
      <p className="text-xs text-[#64748b] sm:col-span-2">Provide a phone number or email. Please share business information only.</p>
      <button className="min-h-11 rounded bg-[#0f756c] px-4 text-sm font-semibold text-white disabled:opacity-50 sm:col-span-2" disabled={busy} type="submit">{busy ? "Saving…" : "Save provider referral"}</button>
    </form>
    {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
    {saved && <p role="status" className="mt-2 text-sm text-green-800">Referral saved for review. No invitation has been sent.</p>}
  </details>;
}
