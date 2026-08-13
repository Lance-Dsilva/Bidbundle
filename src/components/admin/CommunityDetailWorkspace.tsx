"use client";

import { useCallback, useEffect, useState } from "react";

import {
  AdminEmptyState,
  formatDate,
  PersonLine,
  SectionCard,
  StatusPill,
} from "@/components/admin/AdminPrimitives";
import {
  addCommunityMember,
  AdminRequestError,
  assignStaffRole,
  fetchHomeownerCandidates,
  fetchStaffCandidates,
  revokeStaffAssignment,
  updateCommunity,
  updateCommunityMember,
} from "@/lib/admin-client";
import type { CommunityDetail, StaffCandidate } from "@/lib/community-types";
import {
  STAFF_ROLE_LABELS,
  type CommunityStaffRole,
  type MembershipStatus,
} from "@/lib/validation/community";

/** Thrown when an admin declines a confirmation dialog. Not an error. */
class Cancelled extends Error {}

/**
 * The interactive half of the community detail page.
 *
 * Holds the latest payload rather than calling `router.refresh()` after every
 * action: each mutating endpoint answers with the whole refreshed community,
 * so a successful assignment updates members, staff, and counts together and
 * cannot leave two panels disagreeing with each other.
 *
 * Nothing here is a permission check. The manager picker only *offers* active
 * residents because the server only returns active residents; submitting
 * anyone else is refused by `assertCanAssignStaffRole` regardless of what this
 * component allowed.
 */
export function CommunityDetailWorkspace({ initialDetail }: { initialDetail: CommunityDetail }) {
  const [detail, setDetail] = useState(initialDetail);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const { community, members, staff } = detail;

  /**
   * One place for every mutation: it serialises actions through `busyKey` so a
   * second click while a request is in flight is dropped, and it funnels every
   * server message into the same banner. Declining a confirmation dialog
   * raises {@link Cancelled}, which leaves no error on screen — the admin
   * already knows they said no.
   */
  const run = useCallback(
    async (key: string, action: () => Promise<CommunityDetail>): Promise<boolean> => {
      if (busyKey) return false;
      setBusyKey(key);
      setError(null);

      try {
        setDetail(await action());
        return true;
      } catch (caught) {
        if (caught instanceof Cancelled) return false;
        setError(
          caught instanceof AdminRequestError
            ? caught.message
            : "Something went wrong. Please try again.",
        );
        return false;
      } finally {
        setBusyKey(null);
      }
    },
    [busyKey],
  );

  const managerRole: CommunityStaffRole =
    community.type === "neighborhood" ? "neighborhood_manager" : "hoa_manager";

  const activeMembers = members.filter((member) => member.status === "active");
  const pendingMembers = members.filter((member) => member.status === "pending");
  const removedMembers = members.filter((member) => member.status === "removed");

  return (
    <div className="space-y-5">
      {error && (
        <p
          role="alert"
          className="rounded-xl px-4 py-3 text-[13px]"
          style={{ background: "#FEF3F2", color: "var(--danger-600)" }}
        >
          {error}
        </p>
      )}

      <SectionCard
        title="Community"
        subtitle="Location and radius are Bundleen-staff settings; they are not exposed to customers."
        action={
          <button
            type="button"
            disabled={busyKey !== null}
            onClick={() =>
              run("archive", async () => {
                const next = community.status === "archived" ? "active" : "archived";
                if (
                  next === "archived" &&
                  !window.confirm(
                    `Archive ${community.name}? Members and history are kept, but no new assignments can be made.`,
                  )
                ) {
                  throw new Cancelled();
                }
                return updateCommunity(community.id, { status: next });
              })
            }
            className="rounded-xl border px-3 py-1.5 text-[12px] font-semibold disabled:opacity-60"
            style={{ borderColor: "var(--line)", color: "var(--ink-700)" }}
          >
            {community.status === "archived" ? "Restore" : "Archive"}
          </button>
        }
      >
        <dl className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Field label="Type" value={community.type === "hoa" ? "Official HOA" : "Neighborhood"} />
          <Field
            label="Status"
            value={community.status === "active" ? "Active" : "Archived"}
          />
          <Field
            label="Members"
            value={`${community.activeMemberCount} active · ${community.pendingMemberCount} pending`}
          />
          <Field label="Created" value={formatDate(community.createdAt)} />
        </dl>

        {community.type === "neighborhood" && (
          <GeometryEditor
            detail={detail}
            busy={busyKey !== null}
            onSave={(body) => run("geometry", () => updateCommunity(community.id, body))}
          />
        )}
      </SectionCard>

      <SectionCard
        title={community.type === "neighborhood" ? "Neighborhood manager" : "HOA manager and team"}
        subtitle={
          community.type === "neighborhood"
            ? "Only active members of this neighborhood can be its manager, and only one holds it at a time."
            : "HOA managers and team members do not have to live in the HOA."
        }
      >
        {staff.length === 0 ? (
          <AdminEmptyState
            title="No roles assigned"
            body="Assign a manager below. Bundleen staff make every assignment; nobody can promote themselves."
          />
        ) : (
          <ul className="space-y-3">
            {staff.map((assignment) => (
              <li
                key={assignment.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3"
                style={{ borderColor: "var(--line)" }}
              >
                <PersonLine
                  person={assignment.user}
                  size={36}
                  meta={
                    <>
                      {assignment.roleLabel} · assigned {formatDate(assignment.assignedAt)}
                      {assignment.assignedBy ? ` by ${assignment.assignedBy.fullName}` : ""}
                    </>
                  }
                />
                <div className="flex items-center gap-2">
                  {assignment.role === "neighborhood_manager" && (
                    <StatusPill
                      label={assignment.isResidentMember ? "Resident" : "Not a resident"}
                      tone={assignment.isResidentMember ? "positive" : "danger"}
                    />
                  )}
                  <button
                    type="button"
                    disabled={busyKey !== null}
                    onClick={() =>
                      run(`revoke-${assignment.id}`, async () => {
                        if (
                          !window.confirm(
                            `Revoke ${assignment.roleLabel} from ${assignment.user.fullName}?`,
                          )
                        ) {
                          throw new Cancelled();
                        }
                        return revokeStaffAssignment(community.id, assignment.id);
                      })
                    }
                    className="rounded-xl border px-3 py-1.5 text-[12px] font-semibold disabled:opacity-60"
                    style={{ borderColor: "var(--line)", color: "var(--danger-600)" }}
                  >
                    Revoke
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {community.status === "active" && (
          <AssignRoleForm
            communityId={community.id}
            communityType={community.type}
            managerRole={managerRole}
            hasManager={community.manager !== null}
            busy={busyKey !== null}
            onAssign={(body) =>
              run("assign", () => assignStaffRole(community.id, body))
            }
          />
        )}
      </SectionCard>

      <MemberSection
        title="Active members"
        emptyTitle="No active members"
        emptyBody="Add a homeowner below, or let the radius matcher place them once they verify an address."
        members={activeMembers}
        communityId={community.id}
        busy={busyKey !== null}
        run={run}
      />

      {pendingMembers.length > 0 && (
        <MemberSection
          title="Pending members"
          emptyTitle=""
          emptyBody=""
          members={pendingMembers}
          communityId={community.id}
          busy={busyKey !== null}
          run={run}
        />
      )}

      {removedMembers.length > 0 && (
        <MemberSection
          title="Removed members"
          emptyTitle=""
          emptyBody=""
          members={removedMembers}
          communityId={community.id}
          busy={busyKey !== null}
          run={run}
        />
      )}

      {community.status === "active" && (
        <SectionCard
          title="Add a member"
          subtitle="Only homeowner accounts can be members. The server recalculates the distance itself and records a manual placement as an override."
        >
          <AddMemberForm
            communityId={community.id}
            busy={busyKey !== null}
            onAdd={(body) => run("add-member", () => addCommunityMember(community.id, body))}
          />
        </SectionCard>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-[0.12em]" style={{ color: "var(--muted)" }}>
        {label}
      </dt>
      <dd className="mt-1 text-[13px] font-semibold" style={{ color: "var(--ink-900)" }}>
        {value}
      </dd>
    </div>
  );
}

const MEMBER_STATUS_TONE: Record<MembershipStatus, "positive" | "warning" | "neutral"> = {
  active: "positive",
  pending: "warning",
  removed: "neutral",
};

type RunFn = (key: string, action: () => Promise<CommunityDetail>) => Promise<boolean>;

function MemberSection({
  title,
  emptyTitle,
  emptyBody,
  members,
  communityId,
  busy,
  run,
}: {
  title: string;
  emptyTitle: string;
  emptyBody: string;
  members: CommunityDetail["members"];
  communityId: string;
  busy: boolean;
  run: RunFn;
}) {
  return (
    <SectionCard title={title} subtitle={`${members.length} member${members.length === 1 ? "" : "s"}`}>
      {members.length === 0 ? (
        <AdminEmptyState title={emptyTitle} body={emptyBody} />
      ) : (
        <ul className="space-y-2">
          {members.map((member) => (
            <li
              key={member.membershipId}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3"
              style={{ borderColor: "var(--line)" }}
            >
              <PersonLine
                person={member.user}
                size={36}
                meta={
                  <>
                    {member.user.email}
                    {member.joinedAt ? ` · joined ${formatDate(member.joinedAt)}` : ""}
                  </>
                }
              />

              <div className="flex flex-wrap items-center gap-2">
                {member.staffRoles.map((role) => (
                  <StatusPill key={role} label={STAFF_ROLE_LABELS[role]} tone="info" withDot={false} />
                ))}

                {/* Eligibility, never a street address. `null` means the
                    homeowner has no stored coordinates to judge. */}
                {member.isWithinRadius === true && (
                  <StatusPill
                    label={member.distanceMi !== null ? `${member.distanceMi} mi` : "In radius"}
                    tone="positive"
                  />
                )}
                {member.isWithinRadius === false && (
                  <StatusPill
                    label={
                      member.distanceMi !== null
                        ? `${member.distanceMi} mi — outside`
                        : "Outside radius"
                    }
                    tone="danger"
                  />
                )}
                {member.isWithinRadius === null && (
                  <StatusPill label="No location on file" tone="neutral" />
                )}

                {member.isAdminOverride && (
                  <StatusPill label="Admin override" tone="warning" withDot={false} />
                )}

                <StatusPill
                  label={member.status[0].toUpperCase() + member.status.slice(1)}
                  tone={MEMBER_STATUS_TONE[member.status]}
                />

                {member.status !== "active" && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      run(`activate-${member.membershipId}`, () =>
                        updateCommunityMember(communityId, member.membershipId, {
                          status: "active",
                        }),
                      )
                    }
                    className="rounded-xl px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-60"
                    style={{ background: "var(--teal-800)" }}
                  >
                    {member.status === "pending" ? "Approve" : "Reinstate"}
                  </button>
                )}

                {member.status !== "removed" && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      run(`remove-${member.membershipId}`, async () => {
                        const warning = member.staffRoles.includes("neighborhood_manager")
                          ? `${member.user.fullName} is this neighborhood's manager. Removing their membership also revokes that role. Continue?`
                          : `Remove ${member.user.fullName} from this community?`;
                        if (!window.confirm(warning)) {
                          throw new Cancelled();
                        }
                        return updateCommunityMember(communityId, member.membershipId, {
                          status: "removed",
                        });
                      })
                    }
                    className="rounded-xl border px-3 py-1.5 text-[12px] font-semibold disabled:opacity-60"
                    style={{ borderColor: "var(--line)", color: "var(--danger-600)" }}
                  >
                    Remove
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

/** Centre point and radius. Neighborhood communities only. */
function GeometryEditor({
  detail,
  busy,
  onSave,
}: {
  detail: CommunityDetail;
  busy: boolean;
  onSave: (body: {
    centerLatitude: number;
    centerLongitude: number;
    radiusMiles: number;
  }) => Promise<boolean>;
}) {
  const { community } = detail;
  const [latitude, setLatitude] = useState(String(community.centerLatitude ?? ""));
  const [longitude, setLongitude] = useState(String(community.centerLongitude ?? ""));
  const [radius, setRadius] = useState(String(community.radiusMiles ?? ""));

  useEffect(() => {
    setLatitude(String(community.centerLatitude ?? ""));
    setLongitude(String(community.centerLongitude ?? ""));
    setRadius(String(community.radiusMiles ?? ""));
  }, [community.centerLatitude, community.centerLongitude, community.radiusMiles]);

  const inputClass = "h-9 w-full rounded-xl border px-3 text-[13px] outline-none";
  const inputStyle = {
    background: "var(--paper)",
    borderColor: "var(--line)",
    color: "var(--ink-900)",
  };

  return (
    <form
      className="mt-5 grid items-end gap-3 border-t pt-4 md:grid-cols-4"
      style={{ borderColor: "var(--line)" }}
      onSubmit={async (event) => {
        event.preventDefault();
        await onSave({
          centerLatitude: Number(latitude),
          centerLongitude: Number(longitude),
          radiusMiles: Number(radius),
        });
      }}
    >
      <label className="block">
        <span className="mb-1 block text-[12px] font-semibold" style={{ color: "var(--ink-900)" }}>
          Centre latitude
        </span>
        <input
          className={inputClass}
          style={inputStyle}
          type="number"
          step="any"
          min={-90}
          max={90}
          value={latitude}
          onChange={(event) => setLatitude(event.target.value)}
          required
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-[12px] font-semibold" style={{ color: "var(--ink-900)" }}>
          Centre longitude
        </span>
        <input
          className={inputClass}
          style={inputStyle}
          type="number"
          step="any"
          min={-180}
          max={180}
          value={longitude}
          onChange={(event) => setLongitude(event.target.value)}
          required
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-[12px] font-semibold" style={{ color: "var(--ink-900)" }}>
          Radius (miles)
        </span>
        <input
          className={inputClass}
          style={inputStyle}
          type="number"
          step="0.1"
          min={0.1}
          max={100}
          value={radius}
          onChange={(event) => setRadius(event.target.value)}
          required
        />
      </label>
      <button
        type="submit"
        disabled={busy}
        className="h-9 rounded-xl px-4 text-[13px] font-semibold text-white disabled:opacity-60"
        style={{ background: "var(--teal-800)" }}
      >
        Save location
      </button>
    </form>
  );
}

/**
 * Role assignment.
 *
 * The candidate list is fetched per role, so choosing "Neighborhood manager"
 * asks the server for that community's active residents and nothing wider.
 * Replacing a sitting manager requires ticking the confirmation, which the
 * server also insists on.
 */
function AssignRoleForm({
  communityId,
  communityType,
  managerRole,
  hasManager,
  busy,
  onAssign,
}: {
  communityId: string;
  communityType: "hoa" | "neighborhood";
  managerRole: CommunityStaffRole;
  hasManager: boolean;
  busy: boolean;
  onAssign: (body: {
    userId: string;
    role: CommunityStaffRole;
    replaceExistingManager?: boolean;
  }) => Promise<boolean>;
}) {
  const [role, setRole] = useState<CommunityStaffRole>(managerRole);
  const [search, setSearch] = useState("");
  const [candidates, setCandidates] = useState<StaffCandidate[]>([]);
  const [userId, setUserId] = useState("");
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    const timer = setTimeout(async () => {
      try {
        const { candidates: next } = await fetchStaffCandidates(communityId, role, search);
        if (!cancelled) {
          setCandidates(next);
          // Drop a selection that the new role no longer offers, so the form
          // cannot submit somebody the server would refuse.
          setUserId((current) => (next.some((c) => c.id === current) ? current : ""));
        }
      } catch {
        if (!cancelled) setCandidates([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [communityId, role, search]);

  const roleOptions: CommunityStaffRole[] =
    communityType === "neighborhood" ? ["neighborhood_manager"] : ["hoa_manager", "hoa_team"];

  const replacingManager = hasManager && role === managerRole;

  const inputClass = "h-9 w-full rounded-xl border px-3 text-[13px] outline-none";
  const inputStyle = {
    background: "var(--paper)",
    borderColor: "var(--line)",
    color: "var(--ink-900)",
  };

  return (
    <form
      className="mt-5 space-y-3 border-t pt-4"
      style={{ borderColor: "var(--line)" }}
      onSubmit={async (event) => {
        event.preventDefault();
        if (!userId) return;

        const person = candidates.find((candidate) => candidate.id === userId);
        if (
          replacingManager &&
          !window.confirm(
            `Assign ${person?.fullName ?? "this member"} as ${STAFF_ROLE_LABELS[role]}? The current manager's role is revoked at the same time.`,
          )
        ) {
          return;
        }

        const succeeded = await onAssign({
          userId,
          role,
          ...(replacingManager ? { replaceExistingManager: confirmReplace } : {}),
        });

        if (succeeded) {
          setUserId("");
          setConfirmReplace(false);
          setSearch("");
        }
      }}
    >
      <div className="grid gap-3 md:grid-cols-3">
        <label className="block">
          <span className="mb-1 block text-[12px] font-semibold" style={{ color: "var(--ink-900)" }}>
            Role
          </span>
          <select
            className={inputClass}
            style={inputStyle}
            value={role}
            onChange={(event) => setRole(event.target.value as CommunityStaffRole)}
          >
            {roleOptions.map((option) => (
              <option key={option} value={option}>
                {STAFF_ROLE_LABELS[option]}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-[12px] font-semibold" style={{ color: "var(--ink-900)" }}>
            Search
          </span>
          <input
            className={inputClass}
            style={inputStyle}
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={
              role === "neighborhood_manager" ? "Active members only" : "Any homeowner account"
            }
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-[12px] font-semibold" style={{ color: "var(--ink-900)" }}>
            Person
          </span>
          <select
            className={inputClass}
            style={inputStyle}
            value={userId}
            onChange={(event) => setUserId(event.target.value)}
            required
          >
            <option value="">
              {loading
                ? "Loading…"
                : candidates.length === 0
                  ? "No eligible accounts"
                  : "Choose a person"}
            </option>
            {candidates.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.fullName} — {candidate.email}
              </option>
            ))}
          </select>
        </label>
      </div>

      {role === "neighborhood_manager" && (
        <p className="text-[11px]" style={{ color: "var(--muted)" }}>
          This list contains only active members of this neighborhood. Nobody outside it is
          eligible.
        </p>
      )}

      {replacingManager && (
        <label className="flex items-center gap-2 text-[12px]" style={{ color: "var(--ink-700)" }}>
          <input
            type="checkbox"
            checked={confirmReplace}
            onChange={(event) => setConfirmReplace(event.target.checked)}
          />
          Replace the current manager. Their role is revoked in the same operation.
        </label>
      )}

      <button
        type="submit"
        disabled={busy || !userId || (replacingManager && !confirmReplace)}
        className="inline-flex h-9 items-center rounded-xl px-4 text-[13px] font-semibold text-white disabled:opacity-60"
        style={{ background: "var(--teal-800)" }}
      >
        Assign role
      </button>
    </form>
  );
}

/**
 * Adds a member by Bundleen account id.
 *
 * A deliberately plain input: the portal has no people-search endpoint that
 * would list every homeowner in the product, and building one to fill this
 * field would expose the whole user base to satisfy a rare action.
 */
function AddMemberForm({
  communityId,
  busy,
  onAdd,
}: {
  communityId: string;
  busy: boolean;
  onAdd: (body: {
    userId: string;
    status: "pending" | "active";
    isAdminOverride: boolean;
  }) => Promise<boolean>;
}) {
  const [userId, setUserId] = useState("");
  const [search, setSearch] = useState("");
  const [candidates, setCandidates] = useState<StaffCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<"pending" | "active">("active");
  const [isOverride, setIsOverride] = useState(false);

  const inputClass = "h-9 w-full rounded-xl border px-3 text-[13px] outline-none";
  const inputStyle = {
    background: "var(--paper)",
    borderColor: "var(--line)",
    color: "var(--ink-900)",
  };

  useEffect(() => {
    let cancelled = false;
    if (search.trim().length < 2) {
      setCandidates([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const result = await fetchHomeownerCandidates(communityId, search.trim());
        if (!cancelled) setCandidates(result.candidates);
      } catch {
        if (!cancelled) setCandidates([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [communityId, search]);

  return (
    <form
      className="space-y-3"
      onSubmit={async (event) => {
        event.preventDefault();
        const succeeded = await onAdd({
          userId: userId.trim(),
          status,
          isAdminOverride: isOverride,
        });
        if (succeeded) {
          setUserId("");
          setSearch("");
          setCandidates([]);
          setIsOverride(false);
        }
      }}
    >
      <div className="grid gap-3 md:grid-cols-3">
        <label className="block">
          <span className="mb-1 block text-[12px] font-semibold" style={{ color: "var(--ink-900)" }}>
            Search homeowner
          </span>
          <input
            className={inputClass}
            style={inputStyle}
            type="search"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setUserId("");
            }}
            placeholder="Name or email"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-[12px] font-semibold" style={{ color: "var(--ink-900)" }}>
            Homeowner
          </span>
          <select
            className={inputClass}
            style={inputStyle}
            value={userId}
            onChange={(event) => setUserId(event.target.value)}
            required
          >
            <option value="">
              {loading
                ? "Searching…"
                : search.trim().length < 2
                  ? "Enter at least 2 characters"
                  : candidates.length === 0
                    ? "No homeowners found"
                    : "Choose a homeowner"}
            </option>
            {candidates.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.fullName} — {candidate.email}
                {candidate.membershipStatus ? ` (${candidate.membershipStatus})` : ""}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-[12px] font-semibold" style={{ color: "var(--ink-900)" }}>
            Join state
          </span>
          <select
            className={inputClass}
            style={inputStyle}
            value={status}
            onChange={(event) => setStatus(event.target.value as "pending" | "active")}
          >
            <option value="active">Active</option>
            <option value="pending">Pending</option>
          </select>
        </label>
      </div>

      <label className="flex items-center gap-2 text-[12px]" style={{ color: "var(--ink-700)" }}>
        <input
          type="checkbox"
          checked={isOverride}
          onChange={(event) => setIsOverride(event.target.checked)}
        />
        Manual override — this placement ignores the radius match.
      </label>

      <button
        type="submit"
        disabled={busy || userId.trim() === ""}
        className="inline-flex h-9 items-center rounded-xl px-4 text-[13px] font-semibold text-white disabled:opacity-60"
        style={{ background: "var(--teal-800)" }}
      >
        Add member
      </button>
    </form>
  );
}
