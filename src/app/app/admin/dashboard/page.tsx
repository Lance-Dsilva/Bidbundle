import Link from "next/link";

import {
  AdminEmptyState,
  formatDateTime,
  PersonLine,
  SectionCard,
  StatTile,
} from "@/components/admin/AdminPrimitives";
import { AppPageHeader } from "@/components/layout/AppPageHeader";
import { requireRole } from "@/lib/server/auth";
import { getAdminOverview } from "@/lib/server/communities";

export const dynamic = "force-dynamic";

/**
 * Bundleen operations overview.
 *
 * A server component reading the database directly: the admin layout has
 * already run `requireRole(["admin"])` on this same request, so there is
 * nothing to gain from bouncing through `/api/admin/overview`, which exists
 * for clients that are not this page.
 *
 * Every number below is a live count. When a count is zero the tile says zero.
 */
export default async function AdminDashboardPage() {
  const user = await requireRole(["admin"], "/app/admin/dashboard");
  const overview = await getAdminOverview();

  const totalCommunities = overview.hoaCommunities + overview.neighborhoodCommunities;

  return (
    <div className="flex flex-col">
      <AppPageHeader
        title="Bundleen operations"
        subtitle="Internal portal · communities, members, and providers"
        action={
          <div className="flex flex-wrap items-center gap-2">
            {user.adminAccessLevel === "owner" && (
              <Link
                href="/app/admin/access"
                className="inline-flex h-9 items-center rounded-xl border px-4 text-[13px] font-semibold shadow-sm transition-all"
                style={{ borderColor: "var(--line)", color: "var(--teal-800)", background: "var(--paper)" }}
              >
                Share admin access
              </Link>
            )}
            <Link
              href="/app/admin/communities"
              className="inline-flex h-9 items-center rounded-xl px-4 text-[13px] font-semibold text-white shadow-sm transition-all"
              style={{ background: "var(--teal-800)" }}
            >
              Manage communities
            </Link>
          </div>
        }
      />

      <div className="mx-auto w-full max-w-5xl px-4 py-7 pb-24">
        <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.15em]" style={{ color: "var(--muted)" }}>
          Communities
        </p>
        <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatTile
            label="HOA communities"
            value={overview.hoaCommunities}
            hint="Active"
            href="/app/admin/communities?type=hoa"
          />
          <StatTile
            label="Neighborhoods"
            value={overview.neighborhoodCommunities}
            hint="Location-based"
            href="/app/admin/communities?type=neighborhood"
            accent="var(--navy-500)"
          />
          <StatTile
            label="Without a manager"
            value={overview.communitiesWithoutManager}
            hint="Needs an assignment"
            href="/app/admin/communities?managerState=unassigned"
            accent={
              overview.communitiesWithoutManager > 0 ? "var(--gold-600)" : "var(--teal-800)"
            }
          />
          <StatTile
            label="Archived"
            value={overview.archivedCommunities}
            hint="Retained for history"
            href="/app/admin/communities?status=archived"
            accent="var(--ink-400)"
          />
        </div>

        <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.15em]" style={{ color: "var(--muted)" }}>
          People
        </p>
        <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatTile label="Homeowners" value={overview.homeowners} hint="All accounts" />
          <StatTile
            label="Active memberships"
            value={overview.activeMemberships}
            hint={`Across ${totalCommunities} communit${totalCommunities === 1 ? "y" : "ies"}`}
            accent="var(--navy-500)"
          />
          <StatTile
            label="Pending HOA invites"
            value={overview.pendingHoaInvitations}
            hint="Waiting for email acceptance"
            accent={overview.pendingHoaInvitations > 0 ? "var(--gold-600)" : "var(--teal-800)"}
          />
          <StatTile
            label="Suspended providers"
            value={overview.providersByStatus.suspended}
            hint="Cannot bid"
            href="/app/admin/providers?status=suspended"
            accent={
              overview.providersByStatus.suspended > 0 ? "var(--danger-600)" : "var(--teal-800)"
            }
          />
        </div>

        <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.15em]" style={{ color: "var(--muted)" }}>
          Providers
        </p>
        <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatTile
            label="Pending review"
            value={overview.providersByStatus.pending}
            hint="Not yet activated"
            href="/app/admin/providers?status=pending"
            accent={overview.providersByStatus.pending > 0 ? "var(--gold-600)" : "var(--teal-800)"}
          />
          <StatTile
            label="Active"
            value={overview.providersByStatus.active}
            hint="Can bid"
            href="/app/admin/providers?status=active"
          />
          <StatTile
            label="Unverified credentials"
            value={overview.providersAwaitingVerification}
            hint="Licence or insurance"
            href="/app/admin/providers?verification=unverified"
            accent="var(--navy-500)"
          />
          <StatTile
            label="Audit entries shown"
            value={overview.recentAudit.length}
            hint="Most recent actions"
            href="/app/admin/audit"
            accent="var(--ink-400)"
          />
        </div>

        <SectionCard
          title="Recent admin activity"
          subtitle="Every sensitive change, in the order it happened"
          action={
            <Link href="/app/admin/audit" className="text-[12px] font-semibold" style={{ color: "var(--teal-800)" }}>
              View audit log →
            </Link>
          }
        >
          {overview.recentAudit.length === 0 ? (
            <AdminEmptyState
              title="No admin actions recorded yet"
              body="Creating a community or changing a provider's status will appear here."
            />
          ) : (
            <ul className="space-y-3">
              {overview.recentAudit.map((entry) => (
                <li key={entry.id} className="flex flex-wrap items-center justify-between gap-3">
                  {entry.actor ? (
                    <PersonLine
                      person={entry.actor}
                      size={32}
                      meta={
                        <>
                          {entry.summary}
                          {entry.communityName ? ` · ${entry.communityName}` : ""}
                        </>
                      }
                    />
                  ) : (
                    <span className="text-[13px]" style={{ color: "var(--ink-900)" }}>
                      {entry.summary}
                    </span>
                  )}
                  <time className="text-[11px]" style={{ color: "var(--muted)" }}>
                    {formatDateTime(entry.createdAt)}
                  </time>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
