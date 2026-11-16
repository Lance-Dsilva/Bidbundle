"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { BoardCommunitySummary, BoardProposal, BoardReviewView, BoardRoundSummary, BoardRule } from "@/lib/board-types";
import type { HoaInvitationSummary } from "@/lib/hoa-types";
import { POOL_TIER_LABELS, type PoolTier } from "@/lib/pool-bid-template";

const RULE_LABELS: Record<BoardRule, string> = {
  manager_only: "Manager approval only", board_majority: "Majority of the board",
  board_quorum_n: "At least N approvals", board_unanimous: "All board members",
};
const button = "rounded-xl bg-teal-800 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50";
const secondary = "rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 disabled:opacity-50";
const field = "mt-1 w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm";
const card = "rounded-2xl border border-slate-200 bg-white p-5 sm:p-6";
const date = (value: string | null) => value ? new Date(value).toLocaleString() : "Not specified";
const dateOnly = (value: string | null) => value ? new Date(value).toLocaleDateString("en-US", { timeZone: "UTC" }) : "Not specified";
const money = (cents: number, currency = "USD") => new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
async function requestJson<T>(url: string, method = "GET", body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { method, signal, cache: "no-store", credentials: "same-origin", headers: body === undefined ? undefined : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(typeof data?.error === "string" ? data.error : "This action could not be completed. Refresh and try again.");
  return data as T;
}

export function BoardWorkspace({ initialCommunities, initialRequestId }: { initialCommunities: BoardCommunitySummary[]; initialRequestId?: string }) {
  const [communities, setCommunities] = useState(initialCommunities);
  const [communityId, setCommunityId] = useState(initialCommunities.find(item => item.requests.some(request => request.id === initialRequestId))?.id ?? initialCommunities[0]?.id ?? "");
  const community = communities.find(item => item.id === communityId);
  const refresh = useCallback(async () => {
    const data = await requestJson<{ communities: BoardCommunitySummary[] }>("/api/board/communities");
    setCommunities(data.communities);
  }, []);
  return <div className="mx-auto max-w-7xl space-y-6 py-8 text-slate-800">
    <header><p className="text-xs font-bold uppercase tracking-widest text-teal-700">Private community workspace</p><h1 className="mt-2 text-3xl font-bold">Board review</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">Compare proposals, record the board’s decision, and keep a clear record of each award. Only authorized board members and managers can access this workspace.</p></header>
    {communities.length === 0 ? <section className={card}><h2 className="font-semibold">No board access</h2><p className="mt-2 text-sm">Ask your HOA manager for a board invitation, then accept it using your invited email address.</p></section> : <>
      <label className="block max-w-md text-sm font-semibold">Community<select className={field} value={communityId} onChange={e => setCommunityId(e.target.value)}>{communities.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      {community && <CommunityReview key={community.id} community={community} refresh={refresh} initialRequestId={initialRequestId} />}
    </>}
  </div>;
}

function CommunityReview({ community, refresh, initialRequestId }: { community: BoardCommunitySummary; refresh: () => Promise<void>; initialRequestId?: string }) {
  const [requestId, setRequestId] = useState(community.requests.find(item => item.id === initialRequestId)?.id ?? community.requests[0]?.id ?? "");
  return <div className="space-y-6">
    {community.canManage && <BoardSettings key={`${community.id}:${community.policy.version}`} community={community} refresh={refresh} />}
    {community.requests.length === 0 ? <p className={card}>No requests are available for board review yet.</p> : <>
      <label className="block max-w-xl text-sm font-semibold">Service request<select className={field} value={requestId} onChange={e => setRequestId(e.target.value)}>{community.requests.map(item => <option key={item.id} value={item.id}>{item.title} · {item.status.replaceAll("_", " ")}</option>)}</select></label>
      {requestId && <BoardRequestReview key={requestId} requestId={requestId} />}
    </>}
  </div>;
}

function BoardSettings({ community, refresh }: { community: BoardCommunitySummary; refresh: () => Promise<void> }) {
  const [rule, setRule] = useState<BoardRule>(community.policy.rule);
  const [quorumN, setQuorumN] = useState(community.policy.quorumN ?? 1);
  const [invitations, setInvitations] = useState<HoaInvitationSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const alive = useRef(true);
  const loadInvitations = useCallback(async (signal?: AbortSignal) => {
    const data = await requestJson<{ invitations: HoaInvitationSummary[] }>(`/api/board/communities/${community.id}/members`, "GET", undefined, signal);
    if (alive.current) setInvitations(data.invitations);
  }, [community.id]);
  useEffect(() => { alive.current = true; const controller = new AbortController(); void loadInvitations(controller.signal).catch(error => { if (!controller.signal.aborted) setError(error.message); }); return () => { alive.current = false; controller.abort(); }; }, [loadInvitations]);
  async function act(url: string, method: string, body?: unknown, message = "Saved.") {
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try { await requestJson(url, method, body); await loadInvitations(); if (alive.current) setNotice(message); await refresh(); }
    catch (error) { if (alive.current) setError(error instanceof Error ? error.message : "Could not save changes."); }
    finally { if (alive.current) setBusy(false); }
  }
  return <details className={card}><summary className="cursor-pointer font-semibold">Board members & approval policy</summary><div className="mt-5 grid gap-6 lg:grid-cols-2">
    <form onSubmit={event => { event.preventDefault(); void act(`/api/board/communities/${community.id}/policy`, "PUT", { rule, quorumN: rule === "board_quorum_n" ? quorumN : null, expectedVersion: community.policy.version }, "Approval policy saved. Open a fresh review if the previous policy changed."); }} className="space-y-3">
      <label className="block text-sm font-semibold">Approval rule<select className={field} value={rule} disabled={busy} onChange={e => setRule(e.target.value as BoardRule)}>{Object.entries(RULE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      {rule === "board_quorum_n" && <label className="block text-sm font-semibold">Required approvals per proposal<input className={field} type="number" min="1" max="100" required value={quorumN} disabled={busy} onChange={e => setQuorumN(e.target.valueAsNumber)} /></label>}
      <p className="text-xs leading-5 text-slate-600">Majority means more than half of all invited, active board members in the review. “At least N approvals” requires N affirmative votes on the same proposal. The manager confirms the final award after the rule is met.</p><button className={button} disabled={busy}>Save policy</button>
    </form>
    <form className="space-y-3" onSubmit={event => { event.preventDefault(); const data = new FormData(event.currentTarget); void act(`/api/board/communities/${community.id}/members`, "POST", { fullName: data.get("fullName"), email: data.get("email") }, "Board invitation sent."); }}>
      <label className="block text-sm font-semibold">Board member’s name<input className={field} name="fullName" required maxLength={120} disabled={busy} autoComplete="name" /></label>
      <label className="block text-sm font-semibold">Invitation email<input className={field} name="email" type="email" required maxLength={254} disabled={busy} autoComplete="email" /></label><button className={button} disabled={busy}>Invite board member</button><p className="text-xs text-slate-600">Board access preserves the person’s existing resident or provider account. It does not grant HOA management permissions.</p>
    </form>
    <div><h3 className="text-sm font-semibold">Active members</h3><ul className="mt-2 space-y-2">{community.members.filter(member => member.status === "active").map(member => <li key={member.id} className="flex flex-wrap items-center justify-between gap-2 text-sm"><span className="break-words">{member.name}</span><button className={secondary} disabled={busy} onClick={() => { if (window.confirm(`Remove board access for ${member.name}? Open reviews will need to be restarted.`)) void act(`/api/board/communities/${community.id}/members/${member.id}`, "DELETE"); }}>Remove access</button></li>)}</ul>{!community.members.some(member => member.status === "active") && <p className="mt-2 text-sm text-slate-500">No active board members.</p>}</div>
    <div><h3 className="text-sm font-semibold">Invitations</h3><ul className="mt-2 space-y-2">{invitations.map(invitation => <li key={invitation.id} className="flex flex-wrap items-center justify-between gap-2 text-sm"><span className="break-all">{invitation.email} · {invitation.status}</span>{invitation.status === "pending" && <button className={secondary} disabled={busy} onClick={() => void act(`/api/board/communities/${community.id}/invitations/${invitation.id}`, "DELETE")}>Revoke invitation</button>}</li>)}</ul></div>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}{notice && <p role="status" className="text-sm text-teal-800">{notice}</p>}
  </div></details>;
}

export function BoardRequestReview({ requestId }: { requestId: string }) {
  const [view, setView] = useState<BoardReviewView | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [deadline, setDeadline] = useState("");
  const generation = useRef(0);
  const alive = useRef(true);
  const load = useCallback(async (signal?: AbortSignal) => {
    const current = ++generation.current;
    const data = await requestJson<BoardReviewView>(`/api/board/requests/${requestId}`, "GET", undefined, signal);
    if (current === generation.current && !signal?.aborted) { setView(data); setSelected([]); }
  }, [requestId]);
  useEffect(() => { alive.current = true; setView(null); setError(""); const controller = new AbortController(); void load(controller.signal).catch(error => { if (!controller.signal.aborted) setError(error.message); }); return () => { alive.current = false; ++generation.current; controller.abort(); }; }, [load]);
  async function act(url: string, method: string, body?: unknown) {
    if (busy) return false;
    const current = generation.current;
    setBusy(true); setError("");
    try { await requestJson(url, method, body); if (!alive.current || current !== generation.current) return false; await load(); return alive.current; }
    catch (error) { if (alive.current) setError(error instanceof Error ? error.message : "This action failed."); return false; }
    finally { if (alive.current) setBusy(false); }
  }
  if (!view) return <section className={card}>{error ? <><p role="alert" className="text-red-700">{error}</p><button className={`${secondary} mt-3`} onClick={() => { setError(""); void load().catch(error => setError(error.message)); }}>Retry loading review</button></> : <p role="status">Loading board review…</p>}</section>;
  const openRound = view.rounds.find(round => round.status === "open");
  return <div className="space-y-5">
    <section className={card}><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-bold">{view.request.title}</h2><p className="mt-1 text-sm text-slate-600">{RULE_LABELS[view.policy.rule]} · {view.request.status.replaceAll("_", " ")}</p></div><span className="rounded-full bg-teal-50 px-3 py-1 text-xs font-semibold text-teal-900">{view.canManage ? "Manager" : "Board member"}</span></div>
      {view.canManage && !openRound && view.policy.rule !== "manager_only" && <form className="mt-6 space-y-4" onSubmit={event => { event.preventDefault(); if (!deadline || selected.length === 0) return; void act(`/api/board/requests/${requestId}/rounds`, "POST", { bidIds: selected, deadline: new Date(deadline).toISOString() }); }}>
        <p className="text-sm">Choose the proposals to send to the board. Opening a review fixes the proposal versions, voters, and approval rule for its audit record.</p>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{view.proposals.map(proposal => <label key={proposal.bidId} className="flex items-start gap-3 rounded-xl border border-slate-200 p-4"><input className="mt-1 h-5 w-5 shrink-0" type="checkbox" checked={selected.includes(proposal.bidId)} disabled={busy} onChange={e => setSelected(current => e.target.checked ? [...current, proposal.bidId] : current.filter(id => id !== proposal.bidId))} /><span className="min-w-0 break-words text-sm"><strong>{proposal.providerName}</strong><br />{money(proposal.amountCents, proposal.currency)} total · version {proposal.version}<br />{proposal.verified ? "Credentials verified" : "Verification required before award"}</span></label>)}</div>
        {!view.proposals.length && <p className="text-sm text-slate-500">No submitted proposals yet.</p>}
        <label className="block max-w-sm text-sm font-semibold">Voting deadline (your local time)<input className={field} type="datetime-local" value={deadline} required disabled={busy} onChange={e => setDeadline(e.target.value)} /></label><button className={button} disabled={busy || !selected.length}>Send shortlist to board</button>
      </form>}
      {view.policy.rule === "manager_only" && <p className="mt-4 text-sm text-slate-600">Board voting is not required by the current policy. The manager can review and award proposals in the HOA workspace.</p>}
    </section>
    {error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-800">{error}</p>}
    {view.rounds.map(round => <ReviewRound key={round.id} round={round} view={view} busy={busy} act={act} />)}
  </div>;
}

function ReviewRound({ round, view, busy, act }: { round: BoardRoundSummary; view: BoardReviewView; busy: boolean; act: (url: string, method: string, body?: unknown) => Promise<boolean> }) {
  const [comment, setComment] = useState("");
  const [voteComments, setVoteComments] = useState<Record<string, string>>({});
  const [confirmation, setConfirmation] = useState<BoardProposal | null>(null);
  const open = round.status === "open" && !round.stale && new Date(round.deadline).getTime() > Date.now();
  const voter = round.electorate.some(member => member.userId === view.viewerUserId);
  const prefix = `/api/board/requests/${view.request.id}/rounds/${round.id}`;
  return <section className={card}>
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-lg font-bold">Review opened {date(round.createdAt)}</h3><p className="mt-1 text-sm text-slate-600">{RULE_LABELS[round.rule]} · {round.threshold} approvals required · {round.electorate.length} voters</p><p className="text-sm text-slate-600">Voting closes {date(round.deadline)} · {round.status}</p></div><a className={secondary} href={`${prefix}/minutes`} download>Download minutes (PDF)</a></div>
    {round.stale && <p role="status" className="mt-4 rounded-xl bg-amber-50 p-4 text-sm text-amber-900">{round.staleReason || "The members, policy, or proposals changed. The manager must start a fresh review."}</p>}
    {view.canManage && round.status === "open" && <button className={`${secondary} mt-4`} disabled={busy} onClick={() => { if (window.confirm("Cancel this review? Its votes and comments will remain in the audit record.")) void act(`/api/board/rounds/${round.id}`, "DELETE"); }}>Cancel review</button>}
    <div className="mt-5 grid items-start gap-4 md:grid-cols-2 xl:grid-cols-3">{round.proposals.map(proposal => {
      const votes = round.votes.filter(vote => vote.bidId === proposal.bidId);
      const mine = votes.find(vote => vote.voterUserId === view.viewerUserId);
      const approvals = votes.filter(vote => vote.decision === "approve").length;
      return <article key={proposal.bidId} className="min-w-0 rounded-xl border border-slate-200 p-4">
        <ProposalDetails proposal={proposal} credentialPrefix={prefix} />
        <p className="mt-4 text-sm font-semibold">{approvals} of {round.threshold} approvals required</p><p className="mt-1 text-xs text-slate-600">{votes.filter(vote => vote.decision === "reject").length} rejected · {round.electorate.length - votes.length} awaiting response</p>
        <ul className="mt-3 space-y-2 text-xs text-slate-600">{votes.map(vote => <li key={vote.voterUserId} className="break-words"><strong>{vote.voterName}</strong>: {vote.decision === "approve" ? "Approved" : "Rejected"}{vote.comment && <p className="whitespace-pre-wrap">{vote.comment}</p>}</li>)}</ul>
        {voter && open && !mine && <label className="mt-4 block text-xs font-semibold">Vote explanation (optional)<textarea className={field} aria-label={`Vote explanation for ${proposal.providerName}`} value={voteComments[proposal.bidId] ?? ""} onChange={event => setVoteComments(current => ({ ...current, [proposal.bidId]: event.target.value }))} maxLength={2000} rows={2} disabled={busy} /></label>}
        {voter && open && !mine && <div className="mt-4 flex flex-wrap gap-2"><button className={button} disabled={busy} onClick={() => { if (window.confirm(`Record your approval of ${proposal.providerName}? Votes are permanent for this review.`)) void act(`/api/board/rounds/${round.id}/votes`, "PUT", { bidId: proposal.bidId, decision: "approve", ...(voteComments[proposal.bidId]?.trim() ? { comment: voteComments[proposal.bidId].trim() } : {}) }); }}>Approve proposal</button><button className={secondary} disabled={busy} onClick={() => { if (window.confirm(`Record your rejection of ${proposal.providerName}? Votes are permanent for this review.`)) void act(`/api/board/rounds/${round.id}/votes`, "PUT", { bidId: proposal.bidId, decision: "reject", ...(voteComments[proposal.bidId]?.trim() ? { comment: voteComments[proposal.bidId].trim() } : {}) }); }}>Reject proposal</button></div>}
        {mine && <p className="mt-3 text-sm text-teal-800">Your {mine.decision === "approve" ? "approval" : "rejection"} is recorded.</p>}
        {view.canManage && round.status === "open" && !round.stale && approvals >= round.threshold && <button className={`${button} mt-4`} disabled={busy} onClick={() => setConfirmation(proposal)}>Confirm award</button>}
        {round.awardedBidId === proposal.bidId && <p className="mt-4 font-bold text-teal-800">Awarded</p>}
      </article>;
    })}</div>
    {confirmation && <div role="region" aria-label="Confirm board-approved award" className="mt-5 rounded-xl border-2 border-teal-700 bg-teal-50 p-5"><h4 className="font-bold">Award to {confirmation.providerName}?</h4><p className="mt-2 text-sm">{money(confirmation.amountCents, confirmation.currency)} for the full service term, proposal version {confirmation.version}. Current credentials, pricing, and board approval will be checked again before the award is saved.</p><div className="mt-4 flex flex-wrap gap-2"><button className={button} disabled={busy} onClick={() => { void act(`/api/board/requests/${view.request.id}/award`, "POST", { bidId: confirmation.bidId, expectedBidVersion: confirmation.version }).then(saved => { if (saved) setConfirmation(null); }); }}>Confirm this award</button><button className={secondary} disabled={busy} onClick={() => setConfirmation(null)}>Keep reviewing</button></div></div>}
    <div className="mt-6 border-t border-slate-100 pt-5"><h4 className="font-semibold">Private board discussion</h4><p className="mt-1 text-xs text-slate-500">Visible to authorized board members and managers; included in the minutes.</p><p className="mt-2 text-xs text-slate-500">{round.commentCount} comments{round.commentsTruncated ? " · Showing the first 200. Download minutes for the complete discussion." : ""}</p><ul className="mt-4 space-y-3">{round.comments.map(item => <li key={item.id} className="rounded-xl bg-slate-50 p-3"><p className="text-xs font-semibold">{item.authorName} · {date(item.createdAt)}</p><p className="mt-1 whitespace-pre-wrap break-words text-sm">{item.body}</p></li>)}</ul>
      {open && <form className="mt-4" onSubmit={event => { event.preventDefault(); void act(`/api/board/rounds/${round.id}/comments`, "POST", { body: comment }).then(saved => { if (saved) setComment(""); }); }}><label className="block text-sm font-semibold">Add a comment<textarea className={field} value={comment} onChange={e => setComment(e.target.value)} maxLength={4000} required rows={3} disabled={busy} /></label><button className={`${button} mt-2`} disabled={busy || !comment.trim()}>Post comment</button></form>}
    </div>
  </section>;
}

function ProposalDetails({ proposal, credentialPrefix }: { proposal: BoardProposal; credentialPrefix: string }) {
  return <><h4 className="break-words text-lg font-bold">{proposal.providerName}</h4><details className="mt-2 text-sm"><summary className="cursor-pointer font-semibold text-teal-800">Provider profile</summary><div className="mt-2 space-y-2 text-slate-600"><p className="whitespace-pre-wrap break-words">{proposal.providerBio || "No business description provided."}</p>{proposal.businessStartedYear && <p>In business since {proposal.businessStartedYear} (provider-reported)</p>}{!!proposal.trades?.length && <p className="break-words">Services: {proposal.trades.join(", ")}</p>}<p className="text-xs">Profile details captured when this review opened.</p></div></details><p className="mt-1 text-xl font-bold text-teal-800">{money(proposal.amountCents, proposal.currency)}</p><p className="text-xs text-slate-500">Whole-job total · version {proposal.version}</p><dl className="mt-4 space-y-3 text-sm">
    {proposal.poolQuote && <><div><dt className="font-semibold">Monthly price per home</dt><dd>{Object.entries(proposal.poolQuote.monthlyCents).map(([tier, cents]) => <p key={tier}>{POOL_TIER_LABELS[tier as PoolTier]}: {money(cents as number, proposal.currency)}</p>)}</dd></div><div><dt className="font-semibold">Pool service terms</dt><dd>Chemicals {proposal.poolQuote.chemicalsIncluded ? "included" : "excluded"}; equipment repairs excluded. Route: {proposal.poolQuote.routeDay}. Cancellation notice: {proposal.poolQuote.cancellationNoticeDays} days.</dd></div></>}
    <div><dt className="font-semibold">Scope</dt><dd className="whitespace-pre-wrap break-words">{proposal.scope}</dd></div><div><dt className="font-semibold">Exclusions</dt><dd className="whitespace-pre-wrap break-words">{proposal.exclusions || "None stated"}</dd></div>
    <div><dt className="font-semibold">Earliest start</dt><dd>{date(proposal.startDate)}</dd></div><div><dt className="font-semibold">Quote expires</dt><dd>{date(proposal.validUntil)}</dd></div>
    <div><dt className="font-semibold">Verification</dt><dd>{proposal.verified ? "Credentials verified when review opened" : "Verification required before award"}</dd></div><div><dt className="font-semibold">Rating</dt><dd>{proposal.rating === null ? "No rating yet" : `${proposal.rating.toFixed(1)} / 5`} · {proposal.reviewCount} reviews</dd></div>
    <div><dt className="font-semibold">Insurance</dt><dd>{proposal.insuranceCoverageCents === null ? "Coverage not verified" : `${money(proposal.insuranceCoverageCents)} coverage`}<br />Expires: {dateOnly(proposal.insuranceExpiresAt)}</dd></div>
  </dl><div className="mt-3 flex flex-wrap gap-3 text-sm font-semibold text-teal-800">{proposal.licenseDocumentId && <a className="underline" href={`${credentialPrefix}/credentials/${proposal.licenseDocumentId}`} download>License document</a>}{proposal.insuranceDocumentId && <a className="underline" href={`${credentialPrefix}/credentials/${proposal.insuranceDocumentId}`} download>Insurance document</a>}</div></>;
}
