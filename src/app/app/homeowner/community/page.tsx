import { redirect } from "next/navigation";
import Link from "next/link";

import { ResidentHoaWorkspace } from "@/components/hoa/ResidentHoaWorkspace";
import { requireRole } from "@/lib/server/auth";
import { listManagedCommunities, resolveViewerContext } from "@/lib/server/communities";
import { getResidentHoaHub } from "@/lib/server/hoa-market";
import { initialsFromName } from "@/lib/display-name";

export const dynamic = "force-dynamic";

/**
 * Community hub for ordinary HOA residents and neighborhood managers.
 *
 * Authorization happens here, on the server, from live assignments —
 * `listManagedCommunities` scopes its reads to the communities this account
 * actually holds a role in. Hiding the nav link does none of that work.
 *
 * HOA management itself lives in `/app/hoa/**`; this route never grants those
 * powers merely because someone is an HOA resident.
 */
export default async function HomeownerCommunityPage() {
  const user = await requireRole(["homeowner"], "/app/homeowner/community");

  const [context, managed, residentHoa] = await Promise.all([
    resolveViewerContext(user),
    listManagedCommunities(user.id),
    getResidentHoaHub(user.id),
  ]);

  // A homeowner with neither resident HOA content nor a scoped management role
  // has no community hub to render.
  if (managed.length === 0 && residentHoa.communities.length === 0) {
    redirect("/app/homeowner/dashboard");
  }

  const neighborhoodManagement = managed.filter((item) => item.community.type === "neighborhood");
  const managesHoa = managed.some((item) => item.community.type === "hoa");

  return (
    <div className="space-y-6">
      <header>
        <span className="bb-eyebrow">{context.roleLabel}</span>
        <h1 className="bb-page-heading">My community</h1>
        <p className="bb-page-subtitle">
          See HOA-wide requests and surveys, or review the neighborhood you help manage.
        </p>
      </header>

      {managesHoa ? (
        <div className="rounded-xl border border-[var(--line)] bg-[var(--teal-50)] p-4">
          <p className="text-sm text-[var(--ink-700)]">HOA operations use the dedicated manager dashboard.</p>
          <Link className="mt-2 inline-flex text-sm font-semibold text-[var(--teal-800)]" href="/app/hoa/dashboard">Open HOA manager dashboard →</Link>
        </div>
      ) : null}

      <ResidentHoaWorkspace hub={residentHoa} />

      {neighborhoodManagement.map(({ community, roleLabels, members }) => {
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
