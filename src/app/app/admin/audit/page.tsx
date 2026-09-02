import Link from "next/link";
import type { ReactNode } from "react";

import { Icon } from "@/components/ui/Icon";
import { serializeAuditEntry } from "@/lib/server/audit";
import { buildAuditWhere } from "@/lib/server/audit-query";
import { requireRole } from "@/lib/server/auth";
import { auditSelect, toPersonSummary } from "@/lib/server/communities";
import { db } from "@/lib/server/db";
import {
  ADMIN_AUDIT_ACTIONS,
  auditListQuerySchema,
  searchParamsToObject,
} from "@/lib/validation/community";

export const dynamic = "force-dynamic";

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function AdminAuditPage({ searchParams }: PageProps) {
  await requireRole(["admin"], "/app/admin/audit");
  const resolved = await searchParams;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(resolved)) if (typeof value === "string") params.set(key, value);
  const query = auditListQuerySchema.parse(searchParamsToObject(params));
  const where = buildAuditWhere(query);
  const [total, rows, actors] = await Promise.all([
    db.adminAuditLog.count({ where }),
    db.adminAuditLog.findMany({ where, select: auditSelect, orderBy: { createdAt: "desc" }, skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
    db.user.findMany({
      where: { auditLogEntries: { some: {} } },
      select: { id: true, fullName: true, email: true },
      orderBy: [{ fullName: "asc" }, { email: "asc" }],
    }),
  ]);
  const entries = rows.map((row) => serializeAuditEntry(row, toPersonSummary));
  const lastPage = Math.max(1, Math.ceil(total / query.pageSize));
  const pageHref = (page: number) => {
    const next = new URLSearchParams(params);
    next.set("page", String(page));
    return `/app/admin/audit?${next.toString()}`;
  };
  const hasFilters = Boolean(
    query.communityId || query.providerUserId || query.action || query.actorUserId || query.related || query.age,
  );
  const actionLabel = (action: string) =>
    action.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

  return (
    <div className="px-4 py-6 md:px-6 xl:px-8 xl:py-7">
      <div className="mx-auto max-w-[1500px]">
        <div className="mb-5">
          <p className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-emerald-700">Security &amp; governance</p>
          <h1 className="mt-1 text-[25px] font-extrabold tracking-[-0.035em] text-slate-950">Admin audit trail</h1>
          <p className="mt-1 text-[12px] text-slate-500">Immutable history of sensitive account, customer, and provider actions.</p>
        </div>
        <form className="mb-4 grid gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-2 xl:grid-cols-[minmax(220px,1.4fr)_minmax(200px,1fr)_minmax(170px,.8fr)_minmax(150px,.7fr)_auto]" method="get">
          {query.communityId ? <input type="hidden" name="communityId" value={query.communityId} /> : null}
          {query.providerUserId ? <input type="hidden" name="providerUserId" value={query.providerUserId} /> : null}
          <AuditFilter label="Event type" name="action" defaultValue={query.action ?? ""}>
            <option value="">All events</option>
            {ADMIN_AUDIT_ACTIONS.map((action) => <option key={action} value={action}>{actionLabel(action)}</option>)}
          </AuditFilter>
          <AuditFilter label="Performed by" name="actorUserId" defaultValue={query.actorUserId ?? ""}>
            <option value="">Anyone</option>
            <option value="system">System</option>
            {actors.map((actor) => <option key={actor.id} value={actor.id}>{actor.fullName} · {actor.email}</option>)}
          </AuditFilter>
          <AuditFilter label="Related record" name="related" defaultValue={query.related ?? ""}>
            <option value="">Any record</option>
            <option value="community">Community</option>
            <option value="provider">Provider</option>
            <option value="internal">Internal</option>
          </AuditFilter>
          <AuditFilter label="Date range" name="age" defaultValue={query.age ?? ""}>
            <option value="">All time</option>
            <option value="24h">Last 24 hours</option>
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
            <option value="90d">Last 90 days</option>
          </AuditFilter>
          <div className="flex items-end gap-2">
            <button className="h-10 rounded-lg bg-slate-900 px-4 text-[11px] font-bold text-white hover:bg-slate-800" type="submit">Apply filters</button>
            {hasFilters ? <Link className="grid h-10 place-items-center rounded-lg border border-slate-200 px-3 text-[11px] font-bold text-slate-600 hover:bg-slate-50" href="/app/admin/audit">Clear</Link> : null}
          </div>
        </form>
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
            <div><h2 className="text-[13px] font-extrabold text-slate-900">Recorded events</h2><p className="text-[10px] text-slate-500">{total} append-only action{total === 1 ? "" : "s"}</p></div>
            <span className="inline-flex items-center gap-1.5 rounded-md bg-emerald-50 px-2 py-1 text-[9px] font-bold uppercase tracking-[0.1em] text-emerald-700 ring-1 ring-inset ring-emerald-100"><Icon name="shield" size={12} /> Protected history</span>
          </div>
          {entries.length === 0 ? (
            <div className="px-5 py-14 text-center"><span className="mx-auto grid h-11 w-11 place-items-center rounded-xl bg-slate-100 text-slate-500"><Icon name="clipboard" size={20} /></span><h3 className="mt-3 text-[13px] font-bold text-slate-800">Nothing recorded yet</h3><p className="mt-1 text-[11px] text-slate-500">Sensitive CRM changes will appear here automatically.</p></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[920px] border-collapse text-left">
                <thead><tr className="border-b border-slate-200 bg-slate-50/70 text-[9px] font-extrabold uppercase tracking-[0.13em] text-slate-400"><th className="px-5 py-3">Event</th><th className="px-4 py-3">Performed by</th><th className="px-4 py-3">Related record</th><th className="px-4 py-3">Event ID</th><th className="px-5 py-3 text-right">Timestamp</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {entries.map((entry) => (
                    <tr key={entry.id} className="hover:bg-slate-50/80">
                      <td className="px-5 py-3.5"><div className="flex items-start gap-2.5"><span className="mt-0.5 grid h-7 w-7 place-items-center rounded-md bg-slate-100 text-slate-500"><Icon name="edit" size={13} /></span><div><p className="text-[11px] font-semibold text-slate-700">{entry.summary}</p><p className="mt-0.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-slate-400">{entry.action.replaceAll("_", " ")}</p></div></div></td>
                      <td className="px-4 py-3.5">{entry.actor ? <div className="flex items-center gap-2"><span className="grid h-7 w-7 place-items-center rounded-md bg-emerald-50 text-[9px] font-bold text-emerald-700">{entry.actor.initials}</span><div><p className="text-[10px] font-semibold text-slate-700">{entry.actor.fullName}</p><p className="max-w-[170px] truncate text-[9px] text-slate-400">{entry.actor.email}</p></div></div> : <span className="text-[10px] font-semibold text-slate-500">System</span>}</td>
                      <td className="px-4 py-3.5">{entry.communityName ? <Link href={`/app/admin/communities/${entry.communityId}`} className="inline-flex items-center gap-1.5 rounded-md bg-blue-50 px-2 py-1 text-[9px] font-bold text-blue-700"><Icon name="house" size={11} />{entry.communityName}</Link> : entry.providerUserId ? <Link href={`/app/admin/providers/${entry.providerUserId}`} className="inline-flex items-center gap-1.5 rounded-md bg-violet-50 px-2 py-1 text-[9px] font-bold text-violet-700"><Icon name="tools" size={11} />Provider</Link> : <span className="text-[10px] text-slate-400">Internal</span>}</td>
                      <td className="px-4 py-3.5 font-mono text-[9px] text-slate-400">{entry.id.slice(0, 12)}…</td>
                      <td className="px-5 py-3.5 text-right text-[10px] font-medium text-slate-500">{new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(entry.createdAt))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {lastPage > 1 && <nav className="flex items-center justify-between border-t border-slate-200 bg-slate-50/60 px-5 py-3" aria-label="Audit log pages">{query.page > 1 ? <Link className="text-[11px] font-bold text-slate-600" href={pageHref(query.page - 1)}>← Newer</Link> : <span />}<span className="text-[10px] font-semibold text-slate-400">Page {query.page} of {lastPage}</span>{query.page < lastPage ? <Link className="text-[11px] font-bold text-slate-600" href={pageHref(query.page + 1)}>Older →</Link> : <span />}</nav>}
        </section>
      </div>
    </div>
  );
}

function AuditFilter({
  label,
  name,
  defaultValue,
  children,
}: Readonly<{ label: string; name: string; defaultValue: string; children: ReactNode }>) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[9px] font-extrabold uppercase tracking-[0.13em] text-slate-500">{label}</span>
      <select className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-[11px] font-semibold text-slate-700 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100" defaultValue={defaultValue} name={name}>
        {children}
      </select>
    </label>
  );
}
