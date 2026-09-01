"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { StatusPill } from "@/components/admin/AdminPrimitives";
import type { AdminAccessSummary } from "@/lib/admin-access";
import {
  ADMIN_PERMISSIONS,
  ADMIN_PERMISSION_DESCRIPTIONS,
  ADMIN_PERMISSION_LABELS,
  type AdminPermission,
} from "@/lib/admin-permissions";

type ErrorBody = { error?: string; fields?: Record<string, string> };

export function AdminAccessManager({ initialAccess }: { initialAccess: AdminAccessSummary[] }) {
  const router = useRouter();
  const [access, setAccess] = useState(initialAccess);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function grant(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("grant");
    setError(null);
    setNotice(null);

    try {
      const response = await fetch("/api/admin/access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullName, email }),
      });
      const body = (await response.json().catch(() => ({}))) as ErrorBody & {
        access?: AdminAccessSummary;
      };
      if (!response.ok || !body.access) {
        throw new Error(
          body.fields?.fullName ?? body.fields?.email ?? body.error ?? "Could not send admin invitation.",
        );
      }

      setAccess((current) => {
        const remaining = current.filter((item) => item.id !== body.access!.id);
        return [...remaining, body.access!].sort((a, b) =>
          a.level === b.level ? a.grantedAt.localeCompare(b.grantedAt) : a.level === "owner" ? -1 : 1,
        );
      });
      setFullName("");
      setEmail("");
      setNotice("Admin invitation sent. Access activates after the recipient creates and verifies the invited account.");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not grant admin access.");
    } finally {
      setBusy(null);
    }
  }

  async function revoke(item: AdminAccessSummary) {
    if (!window.confirm(`${item.status === "pending" ? "Revoke the invitation for" : "Remove admin access from"} ${item.email}?`)) return;
    setBusy(item.id);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch(`/api/admin/access/${encodeURIComponent(item.id)}`, {
        method: "DELETE",
      });
      const body = (await response.json().catch(() => ({}))) as ErrorBody & {
        access?: AdminAccessSummary;
      };
      if (!response.ok || !body.access) {
        throw new Error(body.error ?? "Could not revoke admin access.");
      }
      setAccess((current) =>
        current.map((row) => (row.id === body.access!.id ? body.access! : row)),
      );
      setNotice(item.status === "pending" ? `Invitation revoked for ${item.email}.` : `Admin access removed from ${item.email}.`);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not revoke admin access.");
    } finally {
      setBusy(null);
    }
  }

  /**
   * Replaces the whole permission set for one grant.
   *
   * Absolute rather than a delta, matching the server: the checkboxes on screen
   * are the complete statement of what that admin may do, so submitting them
   * should mean exactly that.
   */
  async function togglePermission(item: AdminAccessSummary, permission: AdminPermission) {
    const next = item.permissions.includes(permission)
      ? item.permissions.filter((value) => value !== permission)
      : [...item.permissions, permission];

    setBusy(item.id);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch(
        `/api/admin/access/${encodeURIComponent(item.id)}/permissions`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ permissions: next }),
        },
      );
      const body = (await response.json().catch(() => ({}))) as ErrorBody & {
        access?: AdminAccessSummary;
      };
      if (!response.ok || !body.access) {
        throw new Error(body.error ?? "Could not update permissions.");
      }
      setAccess((current) =>
        current.map((row) => (row.id === body.access!.id ? body.access! : row)),
      );
      setNotice(`Permissions updated for ${item.email}.`);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update permissions.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5">
      <form onSubmit={grant} className="space-y-3">
        <div>
          <label htmlFor="admin-access-name" className="mb-1.5 block text-[12px] font-semibold" style={{ color: "var(--ink-900)" }}>
            Invite a Bundleen administrator
          </label>
          <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <input
              id="admin-access-name"
              type="text"
              autoComplete="name"
              required
              maxLength={120}
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              placeholder="Full name"
              className="min-h-11 rounded-xl border px-3 text-[14px] outline-none focus:ring-2"
              style={{ borderColor: "var(--line)", background: "var(--paper)", color: "var(--ink-900)" }}
            />
            <input
              id="admin-access-email"
              type="email"
              autoComplete="email"
              required
              maxLength={254}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="person@example.com"
              className="min-h-11 flex-1 rounded-xl border px-3 text-[14px] outline-none focus:ring-2"
              style={{ borderColor: "var(--line)", background: "var(--paper)", color: "var(--ink-900)" }}
            />
            <button
              type="submit"
              disabled={busy !== null}
              className="min-h-11 rounded-xl px-5 text-[13px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
              style={{ background: "var(--teal-800)" }}
            >
              {busy === "grant" ? "Sending…" : "Send invitation"}
            </button>
          </div>
          <p className="mt-1.5 text-[11px]" style={{ color: "var(--muted)" }}>
            The recipient does not need a homeowner or provider account. The email link creates a separate internal staff identity; pending invitations have no portal access.
          </p>
        </div>
      </form>

      {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-[12px] text-red-700">{error}</p>}
      {notice && <p role="status" className="rounded-xl px-3 py-2 text-[12px]" style={{ background: "var(--teal-50)", color: "var(--teal-800)" }}>{notice}</p>}

      <ul className="divide-y" style={{ borderColor: "var(--line)" }}>
        {access.map((item) => (
          <li key={item.id} className="py-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-[13px] font-semibold" style={{ color: "var(--ink-900)" }}>
                  {item.fullName || item.email}
                </p>
                <p className="truncate text-[11px]" style={{ color: "var(--muted)" }}>
                  {item.email}{item.grantedByName ? ` · granted by ${item.grantedByName}` : ""}
                </p>
                {item.status === "pending" && item.invitationExpiresAt ? (
                  <p className="mt-0.5 text-[10px]" style={{ color: "var(--muted)" }}>
                    Invitation expires {new Date(item.invitationExpiresAt).toLocaleDateString()}
                  </p>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                <StatusPill label={item.level === "owner" ? "Primary owner" : item.status[0].toUpperCase() + item.status.slice(1)} tone={item.status === "active" ? "positive" : item.status === "revoked" ? "danger" : "warning"} />
                {item.level !== "owner" && item.status !== "revoked" && (
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => revoke(item)}
                    className="rounded-lg border px-3 py-1.5 text-[11px] font-semibold disabled:opacity-60"
                    style={{ borderColor: "var(--line)", color: "var(--danger-600)" }}
                  >
                    {busy === item.id ? "Updating…" : item.status === "pending" ? "Revoke invitation" : "Remove"}
                  </button>
                )}
              </div>
            </div>

            {/* High-impact capabilities are opt-in per admin. The owner holds
                them implicitly, so their row shows the fact rather than a
                checkbox that could be unticked. */}
            {item.status === "active" ? (
              <div className="mt-2.5 rounded-xl px-3 py-2.5" style={{ background: "var(--cream-50)" }}>
                <p className="text-[10px] font-bold uppercase tracking-[0.12em]" style={{ color: "var(--muted)" }}>
                  Extra permissions
                </p>
                {item.level === "owner" ? (
                  <p className="mt-1 text-[11px]" style={{ color: "var(--muted)" }}>
                    The primary owner holds every permission, including global email delivery.
                  </p>
                ) : (
                  <div className="mt-2 space-y-2">
                    {ADMIN_PERMISSIONS.map((permission) => (
                      <label key={permission} className="flex items-start gap-2.5">
                        <input
                          type="checkbox"
                          className="mt-0.5 h-4 w-4"
                          disabled={busy !== null}
                          checked={item.permissions.includes(permission)}
                          onChange={() => void togglePermission(item, permission)}
                        />
                        <span className="min-w-0">
                          <span className="block text-[12px] font-semibold" style={{ color: "var(--ink-900)" }}>
                            {ADMIN_PERMISSION_LABELS[permission]}
                          </span>
                          <span className="block text-[11px] leading-4" style={{ color: "var(--muted)" }}>
                            {ADMIN_PERMISSION_DESCRIPTIONS[permission]}
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
