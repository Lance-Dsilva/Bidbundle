"use client";

import { useUser } from "@clerk/nextjs";
import { useEffect, useState } from "react";

/** No third-party SDK, cookies, automatic page capture or replay. All events
 * are server-mediated and require the current account's explicit choice. */
export function AnalyticsConsent() {
  const { isSignedIn, user } = useUser();
  return isSignedIn && user ? <AccountAnalyticsConsent key={user.id} /> : null;
}

function AccountAnalyticsConsent() {
  const [state, setState] = useState<{ allowed: boolean; decided: boolean } | null>(null);
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setState(null); setEditing(false); setError("");
    const controller = new AbortController();
    void fetch("/api/analytics/consent", { cache: "no-store", signal: controller.signal }).then(async (response) => {
      if (!response.ok) return;
      const value = await response.json();
      if (!controller.signal.aborted && typeof value.allowed === "boolean" && typeof value.decided === "boolean") setState(value);
    }).catch(() => {});
    return () => controller.abort();
  }, []);

  if (!state) return null;
  async function save(allowed: boolean) {
    setPending(true); setError("");
    try {
      const response = await fetch("/api/analytics/consent", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ allowed }) });
      if (!response.ok) throw new Error();
      setState({ allowed, decided: true }); setEditing(false);
    } catch { setError("Your preference could not be saved. Please try again."); }
    finally { setPending(false); }
  }
  if (state.decided && !editing) return <button type="button" className="fixed bottom-2 left-2 z-40 rounded-lg border bg-white px-3 py-2 text-xs text-slate-700 shadow-sm" onClick={() => setEditing(true)}>Analytics preferences</button>;
  return <section aria-label="Optional analytics" className="fixed bottom-4 left-4 right-4 z-50 mx-auto max-w-xl rounded-2xl border bg-white p-5 text-slate-900 shadow-xl">
    <h2 className="text-base font-semibold">Help improve Bundleen</h2>
    <p className="mt-2 text-sm">Allow optional analytics to understand which services work well? We send account IDs and service activity to PostHog, never names, addresses or payment details. No session recording or analytics cookies are used. Your choice does not affect access to services.</p>
    <p className="mt-2 text-xs text-slate-600">You can change this preference at any time. Turning analytics off stops future collection; it does not delete events already sent.</p>
    {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
    <div className="mt-4 flex flex-wrap gap-3">
      <button type="button" className="min-h-11 rounded-lg border px-4 py-2" disabled={pending} onClick={() => void save(false)}>Decline analytics</button>
      <button type="button" className="min-h-11 rounded-lg border px-4 py-2" disabled={pending} onClick={() => void save(true)}>Allow analytics</button>
      {state.decided && <button type="button" className="min-h-11 px-3 py-2" disabled={pending} onClick={() => setEditing(false)}>Cancel</button>}
    </div>
  </section>;
}
