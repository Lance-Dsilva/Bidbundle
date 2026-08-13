import { redirect } from "next/navigation";

import { requireRole } from "@/lib/server/auth";
import { listManagedCommunities, resolveViewerContext } from "@/lib/server/communities";
import { initialsFromName } from "@/lib/display-name";

export const dynamic = "force-dynamic";

/**
 * The community-management section of the homeowner dashboard.
 *
 * This is a conditional part of the ordinary homeowner experience, not a
 * separate account type: there is no `/hoa-manager` or `/neighborhood-manager`
 * application, and a resident with no scoped role is simply sent back to their
 * dashboard.
 *
 * Authorization happens here, on the server, from live assignments —
 * `listManagedCommunities` scopes its reads to the communities this account
 * actually holds a role in. Hiding the nav link does none of that work.
 *
 * Read-only for this release. Bundleen admin assignment and enforcement are
 * the priority, and inventing manager write powers before they are specified
 * would be guessing at product.
 */
export default async function HomeownerCommunityPage() {
  const user = await requireRole(["homeowner"], "/app/homeowner/community");

  const [context, managed] = await Promise.all([
    resolveViewerContext(user),
    listManagedCommunities(user.id),
  ]);

  // Not a manager: nothing here belongs to them, so send them home rather than
  // showing an empty management screen they cannot use.
  if (managed.length === 0) redirect("/app/homeowner/dashboard");

  return (
    <div className="space-y-6">
      <header>
        <span className="bb-eyebrow">{context.roleLabel}</span>
        <h1 className="bb-page-heading">My community</h1>
        <p className="bb-page-subtitle">
          A read-only view of the communities you help run. Bundleen staff make every membership
          and role change; contact them to add or remove someone.
        </p>
      </header>

      {managed.map(({ community, roleLabels, members }) => {
        const active = members;

        return (
          <section className="bb-card bb-card-pad" key={community.id}>
            <div className="bb-card-header">
              <div>
                <h2 className="bb-card-title">{community.name}</h2>
                <p className="bb-card-copy">
                  {community.type === "hoa" ? "Official HOA" : "Location-based neighborhood"} ·{" "}
                  {roleLabels.join(" and ")}
                </p>
              </div>
              <span className="bb-live-pill">
                {active.length} member{active.length === 1 ? "" : "s"}
              </span>
            </div>

            <dl className="grid grid-cols-2 gap-4 md:grid-cols-3">
              <Stat label="Active members" value={String(active.length)} />
              <Stat label="Pending members" value={String(community.pendingMemberCount)} />
              <Stat
                label="Current manager"
                value={community.manager?.user.fullName ?? "Not assigned"}
              />
            </dl>

            <h3
              className="mt-6 text-[12px] font-bold uppercase tracking-[0.15em]"
              style={{ color: "var(--muted)" }}
            >
              Members
            </h3>
            <ul className="mt-3 space-y-2">
              {active.map((member) => (
                <li
                  key={member.user.id}
                  className="flex items-center gap-3 rounded-xl border p-3"
                  style={{ borderColor: "var(--line)" }}
                >
                  <span
                    aria-hidden="true"
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold"
                    style={{ background: "var(--teal-50)", color: "var(--teal-800)" }}
                  >
                    {member.user.initials || initialsFromName(member.user.fullName)}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-[14px] font-semibold" style={{ color: "var(--ink-900)" }}>
                      {member.user.fullName}
                    </p>
                    {/* Neighbours' street addresses and coordinates are never
                        shown here. A manager needs to know who, not where. */}
                    <p className="truncate text-[12px]" style={{ color: "var(--muted)" }}>
                      Member since{" "}
                      {member.joinedAt
                        ? new Date(member.joinedAt).toLocaleDateString(undefined, {
                            month: "short",
                            year: "numeric",
                          })
                        : "—"}
                    </p>
                  </div>
                </li>
              ))}
            </ul>

            {community.pendingMemberCount > 0 && (
              <p className="mt-4 text-[12px]" style={{ color: "var(--muted)" }}>
                {community.pendingMemberCount} membership{community.pendingMemberCount === 1 ? "" : "s"} awaiting Bundleen
                review.
              </p>
            )}
          </section>
        );
      })}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-[0.12em]" style={{ color: "var(--muted)" }}>
        {label}
      </dt>
      <dd className="mt-1 text-[15px] font-semibold" style={{ color: "var(--ink-900)" }}>
        {value}
      </dd>
    </div>
  );
}
