"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { VendorLeadDirectory } from "@/components/admin/VendorLeadDirectory";
import type { VendorSourcingView } from "@/lib/vendor-sourcing-types";

export function VendorSourcingPanel({ communityId }: { communityId: string }) {
  const loadGeneration = useRef(0);
  const [requests, setRequests] = useState<Array<{ id: string; title: string; category: string }>>([]);
  const [requestId, setRequestId] = useState(""); const [view, setView] = useState<VendorSourcingView | null>(null);
  const currentRequest = useRef(requestId);
  currentRequest.current = requestId;
  const [selected, setSelected] = useState<string[]>([]); const [busy, setBusy] = useState(false); const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null); const [notice, setNotice] = useState<string | null>(null); const [directory, setDirectory] = useState(false);
  useEffect(() => { const controller = new AbortController(); setRequests([]); setRequestId("");
    void fetch(`/api/admin/communities/${encodeURIComponent(communityId)}/vendor-sourcing`, { credentials: "same-origin", cache: "no-store", signal: controller.signal }).then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error || "Could not load open requests."); if (!controller.signal.aborted) setRequests(data.requests); }).catch(caught => { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "Could not load open requests."); });
    return () => controller.abort();
  }, [communityId]);
  const load = useCallback(async (signal?: AbortSignal) => {
    if (requestId !== currentRequest.current) return;
    const generation = ++loadGeneration.current;
    if (!requestId) { setView(null); setLoading(false); return; } setLoading(true);
    try { const response = await fetch(`/api/admin/requests/${encodeURIComponent(requestId)}/vendor-sourcing`, { credentials: "same-origin", cache: "no-store", signal }); const result = await response.json(); if (!response.ok) throw new Error(result.error || "Could not load matching vendors."); if (!signal?.aborted && generation === loadGeneration.current && requestId === currentRequest.current) setView(result); }
    catch (caught) { if (!signal?.aborted && generation === loadGeneration.current && requestId === currentRequest.current) setError(caught instanceof Error ? caught.message : "Could not load matching vendors."); }
    finally { if (!signal?.aborted && generation === loadGeneration.current && requestId === currentRequest.current) setLoading(false); }
  }, [requestId]);
  useEffect(() => { const controller = new AbortController(); setView(null); setSelected([]); setError(null); setNotice(null); void load(controller.signal); return () => { controller.abort(); loadGeneration.current++; }; }, [load]);
  const selectedLeadNeedsSetup = selected.some(id => id.startsWith("lead:")) && !view?.outreach.ready;
  const toggle = (id: string) => setSelected(current => current.includes(id) ? current.filter(x => x !== id) : [...current, id]);
  return <section className="rounded-2xl border border-[#dce7e4] bg-white p-5">
    <h2 className="font-semibold text-[#102a43]">Source vendors and invite proposals</h2>
    <p className="mt-2 text-sm text-[#64748b]">Review current providers and licensed leads for each open request. Invitations never approve documents, activate payouts or override award requirements.</p>
    <label className="mt-4 block text-sm">Open request<select className="mt-1 block min-h-11 w-full rounded-lg border p-2" value={requestId} disabled={busy} onChange={event => setRequestId(event.target.value)}><option value="">Choose a request</option>{requests.map(request => <option key={request.id} value={request.id}>{request.title}</option>)}</select></label>
    {loading && <p role="status" className="mt-3 text-sm">Loading matching vendors…</p>}
    {!requests.length && <p className="mt-3 text-sm text-[#64748b]">No requests are currently open for bids.</p>}
    {view && view.request.id === requestId && !loading && <form className="mt-4 space-y-4" onSubmit={async event => { event.preventDefault(); if (busy || !selected.length || selectedLeadNeedsSetup || view.request.id !== requestId) return; setBusy(true); setError(null); setNotice(null);
      try { const response = await fetch(`/api/admin/requests/${encodeURIComponent(requestId)}/vendor-sourcing`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ leadIds: selected.filter(x => x.startsWith('lead:')).map(x => x.slice(5)), providerUserIds: selected.filter(x => x.startsWith('provider:')).map(x => x.slice(9)) }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error || "Could not queue invitations."); setSelected([]); setNotice(`${data.queuedCount} lead invitations and ${data.registeredCount} registered-provider invitations queued. Delivery rechecks eligibility and suppression.`); await load(); }
      catch (caught) { setError(caught instanceof Error ? caught.message : "Could not queue invitations."); } finally { setBusy(false); }
    }}>
      <dl className="grid grid-cols-2 gap-3 rounded-lg bg-[#f6faf9] p-3 text-sm sm:grid-cols-4">{Object.entries(view.funnel).map(([key,count]) => <div key={key}><dt>{({invited:'Invited',opened:'Opened',proposalStarted:'Proposal started',submitted:'Submitted'} as Record<string, string>)[key]}</dt><dd className="mt-1 text-lg font-semibold">{count}</dd></div>)}</dl>
      {!view.outreach.ready && <div role="status" className="rounded border border-amber-200 bg-amber-50 p-3 text-sm">New lead outreach is paused until the dedicated sender, postal address, delivery tracking and sending approval are configured.<p className="mt-1 break-words text-xs">Missing configuration: {view.outreach.missing.join(', ')}</p></div>}
      <fieldset><legend className="font-semibold text-sm">Registered providers</legend><div className="mt-2 space-y-2">{view.registered.map(provider => <label className="flex min-h-11 items-start gap-2 rounded border p-3 text-sm" key={provider.providerUserId}><input className="mt-1" type="checkbox" checked={selected.includes(`provider:${provider.providerUserId}`)} disabled={busy || provider.invited || (selected.length >= 25 && !selected.includes(`provider:${provider.providerUserId}`))} onChange={() => toggle(`provider:${provider.providerUserId}`)} /><span><strong>{provider.name}</strong> · {provider.verified ? 'Verified' : 'Verification pending'}{provider.approved ? ' · HOA-approved vendor' : ''}{provider.invited ? ' · Already invited' : ''}{provider.distanceMi !== null ? ` · ${provider.distanceMi.toFixed(1)} miles` : ''}</span></label>)}{!view.registered.length && <p className="text-sm text-[#64748b]">No currently eligible registered providers.</p>}</div></fieldset>
      <fieldset><legend className="font-semibold text-sm">Licensed leads for review</legend><div className="mt-2 space-y-2">{view.leads.map(lead => <label className="flex min-h-11 items-start gap-2 rounded border p-3 text-sm" key={lead.id}><input className="mt-1" type="checkbox" checked={selected.includes(`lead:${lead.id}`)} disabled={busy || !lead.eligible || !view.outreach.ready || (selected.length >= 25 && !selected.includes(`lead:${lead.id}`))} onChange={() => toggle(`lead:${lead.id}`)} /><span><strong>{lead.businessName}</strong> · {lead.licenseClasses.join(', ')} · {lead.licenseStatus}{lead.distanceMi !== null ? ` · ${lead.distanceMi.toFixed(1)} miles` : ''}<span className="mt-1 block text-xs text-[#64748b]">{lead.exclusionReason ?? (lead.lastInvitedAt ? `Last contacted ${new Date(lead.lastInvitedAt).toLocaleDateString()}` : 'Not contacted for this request')}{!lead.contactConfirmed ? ' · Business email needs confirmation' : ''}</span>{lead.phone && <span className="mt-1 block text-xs">Call task: <a href={`tel:${lead.phone.replace(/[^+0-9]/g,'')}`} className="underline">{lead.phone}</a> — manual follow-up only</span>}</span></label>)}{!view.leads.length && <p className="text-sm text-[#64748b]">No matching licensed leads. Add a referral or import a filtered CSLB CSV.</p>}</div></fieldset>
      <p className="text-xs text-[#64748b]">Select up to 25. A lead receives at most three messages per request; opened, declined, expired, bounced or unsubscribed contacts are excluded from follow-ups. No automated SMS or calls.</p>
      <button className="min-h-11 rounded-lg bg-[#0f756c] px-4 text-sm font-semibold text-white disabled:opacity-50" type="submit" disabled={busy || !selected.length || selected.length > 25 || selectedLeadNeedsSetup}>{busy ? 'Queuing…' : 'Invite selected providers'}</button>
    </form>}
    <button type="button" className="mt-4 min-h-11 rounded-lg border px-4 text-sm" onClick={() => setDirectory(value => !value)}>{directory ? 'Hide vendor directory' : 'Add, edit or import vendor leads'}</button>
    {directory && <VendorLeadDirectory onChanged={() => void load()} />}
    {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}{notice && <p role="status" className="mt-3 text-sm text-green-800">{notice}</p>}
  </section>;
}
