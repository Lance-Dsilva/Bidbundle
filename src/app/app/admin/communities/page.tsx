import Link from "next/link";

import { CommunityCreateForm } from "@/components/admin/CommunityCreateForm";
import { CommunityFilters } from "@/components/admin/CommunityFilters";
import {
  AdminEmptyState,
  SectionCard,
  StatusPill,
} from "@/components/admin/AdminPrimitives";
import { AppPageHeader } from "@/components/layout/AppPageHeader";
import { requireRole } from "@/lib/server/auth";
import { listCommunities } from "@/lib/server/communities";
import { communityListQuerySchema, searchParamsToObject } from "@/lib/validation/community";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * Community list.
 *
 * Filters live in the URL rather than in component state so a filtered view is
 * linkable and survives a refresh — the overview tiles link straight into
 * `?managerState=unassigned`, which is only useful if the page reads it.
 */
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

  return (
    <div className="flex flex-col">
      <AppPageHeader
        title="Communities"
        subtitle={`${total} communit${total === 1 ? "y" : "ies"} match this view`}
      />

      <div className="mx-auto w-full max-w-5xl space-y-5 px-4 py-7 pb-24">
        <CommunityFilters query={query} />

        {communities.length === 0 ? (
          <AdminEmptyState
            title={hasFilters ? "No communities match these filters" : "No communities yet"}
            body={
              hasFilters
                ? "Clear a filter to widen the search."
                : "Create the first HOA or location-based neighborhood to start assigning members and managers."
            }
          />
        ) : (
          <ul className="space-y-3">
            {communities.map((community) => (
              <li key={community.id}>
                <Link
                  href={`/app/admin/communities/${community.id}`}
                  className="block rounded-2xl border p-4 shadow-card transition-all hover:-translate-y-0.5 hover:shadow-card-hover"
                  style={{ background: "var(--paper)", borderColor: "var(--line)" }}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-[15px] font-semibold" style={{ color: "var(--ink-900)" }}>
                          {community.name}
                        </p>
                        <StatusPill
                          label={community.type === "hoa" ? "HOA" : "Neighborhood"}
                          tone={community.type === "hoa" ? "info" : "positive"}
                          withDot={false}
                        />
                        {community.status === "archived" && (
                          <StatusPill label="Archived" tone="neutral" />
                        )}
                      </div>
                      <p className="mt-1 text-[12px]" style={{ color: "var(--muted)" }}>
                        {community.activeMemberCount} active
                        {community.pendingMemberCount > 0
                          ? ` · ${community.pendingMemberCount} pending`
                          : ""}
                        {community.radiusMiles !== null
                          ? ` · ${community.radiusMiles} mi radius`
                          : ""}
                        {community.hoaTeamCount > 0 ? ` · ${community.hoaTeamCount} team` : ""}
                      </p>
                    </div>

                    {community.manager ? (
                      <div className="text-right">
                        <p className="text-[12px] font-semibold" style={{ color: "var(--ink-900)" }}>
                          {community.manager.user.fullName}
                        </p>
                        <p className="text-[11px]" style={{ color: "var(--muted)" }}>
                          {community.manager.roleLabel}
                        </p>
                      </div>
                    ) : (
                      <StatusPill label="No manager" tone="warning" />
                    )}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}

        {lastPage > 1 && (
          <nav className="flex items-center justify-between" aria-label="Community pages">
            {query.page > 1 ? <Link href={pageHref(query.page - 1)}>← Previous</Link> : <span />}
            <span className="text-[12px]" style={{ color: "var(--muted)" }}>Page {query.page} of {lastPage}</span>
            {query.page < lastPage ? <Link href={pageHref(query.page + 1)}>Next →</Link> : <span />}
          </nav>
        )}

        <SectionCard
          title="Create a community"
          subtitle="An HOA needs only a name. A location-based neighborhood needs a centre point and a radius."
        >
          <CommunityCreateForm />
        </SectionCard>
      </div>
    </div>
  );
}
