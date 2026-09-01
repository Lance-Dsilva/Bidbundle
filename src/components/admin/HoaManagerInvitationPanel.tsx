"use client";

import { FormEvent, useEffect, useState } from "react";

import {
  AdminRequestError,
  fetchHoaManagerInvitations,
  revokeHoaManagerInvitation,
  sendHoaManagerInvitation,
} from "@/lib/admin-client";
import type { HoaInvitationSummary } from "@/lib/hoa-types";

type StaffRole = "hoa_manager" | "hoa_team";

function roleLabel(role: HoaInvitationSummary["role"]): string {
  return role === "hoa_manager" ? "HOA manager" : role === "hoa_team" ? "HOA team" : "Resident";
}

export function HoaManagerInvitationPanel({
  communityId,
  hasManager,
}: {
  communityId: string;
  hasManager: boolean;
}) {
  const [invitations, setInvitations] = useState<HoaInvitationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [role, setRole] = useState<StaffRole>(hasManager ? "hoa_team" : "hoa_manager");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (hasManager) setRole("hoa_team");
  }, [hasManager]);

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
    const data = new FormData(form);
    const fullName = String(data.get("fullName") ?? "");
    const email = String(data.get("email") ?? "");
    setSending(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await sendHoaManagerInvitation(communityId, fullName, email, role);
      setInvitations((current) => [
        result.invitation,
        ...current.filter((item) => item.id !== result.invitation.id),
      ]);
      form.reset();
      setRole(hasManager ? "hoa_team" : "hoa_manager");
      setSuccess(
        `${roleLabel(result.invitation.role)} invitation sent. The recipient can create a separate account from the email link.`,
      );
    } catch (caught) {
      setError(caught instanceof AdminRequestError ? caught.message : "Could not send the invitation.");
    } finally {
      setSending(false);
    }
  };

  const revoke = async (item: HoaInvitationSummary) => {
    setSending(true);
    setError(null);
    setSuccess(null);
    try {
      await revokeHoaManagerInvitation(communityId, item.id);
      setInvitations((current) =>
        current.map((entry) =>
          entry.id === item.id ? { ...entry, status: "revoked" as const } : entry,
        ),
      );
      setSuccess(`${roleLabel(item.role)} invitation revoked.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not revoke the invitation.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      className="mt-5 rounded-xl border p-4"
      style={{ borderColor: "var(--line)", background: "var(--canvas)" }}
    >
      <h3 className="text-sm font-semibold" style={{ color: "var(--ink-900)" }}>
        Invite HOA manager or team
      </h3>
      <p className="mt-1 text-xs leading-5" style={{ color: "var(--muted)" }}>
        Enter the staff member&rsquo;s name and email. They do not need a homeowner account or
        a home in this HOA; the invitation creates a separate, HOA-scoped staff identity.
      </p>
      <form className="mt-3 grid gap-2 md:grid-cols-[1fr_1fr_180px_auto]" onSubmit={submit}>
        <input
          className="h-10 rounded-xl border px-3 text-sm outline-none"
          style={{ borderColor: "var(--line)", background: "var(--paper)" }}
          name="fullName"
          type="text"
          autoComplete="name"
          maxLength={120}
          placeholder="Full name"
          required
        />
        <input
          className="h-10 rounded-xl border px-3 text-sm outline-none"
          style={{ borderColor: "var(--line)", background: "var(--paper)" }}
          name="email"
          type="email"
          autoComplete="email"
          maxLength={254}
          placeholder="person@hoa.org"
          required
        />
        <select
          aria-label="HOA staff role"
          className="h-10 rounded-xl border px-3 text-sm outline-none"
          style={{ borderColor: "var(--line)", background: "var(--paper)" }}
          value={role}
          onChange={(event) => setRole(event.currentTarget.value as StaffRole)}
        >
          {!hasManager ? <option value="hoa_manager">HOA manager</option> : null}
          <option value="hoa_team">HOA team</option>
        </select>
        <button
          className="h-10 rounded-xl px-4 text-sm font-semibold text-white disabled:opacity-60"
          style={{ background: "var(--teal-800)" }}
          disabled={sending}
          type="submit"
        >
          {sending ? "Sending…" : "Send invite"}
        </button>
      </form>
      {error ? <p className="mt-2 text-xs font-medium text-red-600" role="alert">{error}</p> : null}
      {success ? <p className="mt-2 text-xs font-medium text-green-700" role="status">{success}</p> : null}
      <div className="mt-4">
        <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
          Staff invitation history
        </p>
        {loading ? (
          <p className="mt-2 text-xs" style={{ color: "var(--muted)" }}>Loading…</p>
        ) : invitations.length === 0 ? (
          <p className="mt-2 text-xs" style={{ color: "var(--muted)" }}>No staff invitation sent yet.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {invitations.map((item) => (
              <li className="flex flex-wrap items-center justify-between gap-3 text-xs" key={item.id}>
                <span className="min-w-0" style={{ color: "var(--ink-700)" }}>
                  <strong className="block truncate" style={{ color: "var(--ink-900)" }}>
                    {item.inviteeName || item.email}
                  </strong>
                  <span className="block truncate">{item.email} · {roleLabel(item.role)}</span>
                </span>
                <span className="flex items-center gap-2">
                  <strong
                    className="uppercase"
                    style={{ color: item.status === "accepted" ? "var(--teal-800)" : item.status === "revoked" ? "var(--danger-600)" : "var(--gold-600)" }}
                  >
                    {item.status}
                  </strong>
                  {item.status === "pending" ? (
                    <button
                      className="font-semibold text-red-600"
                      disabled={sending}
                      onClick={() => void revoke(item)}
                      type="button"
                    >
                      Revoke
                    </button>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
