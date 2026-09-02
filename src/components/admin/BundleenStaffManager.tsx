"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { AdminEmptyState, StatusPill } from "@/components/admin/AdminPrimitives";
import type { AdminAccessSummary } from "@/lib/admin-access";

type ErrorBody = { error?: string; fields?: Record<string, string> };

export function BundleenStaffManager({ initialStaff }: { initialStaff: AdminAccessSummary[] }) {
  const router = useRouter();
  const [staff, setStaff] = useState(initialStaff);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function invite(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("invite");
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/admin/staff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullName, email }),
      });
      const body = (await response.json().catch(() => ({}))) as ErrorBody & {
        staff?: AdminAccessSummary;
      };
      if (!response.ok || !body.staff) {
        throw new Error(
          body.fields?.fullName ?? body.fields?.email ?? body.error ?? "Could not invite staff.",
        );
      }
      setStaff((current) => [body.staff!, ...current.filter((item) => item.id !== body.staff!.id)]);
      setFullName("");
      setEmail("");
      setNotice("Staff invitation sent. Portal access activates only after the invited email is verified.");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not invite staff.");
    } finally {
      setBusy(null);
    }
  }

  async function revoke(item: AdminAccessSummary) {
    if (!window.confirm(`${item.status === "pending" ? "Revoke the invitation for" : "Remove staff access from"} ${item.email}?`)) return;
    setBusy(item.id);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/admin/staff/${encodeURIComponent(item.id)}`, {
        method: "DELETE",
      });
      const body = (await response.json().catch(() => ({}))) as ErrorBody & {
        staff?: AdminAccessSummary;
      };
      if (!response.ok || !body.staff) throw new Error(body.error ?? "Could not remove staff access.");
      setStaff((current) => current.map((row) => row.id === body.staff!.id ? body.staff! : row));
      setNotice(item.status === "pending" ? `Invitation revoked for ${item.email}.` : `Staff access removed from ${item.email}.`);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not remove staff access.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5">
      <form className="space-y-3" onSubmit={invite}>
        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <input
            aria-label="Staff member full name"
            autoComplete="name"
            className="min-h-11 rounded-xl border px-3 text-[14px] outline-none focus:ring-2"
            maxLength={120}
            onChange={(event) => setFullName(event.currentTarget.value)}
            placeholder="Full name"
            required
            style={{ borderColor: "var(--line)", background: "var(--paper)", color: "var(--ink-900)" }}
            value={fullName}
          />
          <input
            aria-label="Staff member email"
            autoComplete="email"
            className="min-h-11 rounded-xl border px-3 text-[14px] outline-none focus:ring-2"
            maxLength={254}
            onChange={(event) => setEmail(event.currentTarget.value)}
            placeholder="staff@bundleen.com"
            required
            style={{ borderColor: "var(--line)", background: "var(--paper)", color: "var(--ink-900)" }}
            type="email"
            value={email}
          />
          <button className="min-h-11 rounded-xl px-5 text-[13px] font-semibold text-white disabled:opacity-60" disabled={busy !== null} style={{ background: "var(--teal-800)" }} type="submit">
            {busy === "invite" ? "Sending…" : "Invite staff"}
          </button>
        </div>
        <p className="text-[11px] leading-4" style={{ color: "var(--muted)" }}>
          Staff receive a separate internal account with the standard operations workspace. They cannot open Admin access or grant permissions.
        </p>
      </form>

      {error ? <p className="rounded-xl bg-red-50 px-3 py-2 text-[12px] text-red-700" role="alert">{error}</p> : null}
      {notice ? <p className="rounded-xl px-3 py-2 text-[12px]" role="status" style={{ background: "var(--teal-50)", color: "var(--teal-800)" }}>{notice}</p> : null}

      {staff.length === 0 ? (
        <AdminEmptyState title="No Bundleen staff yet" body="Invite an operations team member using their own work email." />
      ) : (
        <ul className="divide-y" style={{ borderColor: "var(--line)" }}>
          {staff.map((item) => (
            <li className="flex flex-wrap items-center justify-between gap-3 py-3" key={item.id}>
              <div className="min-w-0">
                <p className="truncate text-[13px] font-semibold" style={{ color: "var(--ink-900)" }}>{item.fullName || item.email}</p>
                <p className="truncate text-[11px]" style={{ color: "var(--muted)" }}>{item.email}{item.grantedByName ? ` · invited by ${item.grantedByName}` : ""}</p>
                {item.status === "pending" && item.invitationExpiresAt ? <p className="mt-0.5 text-[10px]" style={{ color: "var(--muted)" }}>Invitation expires {new Date(item.invitationExpiresAt).toLocaleDateString()}</p> : null}
              </div>
              <div className="flex items-center gap-2">
                <StatusPill label={item.status[0].toUpperCase() + item.status.slice(1)} tone={item.status === "active" ? "positive" : item.status === "revoked" ? "danger" : "warning"} />
                {item.status !== "revoked" ? <button className="rounded-lg border px-3 py-1.5 text-[11px] font-semibold disabled:opacity-60" disabled={busy !== null} onClick={() => void revoke(item)} style={{ borderColor: "var(--line)", color: "var(--danger-600)" }} type="button">{busy === item.id ? "Updating…" : item.status === "pending" ? "Revoke invitation" : "Remove"}</button> : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
