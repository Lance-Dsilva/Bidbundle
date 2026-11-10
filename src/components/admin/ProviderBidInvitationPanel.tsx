"use client";

import { useEffect, useState } from "react";

type Choices = { requests: Array<{ id: string; title: string }>; providers: Array<{ id: string; name: string; invited: boolean }> };

export function ProviderBidInvitationPanel({ communityId }: { communityId: string }) {
  const [choices, setChoices] = useState<Choices>({ requests: [], providers: [] });
  const [requestId, setRequestId] = useState("");
  const [providerId, setProviderId] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const base = `/api/admin/communities/${encodeURIComponent(communityId)}/bid-invitations`;

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setProviderId("");
    void fetch(`${base}${requestId ? `?requestId=${encodeURIComponent(requestId)}` : ""}`, { credentials: "same-origin", cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not load bid invitations.");
        if (!controller.signal.aborted) setChoices(data);
      })
      .catch((caught) => { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "Could not load bid invitations."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [base, requestId]);

  return <section className="rounded-2xl border border-[#dce7e4] bg-white p-5">
    <h2 className="font-semibold text-[#102a43]">Invite providers to quote</h2>
    <p className="mt-2 text-sm text-[#64748b]">Choose a registered, currently verified pool-care provider covering this community. Target three verified bids. Invitations do not bypass bidding or verification requirements.</p>
    <form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={async (event) => {
      event.preventDefault();
      if (busy || loading || !requestId || !providerId) return;
      setBusy(true); setError(null); setNotice(null);
      try {
        const response = await fetch(base, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestId, providerUserId: providerId }) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not queue the invitation.");
        setChoices((current) => ({ ...current, providers: current.providers.map((provider) => provider.id === providerId ? { ...provider, invited: true } : provider) }));
        setProviderId("");
        setNotice(data.alreadyInvited ? "This provider has already been invited." : "Invitation recorded. In-app notification queued; email follows the provider's job notification preference.");
      } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not queue the invitation."); }
      finally { setBusy(false); }
    }}>
      <label className="text-sm">Pool-service request
        <select className="mt-1 block min-h-11 w-full rounded-lg border p-2" required value={requestId} disabled={busy} onChange={(event) => { setRequestId(event.target.value); setNotice(null); }}>
          <option value="">Choose an open request</option>
          {choices.requests.map((request) => <option key={request.id} value={request.id}>{request.title}</option>)}
        </select>
      </label>
      <label className="text-sm">Named provider
        <select className="mt-1 block min-h-11 w-full rounded-lg border p-2" required value={providerId} disabled={!requestId || loading || busy} onChange={(event) => setProviderId(event.target.value)}>
          <option value="">Choose an eligible provider</option>
          {choices.providers.map((provider) => <option key={provider.id} value={provider.id} disabled={provider.invited}>{provider.name}{provider.invited ? " — invited" : ""}</option>)}
        </select>
      </label>
      <button className="min-h-11 rounded-lg bg-[#0f756c] px-4 text-sm font-semibold text-white disabled:opacity-50 sm:col-span-2" disabled={busy || loading || !requestId || !providerId} type="submit">{busy ? "Queuing…" : "Invite provider"}</button>
    </form>
    {loading ? <p role="status" className="mt-2 text-sm">Loading eligible requests and providers…</p> : !choices.requests.length ? <p className="mt-2 text-sm text-[#64748b]">No pool-template requests are currently open for bids.</p> : requestId && !choices.providers.length ? <p className="mt-2 text-sm text-[#64748b]">No current verified providers cover this request. Invitations cannot override this requirement.</p> : null}
    {error ? <p role="alert" className="mt-2 text-sm text-red-700">{error}</p> : null}
    {notice ? <p role="status" className="mt-2 text-sm text-green-800">{notice}</p> : null}
  </section>;
}
