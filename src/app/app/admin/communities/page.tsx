import Link from "next/link";

import { CommunityCreateForm } from "@/components/admin/CommunityCreateForm";
import { CommunityFilters } from "@/components/admin/CommunityFilters";
import { Icon } from "@/components/ui/Icon";
import { requireRole } from "@/lib/server/auth";
import { listCommunities } from "@/lib/server/communities";
import { communityListQuerySchema, searchParamsToObject } from "@/lib/validation/community";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AdminCommunitiesPage({ searchParams }: PageProps) {
  await requireRole(["admin"], "/app/admin/communities");

  const resolved = await searchParams;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(resolved)) {
    if (typeof value === "string") params.set(key, value);
  }

  const query = communityListQuerySchema.parse(searchParamsToObject(params));
  const { communities, total } = await listCommunities(query);
  const lastPage = Math.max(1, Math.ceil(total / query.pageSize));
  const pageHref = (page: number) => {
    const next = new URLSearchParams(params);
    next.set("page", String(page));
    return `/app/admin/communities?${next.toString()}`;
  };
  const hasFilters = Boolean(query.search || query.type || query.status || query.managerState);
  const viewTitle = query.type === "neighborhood" ? "Neighborhood communities" : query.type === "hoa" ? "HOA customer accounts" : "Community accounts";
  const managedOnPage = communities.filter((community) => community.manager).length;
  const activeHomesOnPage = communities.reduce((sum, community) => sum + community.activeMemberCount, 0);

  return (
    <div className="px-4 py-6 md:px-6 xl:px-8 xl:py-7">
      <div className="mx-auto max-w-[1500px]">
        <div className="mb-5 flex flex-col justify-between gap-4 md:flex-row md:items-end">
          <div>
            <p className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-emerald-700">Customer relationship management</p>
            <h1 className="mt-1 text-[25px] font-extrabold tracking-[-0.035em] text-slate-950">{viewTitle}</h1>
            <p className="mt-1 text-[12px] text-slate-500">Own onboarding, account coverage, and manager relationships from first contact to live service.</p>
          </div>
          <a href="#new-account" className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 text-[12px] font-bold text-white shadow-sm hover:bg-emerald-700">
            <Icon name="plus" size={15} /> Create account
          </a>
        </div>

        <div className="mb-5 grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3.5 shadow-sm"><p className="text-[9px] font-bold uppercase tracking-[0.13em] text-slate-400">Records in view</p><p className="mt-1 text-[22px] font-extrabold text-slate-950">{total}</p></div>
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3.5 shadow-sm"><p className="text-[9px] font-bold uppercase tracking-[0.13em] text-slate-400">Manager coverage</p><p className="mt-1 text-[22px] font-extrabold text-slate-950">{communities.length > 0 ? Math.round((managedOnPage / communities.length) * 100) : 0}%</p></div>
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3.5 shadow-sm"><p className="text-[9px] font-bold uppercase tracking-[0.13em] text-slate-400">Active residents on page</p><p className="mt-1 text-[22px] font-extrabold text-slate-950">{activeHomesOnPage.toLocaleString()}</p></div>
        </div>

        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3.5">
            <div>
              <h2 className="text-[13px] font-extrabold text-slate-900">Account directory</h2>
              <p className="text-[10px] text-slate-500">{total} record{total === 1 ? "" : "s"} match the current view</p>
            </div>
            <span className="rounded-md bg-slate-100 px-2 py-1 text-[9px] font-bold uppercase tracking-[0.1em] text-slate-500">Live database</span>
          </div>
          <CommunityFilters query={query} />

          {communities.length === 0 ? (
            <div className="px-5 py-14 text-center">
              <span className="mx-auto grid h-11 w-11 place-items-center rounded-xl bg-slate-100 text-slate-500"><Icon name="search" size={20} /></span>
              <h3 className="mt-3 text-[13px] font-bold text-slate-800">{hasFilters ? "No accounts match these filters" : "No community accounts yet"}</h3>
              <p className="mt-1 text-[11px] text-slate-500">{hasFilters ? "Clear a filter to widen the account search." : "Create the first HOA account or neighborhood to start onboarding."}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] border-collapse text-left">
                <thead>
                  <tr className="border-b border-slate-200 bg-white text-[9px] font-extrabold uppercase tracking-[0.13em] text-slate-400">
                    <th className="px-4 py-3">Customer account</th>
                    <th className="px-4 py-3">Account type</th>
                    <th className="px-4 py-3">Primary contact</th>
                    <th className="px-4 py-3">Residents</th>
                    <th className="px-4 py-3">Coverage</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Record</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {communities.map((community) => (
                    <tr key={community.id} className="group hover:bg-slate-50/80">
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-3">
                          <span className={`grid h-9 w-9 place-items-center rounded-lg ${community.type === "hoa" ? "bg-blue-50 text-blue-700" : "bg-emerald-50 text-emerald-700"}`}><Icon name={community.type === "hoa" ? "house" : "map-pin"} size={17} /></span>
                          <div>
                            <Link href={`/app/admin/communities/${community.id}`} className="text-[12px] font-bold text-slate-900 hover:text-emerald-700">{community.name}</Link>
                            <p className="mt-0.5 text-[9px] text-slate-400">Created {new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(community.createdAt))}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3.5"><span className={`rounded-md px-2 py-1 text-[9px] font-bold ring-1 ring-inset ${community.type === "hoa" ? "bg-blue-50 text-blue-700 ring-blue-200" : "bg-emerald-50 text-emerald-700 ring-emerald-200"}`}>{community.type === "hoa" ? "Official HOA" : "Neighborhood"}</span></td>
                      <td className="px-4 py-3.5">
                        {community.manager ? <div><p className="text-[11px] font-semibold text-slate-700">{community.manager.user.fullName}</p><p className="text-[9px] text-slate-400">{community.manager.roleLabel}</p></div> : <span className="inline-flex items-center gap-1.5 text-[10px] font-bold text-amber-700"><span className="h-1.5 w-1.5 rounded-full bg-amber-500" />Unassigned</span>}
                      </td>
                      <td className="px-4 py-3.5"><p className="text-[12px] font-bold text-slate-800">{community.activeMemberCount}</p><p className="text-[9px] text-slate-400">{community.pendingMemberCount} pending</p></td>
                      <td className="px-4 py-3.5"><p className="text-[10px] font-semibold text-slate-600">{community.radiusMiles !== null ? `${community.radiusMiles} mi radius` : `${community.hoaTeamCount} HOA staff`}</p></td>
                      <td className="px-4 py-3.5"><span className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[9px] font-bold ring-1 ring-inset ${community.status === "active" ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-slate-100 text-slate-600 ring-slate-200"}`}><span className={`h-1.5 w-1.5 rounded-full ${community.status === "active" ? "bg-emerald-500" : "bg-slate-400"}`} />{community.status === "active" ? "Active" : "Archived"}</span></td>
                      <td className="px-4 py-3.5 text-right"><Link aria-label={`Open ${community.name}`} href={`/app/admin/communities/${community.id}`} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-200 px-2.5 text-[10px] font-bold text-slate-600 transition hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700">View <Icon name="chevron-right" size={12} /></Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {lastPage > 1 && (
            <nav className="flex items-center justify-between border-t border-slate-200 bg-slate-50/60 px-4 py-3" aria-label="Community pages">
              {query.page > 1 ? <Link className="text-[11px] font-bold text-slate-600" href={pageHref(query.page - 1)}>← Previous</Link> : <span />}
              <span className="text-[10px] font-semibold text-slate-400">Page {query.page} of {lastPage}</span>
              {query.page < lastPage ? <Link className="text-[11px] font-bold text-slate-600" href={pageHref(query.page + 1)}>Next →</Link> : <span />}
            </nav>
          )}
        </section>

        <section id="new-account" className="mt-6 scroll-mt-24 rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
          <div className="border-b border-slate-200 px-5 py-4">
            <div className="flex items-center gap-3">
              <span className="grid h-9 w-9 place-items-center rounded-lg bg-emerald-50 text-emerald-700"><Icon name="plus" size={17} /></span>
              <div><h2 className="text-[14px] font-extrabold text-slate-900">Create a customer account</h2><p className="mt-0.5 text-[10px] text-slate-500">Start an HOA onboarding record or a geolocation-based neighborhood.</p></div>
            </div>
          </div>
          <div className="p-5"><CommunityCreateForm /></div>
        </section>
      </div>
    </div>
  );
}
