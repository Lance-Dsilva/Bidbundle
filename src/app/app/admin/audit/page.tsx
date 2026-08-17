import Link from "next/link";

import { Icon } from "@/components/ui/Icon";
import { serializeAuditEntry } from "@/lib/server/audit";
import { requireRole } from "@/lib/server/auth";
import { auditSelect, toPersonSummary } from "@/lib/server/communities";
import { db } from "@/lib/server/db";
import { auditListQuerySchema, searchParamsToObject } from "@/lib/validation/community";

export const dynamic = "force-dynamic";

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function AdminAuditPage({ searchParams }: PageProps) {
  await requireRole(["admin"], "/app/admin/audit");
  const resolved = await searchParams;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(resolved)) if (typeof value === "string") params.set(key, value);
  const query = auditListQuerySchema.parse(searchParamsToObject(params));
  const where = {
    ...(query.communityId ? { communityId: query.communityId } : {}),
    ...(query.providerUserId ? { providerUserId: query.providerUserId } : {}),
  };
  const [total, rows] = await Promise.all([
    db.adminAuditLog.count({ where }),
    db.adminAuditLog.findMany({ where, select: auditSelect, orderBy: { createdAt: "desc" }, skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
  ]);
  const entries = rows.map((row) => serializeAuditEntry(row, toPersonSummary));
  const lastPage = Math.max(1, Math.ceil(total / query.pageSize));
  const pageHref = (page: number) => {
    const next = new URLSearchParams(params);
    next.set("page", String(page));
    return `/app/admin/audit?${next.toString()}`;
  };

  return (
    <div className="px-4 py-6 md:px-6 xl:px-8 xl:py-7">
      <div className="mx-auto max-w-[1500px]">
        <div className="mb-5">
          <p className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-emerald-700">Security &amp; governance</p>
          <h1 className="mt-1 text-[25px] font-extrabold tracking-[-0.035em] text-slate-950">Admin audit trail</h1>
          <p className="mt-1 text-[12px] text-slate-500">Immutable history of sensitive account, customer, and provider actions.</p>
        </div>
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
