import Link from "next/link";

import { ProviderFilters } from "@/components/admin/ProviderFilters";
import { Icon } from "@/components/ui/Icon";
import { requireRole } from "@/lib/server/auth";
import { listProviders } from "@/lib/server/providers-admin";
import { providerListQuerySchema, searchParamsToObject } from "@/lib/validation/community";

export const dynamic = "force-dynamic";

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const statusClass = {
  active: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  pending: "bg-amber-50 text-amber-700 ring-amber-200",
  suspended: "bg-rose-50 text-rose-700 ring-rose-200",
};

export default async function AdminProvidersPage({ searchParams }: PageProps) {
  await requireRole(["admin"], "/app/admin/providers");
  const resolved = await searchParams;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(resolved)) if (typeof value === "string") params.set(key, value);

  const query = providerListQuerySchema.parse(searchParamsToObject(params));
  const { providers, total } = await listProviders(query);
  const lastPage = Math.max(1, Math.ceil(total / query.pageSize));
  const pageHref = (page: number) => {
    const next = new URLSearchParams(params);
    next.set("page", String(page));
    return `/app/admin/providers?${next.toString()}`;
  };
  const hasFilters = Boolean(query.search || query.status || query.verification);
  const activeOnPage = providers.filter((provider) => provider.accountStatus === "active").length;
  const verifiedOnPage = providers.filter((provider) => provider.isLicenseVerified && provider.isInsuranceVerified).length;

  return (
    <div className="px-4 py-6 md:px-6 xl:px-8 xl:py-7">
      <div className="mx-auto max-w-[1500px]">
        <div className="mb-5">
          <p className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-emerald-700">Provider relationship management</p>
          <h1 className="mt-1 text-[25px] font-extrabold tracking-[-0.035em] text-slate-950">Service provider network</h1>
          <p className="mt-1 text-[12px] text-slate-500">Qualify providers, verify credentials, and maintain marketplace readiness.</p>
        </div>

        <div className="mb-5 grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3.5 shadow-sm"><p className="text-[9px] font-bold uppercase tracking-[0.13em] text-slate-400">Records in view</p><p className="mt-1 text-[22px] font-extrabold text-slate-950">{total}</p></div>
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3.5 shadow-sm"><p className="text-[9px] font-bold uppercase tracking-[0.13em] text-slate-400">Active on page</p><p className="mt-1 text-[22px] font-extrabold text-slate-950">{activeOnPage}</p></div>
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3.5 shadow-sm"><p className="text-[9px] font-bold uppercase tracking-[0.13em] text-slate-400">Fully verified on page</p><p className="mt-1 text-[22px] font-extrabold text-slate-950">{verifiedOnPage}</p></div>
        </div>

        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3.5">
            <div><h2 className="text-[13px] font-extrabold text-slate-900">Provider directory</h2><p className="text-[10px] text-slate-500">Credential and account controls are available inside each record</p></div>
            <span className="rounded-md bg-slate-100 px-2 py-1 text-[9px] font-bold uppercase tracking-[0.1em] text-slate-500">{total} records</span>
          </div>
          <ProviderFilters query={query} />

          {providers.length === 0 ? (
            <div className="px-5 py-14 text-center"><span className="mx-auto grid h-11 w-11 place-items-center rounded-xl bg-slate-100 text-slate-500"><Icon name="tools" size={20} /></span><h3 className="mt-3 text-[13px] font-bold text-slate-800">{hasFilters ? "No providers match these filters" : "No provider accounts yet"}</h3><p className="mt-1 text-[11px] text-slate-500">{hasFilters ? "Clear a filter to widen the provider search." : "Provider records appear after public onboarding is completed."}</p></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] border-collapse text-left">
                <thead><tr className="border-b border-slate-200 bg-white text-[9px] font-extrabold uppercase tracking-[0.13em] text-slate-400"><th className="px-4 py-3">Provider</th><th className="px-4 py-3">Company &amp; trades</th><th className="px-4 py-3">Service area</th><th className="px-4 py-3">Credentials</th><th className="px-4 py-3">Account</th><th className="px-4 py-3">Joined</th><th className="px-4 py-3 text-right">Record</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {providers.map((provider) => (
                    <tr key={provider.userId} className="group hover:bg-slate-50/80">
                      <td className="px-4 py-3.5"><div className="flex items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-lg bg-violet-50 text-[11px] font-extrabold text-violet-700">{provider.user.initials}</span><div><Link href={`/app/admin/providers/${provider.userId}`} className="text-[12px] font-bold text-slate-900 hover:text-emerald-700">{provider.user.fullName}</Link><p className="mt-0.5 max-w-[190px] truncate text-[9px] text-slate-400">{provider.user.email}</p></div></div></td>
                      <td className="px-4 py-3.5"><p className="text-[11px] font-semibold text-slate-700">{provider.companyName ?? "Independent provider"}</p><p className="mt-0.5 max-w-[200px] truncate text-[9px] text-slate-400">{provider.trades.length > 0 ? provider.trades.join(", ") : "Trades not supplied"}</p></td>
                      <td className="px-4 py-3.5 text-[10px] font-semibold text-slate-600">{provider.serviceArea || "Not configured"}</td>
                      <td className="px-4 py-3.5"><div className="flex items-center gap-1.5"><span title="Licence" className={`grid h-7 w-7 place-items-center rounded-md ${provider.isLicenseVerified ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-400"}`}><Icon name="clipboard" size={13} /></span><span title="Insurance" className={`grid h-7 w-7 place-items-center rounded-md ${provider.isInsuranceVerified ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-400"}`}><Icon name="shield" size={13} /></span><span className="ml-1 text-[9px] text-slate-400">{provider.isLicenseVerified && provider.isInsuranceVerified ? "Complete" : "Review needed"}</span></div></td>
                      <td className="px-4 py-3.5"><span className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[9px] font-bold capitalize ring-1 ring-inset ${statusClass[provider.accountStatus]}`}><span className={`h-1.5 w-1.5 rounded-full ${provider.accountStatus === "active" ? "bg-emerald-500" : provider.accountStatus === "pending" ? "bg-amber-500" : "bg-rose-500"}`} />{provider.accountStatus}</span></td>
                      <td className="px-4 py-3.5 text-[10px] font-medium text-slate-500">{new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(provider.createdAt))}</td>
                      <td className="px-4 py-3.5 text-right"><Link aria-label={`Open ${provider.user.fullName}`} href={`/app/admin/providers/${provider.userId}`} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-200 px-2.5 text-[10px] font-bold text-slate-600 transition hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700">Review <Icon name="chevron-right" size={12} /></Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {lastPage > 1 && <nav className="flex items-center justify-between border-t border-slate-200 bg-slate-50/60 px-4 py-3" aria-label="Provider pages">{query.page > 1 ? <Link className="text-[11px] font-bold text-slate-600" href={pageHref(query.page - 1)}>← Previous</Link> : <span />}<span className="text-[10px] font-semibold text-slate-400">Page {query.page} of {lastPage}</span>{query.page < lastPage ? <Link className="text-[11px] font-bold text-slate-600" href={pageHref(query.page + 1)}>Next →</Link> : <span />}</nav>}
        </section>
      </div>
    </div>
  );
}
