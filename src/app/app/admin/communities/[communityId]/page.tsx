import Link from "next/link";
import { notFound } from "next/navigation";

import { CommunityDetailWorkspace } from "@/components/admin/CommunityDetailWorkspace";
import { Icon } from "@/components/ui/Icon";
import { AppPageHeader } from "@/components/layout/AppPageHeader";
import { requireRole } from "@/lib/server/auth";
import { getCommunityDetail } from "@/lib/server/communities";
import { db } from "@/lib/server/db";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ communityId: string }> };

/**
 * Community detail.
 *
 * The initial payload is read on the server so the page renders complete;
 * the workspace below it takes over for mutations and holds the refreshed
 * payload each endpoint returns, which avoids a re-fetch after every action.
 */
export default async function AdminCommunityDetailPage({ params }: PageProps) {
  await requireRole(["admin"], "/app/admin/communities");

  const { communityId } = await params;
  const detail = await getCommunityDetail(communityId);
  if (!detail) notFound();
  const crmSnapshot = detail.community.type === "hoa"
    ? await db.community.findUnique({
        where: { id: communityId },
        select: {
          hoaProfile: { select: { onboardingStatus: true, totalHomes: true } },
          _count: {
            select: {
              units: true,
              invitations: { where: { status: "pending" } },
              hoaRequests: {
                where: {
                  status: {
                    in: ["collecting_interest", "open_for_bids", "bidding_closed", "awarded", "scheduled", "in_progress"],
                  },
                },
              },
              serviceAgreements: { where: { status: "active" } },
            },
          },
        },
      })
    : null;

  return (
    <div className="flex flex-col">
      <AppPageHeader
        title={detail.community.name}
        subtitle={
          detail.community.type === "hoa"
            ? "Official HOA community"
            : `Location-based neighborhood · ${detail.community.radiusMiles ?? "—"} mi radius`
        }
        action={
          <Link
            href="/app/admin/communities"
            className="text-[12px] font-semibold"
            style={{ color: "var(--teal-800)" }}
          >
            ← All communities
          </Link>
        }
      />

      <div className="mx-auto w-full max-w-[1400px] px-4 py-6 md:px-6 xl:px-8">
        {crmSnapshot && (
          <section className="mb-5 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-col justify-between gap-3 border-b border-slate-200 px-5 py-4 sm:flex-row sm:items-center">
              <div>
                <p className="text-[9px] font-extrabold uppercase tracking-[0.14em] text-emerald-700">Customer 360</p>
                <h2 className="mt-0.5 text-[14px] font-extrabold text-slate-900">Onboarding and service health</h2>
              </div>
              <span className="inline-flex w-fit items-center gap-1.5 rounded-md bg-blue-50 px-2.5 py-1.5 text-[9px] font-bold capitalize text-blue-700 ring-1 ring-inset ring-blue-100">
                <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
                {(crmSnapshot.hoaProfile?.onboardingStatus ?? "draft").replaceAll("_", " ")}
              </span>
            </div>
            <div className="grid divide-y divide-slate-100 sm:grid-cols-2 sm:divide-x sm:divide-y-0 xl:grid-cols-4">
              {[
                { label: "Resident adoption", value: `${detail.community.activeMemberCount}/${crmSnapshot.hoaProfile?.totalHomes ?? 0}`, hint: `${crmSnapshot._count.invitations} invitations pending`, icon: "users" as const },
                { label: "Unit roster", value: crmSnapshot._count.units, hint: `${crmSnapshot.hoaProfile?.totalHomes ?? 0} homes declared`, icon: "house" as const },
                { label: "Open requests", value: crmSnapshot._count.hoaRequests, hint: "Across the service lifecycle", icon: "clipboard" as const },
                { label: "Active agreements", value: crmSnapshot._count.serviceAgreements, hint: "Awarded provider work", icon: "calendar" as const },
              ].map((metric) => (
                <div key={metric.label} className="flex items-center gap-3 px-5 py-4">
                  <span className="grid h-9 w-9 place-items-center rounded-lg bg-slate-100 text-slate-600"><Icon name={metric.icon} size={16} /></span>
                  <div><p className="text-[9px] font-bold uppercase tracking-[0.1em] text-slate-400">{metric.label}</p><p className="mt-0.5 text-[18px] font-extrabold text-slate-900">{metric.value}</p><p className="text-[9px] text-slate-400">{metric.hint}</p></div>
                </div>
              ))}
            </div>
          </section>
        )}
        <CommunityDetailWorkspace initialDetail={detail} />
      </div>
    </div>
  );
}
