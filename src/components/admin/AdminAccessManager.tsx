"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { StatusPill } from "@/components/admin/AdminPrimitives";
import type { AdminAccessSummary } from "@/lib/admin-access";

type ErrorBody = { error?: string; fields?: Record<string, string> };

export function AdminAccessManager({ initialAccess }: { initialAccess: AdminAccessSummary[] }) {
  const router = useRouter();
  const [access, setAccess] = useState(initialAccess);
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
        body: JSON.stringify({ email }),
      });
      const body = (await response.json().catch(() => ({}))) as ErrorBody & {
        access?: AdminAccessSummary;
      };
      if (!response.ok || !body.access) {
        throw new Error(body.fields?.email ?? body.error ?? "Could not grant admin access.");
      }

      setAccess((current) => {
        const remaining = current.filter((item) => item.id !== body.access!.id);
        return [...remaining, body.access!].sort((a, b) =>
          a.level === b.level ? a.grantedAt.localeCompare(b.grantedAt) : a.level === "owner" ? -1 : 1,
        );
      });
      setEmail("");
      setNotice("Admin access granted. The user can now sign in with that existing Clerk account.");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not grant admin access.");
    } finally {
      setBusy(null);
    }
  }

  async function revoke(item: AdminAccessSummary) {
    if (!window.confirm(`Remove admin access from ${item.email}?`)) return;
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
      setNotice(`Admin access removed from ${item.email}.`);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not revoke admin access.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5">
      <form onSubmit={grant} className="space-y-3">
        <div>
          <label htmlFor="admin-access-email" className="mb-1.5 block text-[12px] font-semibold" style={{ color: "var(--ink-900)" }}>
            Existing Bundleen account email
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
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
              {busy === "grant" ? "Granting…" : "Grant admin access"}
            </button>
          </div>
          <p className="mt-1.5 text-[11px]" style={{ color: "var(--muted)" }}>
            For safety, the email must already have a verified Clerk and Bundleen account. This does not create credentials.
          </p>
        </div>
      </form>

      {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-[12px] text-red-700">{error}</p>}
      {notice && <p role="status" className="rounded-xl px-3 py-2 text-[12px]" style={{ background: "var(--teal-50)", color: "var(--teal-800)" }}>{notice}</p>}

      <ul className="divide-y" style={{ borderColor: "var(--line)" }}>
        {access.map((item) => (
          <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div className="min-w-0">
              <p className="truncate text-[13px] font-semibold" style={{ color: "var(--ink-900)" }}>
                {item.fullName || item.email}
              </p>
              <p className="truncate text-[11px]" style={{ color: "var(--muted)" }}>
                {item.email}{item.grantedByName ? ` · granted by ${item.grantedByName}` : ""}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <StatusPill label={item.level === "owner" ? "Primary owner" : item.status[0].toUpperCase() + item.status.slice(1)} tone={item.status === "active" ? "positive" : item.status === "revoked" ? "danger" : "warning"} />
              {item.level !== "owner" && item.status === "active" && (
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => revoke(item)}
                  className="rounded-lg border px-3 py-1.5 text-[11px] font-semibold disabled:opacity-60"
                  style={{ borderColor: "var(--line)", color: "var(--danger-600)" }}
                >
                  {busy === item.id ? "Removing…" : "Remove"}
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

