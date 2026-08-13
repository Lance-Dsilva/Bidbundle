import Link from "next/link";

import {
  AdminEmptyState,
  formatDateTime,
  PersonLine,
  StatusPill,
} from "@/components/admin/AdminPrimitives";
import { AppPageHeader } from "@/components/layout/AppPageHeader";
import { serializeAuditEntry } from "@/lib/server/audit";
import { requireRole } from "@/lib/server/auth";
import { auditSelect, toPersonSummary } from "@/lib/server/communities";
import { db } from "@/lib/server/db";
import { auditListQuerySchema, searchParamsToObject } from "@/lib/validation/community";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * The admin audit log.
 *
 * Read-only in the strongest sense available: the table has no update or
 * delete path in the application, and a database trigger rejects both, so what
 * is shown here is what happened.
 */
export default async function AdminAuditPage({ searchParams }: PageProps) {
  await requireRole(["admin"], "/app/admin/audit");

  const resolved = await searchParams;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(resolved)) {
    if (typeof value === "string") params.set(key, value);
  }

  const query = auditListQuerySchema.parse(searchParamsToObject(params));

  const where = {
    ...(query.communityId ? { communityId: query.communityId } : {}),
    ...(query.providerUserId ? { providerUserId: query.providerUserId } : {}),
  };

  const [total, rows] = await Promise.all([
    db.adminAuditLog.count({ where }),
    db.adminAuditLog.findMany({
      where,
      select: auditSelect,
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);

  const entries = rows.map((row) => serializeAuditEntry(row, toPersonSummary));
  const lastPage = Math.max(1, Math.ceil(total / query.pageSize));

  function pageHref(page: number): string {
    const next = new URLSearchParams(params);
    next.set("page", String(page));
    return `/app/admin/audit?${next.toString()}`;
  }

  return (
    <div className="flex flex-col">
      <AppPageHeader
        title="Audit log"
        subtitle={`${total} recorded action${total === 1 ? "" : "s"} · append-only`}
      />

      <div className="mx-auto w-full max-w-5xl space-y-4 px-4 py-7 pb-24">
        {entries.length === 0 ? (
          <AdminEmptyState
            title="Nothing recorded yet"
            body="Community edits, membership changes, role assignments, and provider status changes all appear here."
          />
        ) : (
          <ul className="space-y-2">
            {entries.map((entry) => (
              <li
                key={entry.id}
                className="rounded-2xl border p-4"
                style={{ background: "var(--paper)", borderColor: "var(--line)" }}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  {entry.actor ? (
                    <PersonLine person={entry.actor} size={32} meta={entry.summary} />
                  ) : (
                    <span className="text-[13px]" style={{ color: "var(--ink-900)" }}>
                      {entry.summary}
                    </span>
                  )}

                  <div className="flex flex-wrap items-center gap-2">
                    {entry.communityName && (
                      <Link href={`/app/admin/communities/${entry.communityId}`}>
                        <StatusPill label={entry.communityName} tone="info" withDot={false} />
                      </Link>
                    )}
                    {entry.providerUserId && (
                      <Link href={`/app/admin/providers/${entry.providerUserId}`}>
                        <StatusPill label="Provider" tone="neutral" withDot={false} />
                      </Link>
                    )}
                    <time className="text-[11px]" style={{ color: "var(--muted)" }}>
                      {formatDateTime(entry.createdAt)}
                    </time>
                  </div>
                </div>

                {entry.metadata && Object.keys(entry.metadata).length > 0 && (
                  <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1 border-t pt-3" style={{ borderColor: "var(--line)" }}>
                    {Object.entries(entry.metadata).map(([key, value]) => (
                      <div key={key} className="text-[11px]">
                        <dt className="inline" style={{ color: "var(--muted)" }}>
                          {key}:{" "}
                        </dt>
                        <dd className="inline" style={{ color: "var(--ink-700)" }}>
                          {value === null ? "—" : String(value)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}
              </li>
            ))}
          </ul>
        )}

        {lastPage > 1 && (
          <nav className="flex items-center justify-between" aria-label="Audit log pages">
            {query.page > 1 ? (
              <Link href={pageHref(query.page - 1)} className="text-[12px] font-semibold" style={{ color: "var(--teal-800)" }}>
                ← Newer
              </Link>
            ) : (
              <span />
            )}
            <span className="text-[12px]" style={{ color: "var(--muted)" }}>
              Page {query.page} of {lastPage}
            </span>
            {query.page < lastPage ? (
              <Link href={pageHref(query.page + 1)} className="text-[12px] font-semibold" style={{ color: "var(--teal-800)" }}>
                Older →
              </Link>
            ) : (
              <span />
            )}
          </nav>
        )}
      </div>
    </div>
  );
}
