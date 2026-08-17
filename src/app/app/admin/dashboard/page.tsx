import Link from "next/link";

import { Icon, type IconName } from "@/components/ui/Icon";
import { getAdminCrmOverview, type CrmHoaAccount } from "@/lib/server/admin-crm";
import { requireRole } from "@/lib/server/auth";
import { getAdminOverview } from "@/lib/server/communities";

export const dynamic = "force-dynamic";

const onboardingMeta: Array<{
  key: CrmHoaAccount["onboardingStatus"];
  label: string;
  shortLabel: string;
}> = [
  { key: "draft", label: "Account setup", shortLabel: "Setup" },
  { key: "manager_invited", label: "Manager invited", shortLabel: "Invited" },
  { key: "manager_active", label: "Manager activated", shortLabel: "Activated" },
  { key: "residents_inviting", label: "Resident rollout", shortLabel: "Rollout" },
  { key: "live", label: "Live customer", shortLabel: "Live" },
];

function MetricCard({
  label,
  value,
  detail,
  icon,
  tone = "emerald",
  href,
}: Readonly<{
  label: string;
  value: string | number;
  detail: string;
  icon: IconName;
  tone?: "emerald" | "blue" | "amber" | "violet";
  href?: string;
}>) {
  const tones = {
    emerald: "bg-emerald-50 text-emerald-700 ring-emerald-100",
    blue: "bg-blue-50 text-blue-700 ring-blue-100",
    amber: "bg-amber-50 text-amber-700 ring-amber-100",
    violet: "bg-violet-50 text-violet-700 ring-violet-100",
  };
  const body = (
    <div className="group rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.03)] transition hover:border-slate-300 hover:shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-500">{label}</p>
          <p className="mt-2 text-[28px] font-extrabold tracking-[-0.04em] text-slate-950">{value}</p>
        </div>
        <span className={`grid h-9 w-9 place-items-center rounded-lg ring-1 ring-inset ${tones[tone]}`}>
          <Icon name={icon} size={17} />
        </span>
      </div>
      <div className="mt-2 flex items-center gap-1.5 text-[11px] text-slate-500">
        <span>{detail}</span>
        {href && <Icon name="arrow-right" size={12} className="ml-auto text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-emerald-600" />}
      </div>
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

function onboardingLabel(status: CrmHoaAccount["onboardingStatus"]) {
  return onboardingMeta.find((stage) => stage.key === status)?.label ?? "Archived";
}

function lifecycleTone(status: CrmHoaAccount["onboardingStatus"]) {
  if (status === "live") return "bg-emerald-50 text-emerald-700 ring-emerald-200";
  if (status === "archived") return "bg-slate-100 text-slate-600 ring-slate-200";
  if (status === "manager_invited" || status === "manager_active") return "bg-blue-50 text-blue-700 ring-blue-200";
  return "bg-amber-50 text-amber-700 ring-amber-200";
}

function nextAction(account: CrmHoaAccount) {
  if (!account.manager) return "Assign manager";
  if (account.unitCount < account.totalHomes) return "Complete unit roster";
  if (account.pendingInvites > 0) return "Review invitations";
  if (account.onboardingStatus !== "live") return "Advance onboarding";
  if (account.openRequests === 0) return "Review services";
  return "Open account";
}

export default async function AdminDashboardPage() {
  const user = await requireRole(["admin"], "/app/admin/dashboard");
  const [overview, crm] = await Promise.all([getAdminOverview(), getAdminCrmOverview()]);

  const totalHoa = overview.hoaCommunities;
  const liveHoa = crm.onboarding.live;
  const onboardingHoa = Math.max(0, totalHoa - liveHoa - crm.onboarding.archived);
  const householdCapacity = crm.customers.householdCapacity;
  const activeHouseholds = crm.customers.activeHouseholds;
  const householdCoverage = householdCapacity > 0 ? Math.round((activeHouseholds / householdCapacity) * 100) : 0;
  const totalPipeline = onboardingMeta.reduce((sum, stage) => sum + crm.onboarding[stage.key], 0);

  const priorityAccounts = [...crm.accounts]
    .sort((a, b) => {
      const score = (account: CrmHoaAccount) =>
        (account.manager ? 0 : 100) +
        (account.onboardingStatus === "live" ? 0 : 20) +
        Math.max(0, account.totalHomes - account.unitCount) +
        account.pendingInvites;
      return score(b) - score(a);
    })
    .slice(0, 7);

  return (
    <div className="px-4 py-6 md:px-6 xl:px-8 xl:py-7">
      <div className="mx-auto max-w-[1500px]">
        <div className="mb-6 flex flex-col justify-between gap-4 md:flex-row md:items-end">
          <div>
            <div className="mb-2 flex items-center gap-2">
              <span className="rounded-md bg-emerald-50 px-2 py-1 text-[9px] font-extrabold uppercase tracking-[0.16em] text-emerald-700 ring-1 ring-inset ring-emerald-100">
                Live workspace
              </span>
              <span className="text-[11px] text-slate-400">Customer &amp; service operations</span>
            </div>
            <h1 className="text-[25px] font-extrabold tracking-[-0.035em] text-slate-950 md:text-[29px]">
              Good morning, {user.name?.split(" ")[0] || "admin"}
            </h1>
            <p className="mt-1 text-[13px] text-slate-500">
              Monitor HOA onboarding, resident adoption, and marketplace delivery from one view.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {user.adminAccessLevel === "owner" && (
              <Link href="/app/admin/access" className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 text-[12px] font-bold text-slate-700 shadow-sm hover:bg-slate-50">
                <Icon name="users" size={15} />
                Admin access
              </Link>
            )}
            <Link href="/app/admin/communities#new-account" className="inline-flex h-9 items-center gap-2 rounded-lg bg-emerald-600 px-3.5 text-[12px] font-bold text-white shadow-sm hover:bg-emerald-700">
              <Icon name="plus" size={15} />
              Add HOA
            </Link>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="HOA accounts" value={totalHoa} detail={`${onboardingHoa} currently onboarding`} icon="house" href="/app/admin/communities?type=hoa" />
          <MetricCard label="Live households" value={activeHouseholds.toLocaleString()} detail={`${householdCoverage}% of ${householdCapacity.toLocaleString()} declared homes`} icon="users" tone="blue" href="/app/admin/communities?type=hoa" />
          <MetricCard label="Open service requests" value={crm.operations.activeRequests} detail={`${crm.operations.submittedBids} provider bids awaiting decisions`} icon="clipboard" tone="violet" />
          <MetricCard label="Active service delivery" value={crm.operations.activeAgreements} detail={`${crm.operations.activeVisits} visits scheduled or underway`} icon="calendar" tone="amber" />
        </div>

        <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.65fr)_minmax(320px,0.75fr)]">
          <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
            <div className="flex flex-col justify-between gap-3 border-b border-slate-200 px-5 py-4 sm:flex-row sm:items-center">
              <div>
                <h2 className="text-[14px] font-extrabold text-slate-900">Customer onboarding pipeline</h2>
                <p className="mt-0.5 text-[11px] text-slate-500">HOA accounts by implementation milestone</p>
              </div>
              <Link href="/app/admin/communities?type=hoa" className="inline-flex items-center gap-1.5 text-[11px] font-bold text-emerald-700 hover:text-emerald-800">
                Manage pipeline <Icon name="arrow-right" size={13} />
              </Link>
            </div>
            <div className="grid gap-px bg-slate-200 sm:grid-cols-5">
              {onboardingMeta.map((stage, index) => {
                const count = crm.onboarding[stage.key];
                const share = totalPipeline > 0 ? Math.round((count / totalPipeline) * 100) : 0;
                return (
                  <Link key={stage.key} href={`/app/admin/communities?type=hoa`} className="group bg-white p-4 transition hover:bg-slate-50">
                    <div className="flex items-center justify-between">
                      <span className="grid h-6 w-6 place-items-center rounded-md bg-slate-100 text-[10px] font-extrabold text-slate-500 group-hover:bg-emerald-100 group-hover:text-emerald-700">{index + 1}</span>
                      <span className="text-[10px] font-bold text-slate-400">{share}%</span>
                    </div>
                    <p className="mt-5 text-[22px] font-extrabold tracking-[-0.04em] text-slate-950">{count}</p>
                    <p className="mt-0.5 text-[10px] font-semibold text-slate-500 sm:hidden xl:block">{stage.label}</p>
                    <p className="mt-0.5 hidden text-[10px] font-semibold text-slate-500 sm:block xl:hidden">{stage.shortLabel}</p>
                    <div className="mt-3 h-1 overflow-hidden rounded-full bg-slate-100">
                      <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.max(count > 0 ? 12 : 0, share)}%` }} />
                    </div>
                  </Link>
                );
              })}
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-[#0f2036] p-5 text-white shadow-sm">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-400">Marketplace pulse</p>
                <h2 className="mt-1 text-[16px] font-extrabold">Service pipeline</h2>
              </div>
              <span className="grid h-9 w-9 place-items-center rounded-lg bg-white/[0.07] text-emerald-400 ring-1 ring-inset ring-white/10">
                <Icon name="bids" size={18} />
              </span>
            </div>
            <div className="mt-5 space-y-4">
              {[
                ["Requests in market", crm.operations.activeRequests, "Open demand"],
                ["Submitted bids", crm.operations.submittedBids, "Provider response"],
                ["Active agreements", crm.operations.activeAgreements, "Awarded work"],
                ["Visits in motion", crm.operations.activeVisits, "Delivery today"],
              ].map(([label, value, hint], index) => (
                <div key={String(label)} className="flex items-center gap-3">
                  <span className="grid h-7 w-7 place-items-center rounded-md bg-white/[0.06] text-[10px] font-extrabold text-slate-300">{index + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-semibold text-slate-200">{label}</p>
                    <p className="text-[9px] text-slate-500">{hint}</p>
                  </div>
                  <span className="text-[18px] font-extrabold text-white">{value}</span>
                </div>
              ))}
            </div>
          </section>
        </div>

        <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.7fr)_minmax(300px,0.7fr)]">
          <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <h2 className="text-[14px] font-extrabold text-slate-900">Accounts requiring attention</h2>
                <p className="mt-0.5 text-[11px] text-slate-500">Prioritized from onboarding gaps, manager coverage, and invitations</p>
              </div>
              <Link href="/app/admin/communities?type=hoa" className="hidden items-center gap-1.5 text-[11px] font-bold text-emerald-700 sm:inline-flex">
                All accounts <Icon name="arrow-right" size={13} />
              </Link>
            </div>
            {priorityAccounts.length === 0 ? (
              <div className="p-10 text-center">
                <span className="mx-auto grid h-11 w-11 place-items-center rounded-xl bg-emerald-50 text-emerald-700"><Icon name="check-circle" size={21} /></span>
                <p className="mt-3 text-[13px] font-bold text-slate-800">No HOA accounts yet</p>
                <p className="mt-1 text-[11px] text-slate-500">Create the first account to begin the onboarding pipeline.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] border-collapse text-left">
                  <thead>
                    <tr className="bg-slate-50 text-[9px] font-extrabold uppercase tracking-[0.13em] text-slate-500">
                      <th className="px-5 py-3">Account</th>
                      <th className="px-4 py-3">Lifecycle</th>
                      <th className="px-4 py-3">Manager</th>
                      <th className="px-4 py-3">Households</th>
                      <th className="px-4 py-3">Next best action</th>
                      <th className="px-5 py-3 text-right">Open</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {priorityAccounts.map((account) => {
                      const coverage = account.totalHomes > 0 ? Math.min(100, Math.round((account.activeMembers / account.totalHomes) * 100)) : 0;
                      return (
                        <tr key={account.id} className="group hover:bg-slate-50/80">
                          <td className="px-5 py-3.5">
                            <div className="flex items-center gap-3">
                              <span className="grid h-8 w-8 place-items-center rounded-lg bg-emerald-50 text-[10px] font-extrabold text-emerald-700 ring-1 ring-inset ring-emerald-100">HOA</span>
                              <div>
                                <Link href={`/app/admin/communities/${account.id}`} className="text-[12px] font-bold text-slate-900 hover:text-emerald-700">{account.name}</Link>
                                <p className="mt-0.5 text-[10px] text-slate-400">{[account.locality, account.region].filter(Boolean).join(", ") || "Location not completed"}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3.5">
                            <span className={`inline-flex rounded-md px-2 py-1 text-[9px] font-bold ring-1 ring-inset ${lifecycleTone(account.onboardingStatus)}`}>{onboardingLabel(account.onboardingStatus)}</span>
                          </td>
                          <td className="px-4 py-3.5">
                            {account.manager ? (
                              <div>
                                <p className="text-[11px] font-semibold text-slate-700">{account.manager.name}</p>
                                <p className="max-w-[150px] truncate text-[9px] text-slate-400">{account.manager.email}</p>
                              </div>
                            ) : <span className="text-[10px] font-bold text-amber-700">Unassigned</span>}
                          </td>
                          <td className="px-4 py-3.5">
                            <div className="flex items-center gap-2">
                              <span className="text-[11px] font-bold text-slate-700">{account.activeMembers}/{account.totalHomes}</span>
                              <span className="h-1.5 w-12 overflow-hidden rounded-full bg-slate-100"><span className="block h-full rounded-full bg-emerald-500" style={{ width: `${coverage}%` }} /></span>
                            </div>
                          </td>
                          <td className="px-4 py-3.5 text-[10px] font-semibold text-slate-600">{nextAction(account)}</td>
                          <td className="px-5 py-3.5 text-right">
                            <Link aria-label={`Open ${account.name}`} href={`/app/admin/communities/${account.id}`} className="inline-grid h-7 w-7 place-items-center rounded-md border border-slate-200 text-slate-400 transition hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700"><Icon name="chevron-right" size={13} /></Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
            <div className="border-b border-slate-200 px-5 py-4">
              <h2 className="text-[14px] font-extrabold text-slate-900">Operational alerts</h2>
              <p className="mt-0.5 text-[11px] text-slate-500">Work queues that need review</p>
            </div>
            <div className="divide-y divide-slate-100 px-5">
              {[
                { label: "HOAs without manager", value: crm.customers.unassignedHoa, href: "/app/admin/communities?type=hoa&managerState=unassigned", icon: "profile" as IconName, tone: "text-amber-700 bg-amber-50" },
                { label: "Pending resident invites", value: overview.pendingHoaInvitations, href: "/app/admin/communities?type=hoa", icon: "mail" as IconName, tone: "text-blue-700 bg-blue-50" },
                { label: "Providers pending review", value: overview.providersByStatus.pending, href: "/app/admin/providers?status=pending", icon: "tools" as IconName, tone: "text-violet-700 bg-violet-50" },
                { label: "Unverified credentials", value: overview.providersAwaitingVerification, href: "/app/admin/providers?verification=unverified", icon: "shield" as IconName, tone: "text-rose-700 bg-rose-50" },
              ].map((alert) => (
                <Link key={alert.label} href={alert.href} className="group flex items-center gap-3 py-3.5">
                  <span className={`grid h-8 w-8 place-items-center rounded-lg ${alert.tone}`}><Icon name={alert.icon} size={15} /></span>
                  <span className="min-w-0 flex-1 text-[11px] font-semibold text-slate-700 group-hover:text-emerald-700">{alert.label}</span>
                  <span className="text-[16px] font-extrabold text-slate-900">{alert.value}</span>
                  <Icon name="chevron-right" size={12} className="text-slate-300" />
                </Link>
              ))}
            </div>
            <div className="mx-5 mb-5 mt-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="flex items-start gap-2.5">
                <Icon name="info" size={15} className="mt-0.5 text-slate-400" />
                <p className="text-[10px] leading-4 text-slate-500">Alerts are calculated from live records and clear automatically when the underlying work is completed.</p>
              </div>
            </div>
          </section>
        </div>

        <section className="mt-5 rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
            <div>
              <h2 className="text-[14px] font-extrabold text-slate-900">Recent admin activity</h2>
              <p className="mt-0.5 text-[11px] text-slate-500">Traceable changes across customer and provider records</p>
            </div>
            <Link href="/app/admin/audit" className="inline-flex items-center gap-1.5 text-[11px] font-bold text-emerald-700">Full audit trail <Icon name="arrow-right" size={13} /></Link>
          </div>
          {overview.recentAudit.length === 0 ? (
            <p className="px-5 py-8 text-center text-[12px] text-slate-500">Admin changes will appear here as your team works.</p>
          ) : (
            <div className="grid divide-y divide-slate-100 md:grid-cols-2 md:divide-x md:divide-y-0">
              {overview.recentAudit.slice(0, 6).map((entry) => (
                <div key={entry.id} className="flex items-start gap-3 px-5 py-3.5">
                  <span className="mt-0.5 grid h-7 w-7 place-items-center rounded-md bg-slate-100 text-slate-500"><Icon name="edit" size={13} /></span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-semibold text-slate-700">{entry.summary}{entry.communityName ? ` · ${entry.communityName}` : ""}</p>
                    <p className="mt-0.5 text-[9px] text-slate-400">{entry.actor?.fullName || entry.actor?.email || "System"} · {new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(entry.createdAt))}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
