"use client";
import { useEffect, useRef, useState } from "react";

const labels: Record<string, string> = { not_connected: "Not connected", pending: "Setup incomplete or under review", active: "Sandbox payouts active", restricted: "More information is required by Stripe" };
export function StripeTestPayoutSetup() {
  const [enabled, setEnabled] = useState(false); const [status, setStatus] = useState("not_connected");
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/provider/payout-setup", { signal: controller.signal, cache: "no-store" }).then(async (response) => {
      if (!response.ok) return;
      const result = await response.json();
      if (!controller.signal.aborted) { setEnabled(result.enabled === true); setStatus(result.status ?? "not_connected"); }
    }).catch(() => {});
    return () => controller.abort();
  }, []);
  if (!enabled) return null;
  return <section className="bb-card bb-card-pad space-y-3">
    <h2 className="bb-card-title">Test payout setup</h2>
    <p className="text-sm">Sandbox only. This does not enable real payments.</p>
    <p role="status" className="text-sm font-semibold">{labels[status] ?? "Status unavailable"}</p>
    <button type="button" className="bb-btn bb-btn-primary min-h-11" disabled={busy} onClick={async () => {
      if (inFlight.current) return;
      inFlight.current = true; setBusy(true); setError(null);
      try {
        const response = await fetch("/api/provider/payout-setup", { method: "POST", credentials: "same-origin" });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "Payout setup unavailable.");
        const url = new URL(result.url);
        if (url.protocol !== "https:" || url.hostname !== "connect.stripe.com") throw new Error("Payout setup unavailable.");
        window.location.assign(url.toString());
      } catch (caught) { setError(caught instanceof Error ? caught.message : "Payout setup unavailable."); }
      finally { inFlight.current = false; setBusy(false); }
    }}>{busy ? "Opening Stripe…" : status === "not_connected" ? "Set up test payouts" : "Continue in Stripe"}</button>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
  </section>;
}
