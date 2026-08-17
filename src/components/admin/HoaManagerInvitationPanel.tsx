"use client";

import { FormEvent, useEffect, useState } from "react";

import {
  AdminRequestError,
  fetchHoaManagerInvitations,
  revokeHoaManagerInvitation,
  sendHoaManagerInvitation,
} from "@/lib/admin-client";
import type { HoaInvitationSummary } from "@/lib/hoa-types";

export function HoaManagerInvitationPanel({ communityId }: { communityId: string }) {
  const [invitations, setInvitations] = useState<HoaInvitationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void fetchHoaManagerInvitations(communityId)
      .then((result) => {
        if (active) setInvitations(result.invitations);
      })
      .catch((caught) => {
        if (active) setError(caught instanceof Error ? caught.message : "Could not load invitations.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [communityId]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const email = String(new FormData(form).get("email") ?? "");
    setSending(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await sendHoaManagerInvitation(communityId, email);
      setInvitations((current) => [result.invitation, ...current.filter((item) => item.id !== result.invitation.id)]);
      form.reset();
      setSuccess("Manager invitation sent. The account will receive HOA access only after Clerk verifies that email.");
    } catch (caught) {
      setError(caught instanceof AdminRequestError ? caught.message : "Could not send the invitation.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="mt-5 rounded-xl border p-4" style={{ borderColor: "var(--line)", background: "var(--canvas)" }}>
      <h3 className="text-sm font-semibold" style={{ color: "var(--ink-900)" }}>Invite the HOA manager</h3>
      <p className="mt-1 text-xs leading-5" style={{ color: "var(--muted)" }}>
        This creates a separate, invitation-only manager account. Public signup cannot grant HOA manager access.
      </p>
      <form className="mt-3 flex flex-col gap-2 sm:flex-row" onSubmit={submit}>
        <input className="h-10 flex-1 rounded-xl border px-3 text-sm outline-none" style={{ borderColor: "var(--line)", background: "var(--paper)" }} name="email" type="email" placeholder="manager@hoa.org" required />
        <button className="h-10 rounded-xl px-4 text-sm font-semibold text-white disabled:opacity-60" style={{ background: "var(--teal-800)" }} disabled={sending} type="submit">
          {sending ? "Sending…" : "Send manager invite"}
        </button>
      </form>
      {error ? <p className="mt-2 text-xs font-medium text-red-600" role="alert">{error}</p> : null}
      {success ? <p className="mt-2 text-xs font-medium text-green-700" role="status">{success}</p> : null}
      <div className="mt-4">
        <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--muted)" }}>Invitation history</p>
        {loading ? <p className="mt-2 text-xs" style={{ color: "var(--muted)" }}>Loading…</p> : invitations.length === 0 ? <p className="mt-2 text-xs" style={{ color: "var(--muted)" }}>No manager invitation sent yet.</p> : (
          <ul className="mt-2 space-y-2">
            {invitations.map((item) => <li className="flex items-center justify-between gap-3 text-xs" key={item.id}><span className="truncate" style={{ color: "var(--ink-700)" }}>{item.email}</span><span className="flex items-center gap-2"><strong className="uppercase" style={{ color: item.status === "accepted" ? "var(--teal-800)" : "var(--gold-600)" }}>{item.status}</strong>{item.status === "pending" ? <button className="font-semibold text-red-600" disabled={sending} onClick={() => void (async () => { setSending(true); setError(null); try { await revokeHoaManagerInvitation(communityId, item.id); setInvitations((current) => current.map((entry) => entry.id === item.id ? { ...entry, status: "revoked" } : entry)); setSuccess("Manager invitation revoked."); } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not revoke the invitation."); } finally { setSending(false); } })()} type="button">Revoke</button> : null}</span></li>)}
          </ul>
        )}
      </div>
    </div>
  );
}
