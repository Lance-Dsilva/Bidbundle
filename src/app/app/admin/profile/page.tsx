import Link from "next/link";

import {
  AdminEmptyState,
  formatDateTime,
  PersonLine,
  SectionCard,
  StatusPill,
} from "@/components/admin/AdminPrimitives";
import { AppPageHeader } from "@/components/layout/AppPageHeader";
import { AdminSignOutButton } from "@/components/admin/AdminSignOutButton";
import { serializeAuditEntry } from "@/lib/server/audit";
import { requireRole } from "@/lib/server/auth";
import { auditSelect, toPersonSummary } from "@/lib/server/communities";
import { db } from "@/lib/server/db";

export const dynamic = "force-dynamic";

/**
 * The signed-in staff member's own record.
 *
 * There are no settings here to change. An admin account is provisioned
 * privately — `PUBLIC_ROLES` has no `admin` member, so sign-up cannot produce
 * one — and nothing about that provisioning should be editable from inside the
 * portal it grants access to.
 */
export default async function AdminProfilePage() {
  const user = await requireRole(["admin"], "/app/admin/profile");

  const [record, myRecentActions] = await Promise.all([
    db.user.findUnique({
      where: { id: user.id },
      select: { id: true, fullName: true, email: true, role: true, avatarUrl: true, createdAt: true },
    }),
    db.adminAuditLog.findMany({
      where: { actorUserId: user.id },
      select: auditSelect,
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
  ]);

  if (!record) {
    return (
      <div className="mx-auto max-w-lg px-4 py-10">
        <AdminEmptyState
          title="Profile unavailable"
          body="This account no longer has a Bundleen record. Sign out and back in."
        />
      </div>
    );
  }

  const person = toPersonSummary(record);
  const entries = myRecentActions.map((row) => serializeAuditEntry(row, toPersonSummary));

  return (
    <div className="flex flex-col">
      <AppPageHeader title="Your staff account" subtitle="Bundleen internal portal" />

      <div className="mx-auto w-full max-w-3xl space-y-5 px-4 py-7 pb-24">
        <SectionCard
          title="Account"
          action={<StatusPill label="Bundleen admin" tone="info" withDot={false} />}
        >
          <PersonLine
            person={person}
            size={48}
            meta={
              <>
                {record.email} · staff since {formatDateTime(record.createdAt.toISOString())}
              </>
            }
          />
          <p className="mt-4 text-[12px]" style={{ color: "var(--muted)" }}>
            Admin access is granted directly in the database and cannot be obtained through public
            sign-up. Community responsibilities are separate scoped records and are never held on a
            staff account.
          </p>
        </SectionCard>

        <SectionCard
          title="Your recent actions"
          subtitle="Everything you changed, as recorded in the append-only audit log"
          action={
            <Link href="/app/admin/audit" className="text-[12px] font-semibold" style={{ color: "var(--teal-800)" }}>
              Full log →
            </Link>
          }
        >
          {entries.length === 0 ? (
            <AdminEmptyState
              title="No actions recorded"
              body="Changes you make in this portal will be listed here."
            />
          ) : (
            <ul className="space-y-2">
              {entries.map((entry) => (
                <li key={entry.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[13px]" style={{ color: "var(--ink-900)" }}>
                    You {entry.summary}
                    {entry.communityName ? ` · ${entry.communityName}` : ""}
                  </span>
                  <time className="text-[11px]" style={{ color: "var(--muted)" }}>
                    {formatDateTime(entry.createdAt)}
                  </time>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <AdminSignOutButton />
      </div>
    </div>
  );
}
