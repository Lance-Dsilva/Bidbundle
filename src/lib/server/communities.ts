import "server-only";

import { randomUUID } from "node:crypto";

import { Prisma } from "@/generated/prisma/client";
import type {
  AdminOverview,
  AdminPersonSummary,
  CommunityDetail,
  CommunityListResult,
  CommunityMemberSummary,
  CommunityStaffAssignmentSummary,
  CommunitySummary,
  CustomerPersonSummary,
  StaffCandidate,
  ViewerContext,
} from "@/lib/community-types";
import {
  assertCanAssignStaffRole,
  assertCanBeMember,
  assertCanRevokeStaffRole,
  assertStaffRoleMatchesCommunity,
  CommunityRuleError,
  staffRolesInvalidatedByMembershipLoss,
  viewerRoleLabel,
} from "@/lib/community-rules";
import { initialsFromName } from "@/lib/display-name";
import {
  coordinateBoundsForRadius,
  isWithinCommunity,
  matchAvailableNeighborhood,
} from "@/lib/geo";
import { buildAuditEntry, serializeAuditEntry } from "@/lib/server/audit";
import { db } from "@/lib/server/db";
import { isAppRole } from "@/lib/validation/auth";
import {
  STAFF_ROLE_LABELS,
  type CommunityListQuery,
  type CommunityStaffRole,
  type CommunityUpdateInput,
  type MembershipCreateInput,
  type MembershipUpdateInput,
  type StaffAssignInput,
} from "@/lib/validation/community";
import {
  COMMUNITY_RADIUS_MI,
  MAX_HOMEOWNERS_PER_NEIGHBORHOOD,
  MIN_HOMEOWNERS_TO_FORM_NEIGHBORHOOD,
} from "@/lib/validation/profile";

/**
 * Community reads and writes for the internal Bundleen portal.
 *
 * Two constraints shape everything here:
 *
 * 1. **No interactive transactions.** Neon's pooled endpoint drops the
 *    long-lived session an interactive `$transaction(async tx => …)` needs —
 *    the signup flow already proved that with `P2028`. Every multi-statement
 *    write below uses the batch form, which the driver sends as one short
 *    transaction with no application round trips inside it. Where a batch
 *    needs the id of a row it is about to create, the id is generated here.
 *
 * 2. **Nothing is trusted from the client.** Distances, radius eligibility,
 *    the acting admin, and every timestamp are computed or read on this side.
 *    A request names *what* to change; the server decides what that means.
 */

/* ── Projections ─────────────────────────────────────────────────────────── */

const personSelect = {
  id: true,
  fullName: true,
  email: true,
  role: true,
  avatarUrl: true,
} as const;

type PersonRow = {
  id: string;
  fullName: string;
  email: string;
  role: string;
  avatarUrl: string | null;
};

export function toPersonSummary(row: PersonRow): AdminPersonSummary {
  return {
    id: row.id,
    fullName: row.fullName,
    initials: initialsFromName(row.fullName),
    email: row.email,
    role: isAppRole(row.role) ? row.role : "homeowner",
    avatarUrl: row.avatarUrl,
  };
}

function toCustomerPersonSummary(
  row: Pick<PersonRow, "id" | "fullName" | "avatarUrl">,
): CustomerPersonSummary {
  return {
    id: row.id,
    fullName: row.fullName,
    initials: initialsFromName(row.fullName),
    avatarUrl: row.avatarUrl,
  };
}

const staffSelect = {
  id: true,
  role: true,
  status: true,
  assignedAt: true,
  user: { select: personSelect },
  assignedBy: { select: personSelect },
} as const;

/**
 * Members are selected with coordinates but never serialized with them — the
 * portal is told whether someone is inside the radius and roughly how far,
 * which is what a membership decision needs, and nothing more.
 */
const memberSelect = {
  id: true,
  status: true,
  joinedAt: true,
  isPrimary: true,
  isAdminOverride: true,
  user: {
    select: { ...personSelect, latitude: true, longitude: true },
  },
} as const;

const communitySelect = {
  id: true,
  name: true,
  type: true,
  status: true,
  centerLatitude: true,
  centerLongitude: true,
  radiusMiles: true,
  createdAt: true,
} as const;

type CommunityRow = {
  id: string;
  name: string;
  type: string;
  status: string;
  centerLatitude: number | null;
  centerLongitude: number | null;
  radiusMiles: number | null;
  createdAt: Date;
};

type StaffRow = {
  id: string;
  role: string;
  status: string;
  assignedAt: Date;
  user: PersonRow;
  assignedBy: PersonRow | null;
};

function serializeStaff(row: StaffRow, activeMemberIds: ReadonlySet<string>): CommunityStaffAssignmentSummary {
  const role = row.role as CommunityStaffRole;
  return {
    id: row.id,
    role,
    roleLabel: STAFF_ROLE_LABELS[role] ?? row.role,
    user: toPersonSummary(row.user),
    assignedAt: row.assignedAt.toISOString(),
    assignedBy: row.assignedBy ? toPersonSummary(row.assignedBy) : null,
    isResidentMember: activeMemberIds.has(row.user.id),
  };
}

function serializeCommunity(
  row: CommunityRow,
  counts: {
    activeMemberCount: number;
    pendingMemberCount: number;
    hoaTeamCount: number;
    manager: CommunityStaffAssignmentSummary | null;
  },
): CommunitySummary {
  return {
    id: row.id,
    name: row.name,
    type: row.type as CommunitySummary["type"],
    status: row.status as CommunitySummary["status"],
    centerLatitude: row.centerLatitude,
    centerLongitude: row.centerLongitude,
    radiusMiles: row.radiusMiles,
    createdAt: row.createdAt.toISOString(),
    ...counts,
  };
}

/**
 * "Has a manager" means an active `neighborhood_manager` or `hoa_manager`.
 * `hoa_team` is deliberately excluded: a team member is help, not leadership,
 * so a community with only team members still counts as unmanaged.
 */
const MANAGER_ASSIGNMENT_FILTER: Prisma.CommunityStaffAssignmentWhereInput = {
  status: "active",
  role: { in: ["neighborhood_manager", "hoa_manager"] },
};

/* ── Reads ───────────────────────────────────────────────────────────────── */

/**
 * Paged community list with search and filters.
 *
 * `managerState` cannot be expressed as a column filter — "has no active
 * manager" is a fact about a related table — so it is applied after the page
 * is fetched only when requested, and the total is recomputed from a matching
 * count query rather than guessed.
 */
export async function listCommunities(query: CommunityListQuery): Promise<CommunityListResult> {
  const managerFilter = MANAGER_ASSIGNMENT_FILTER;

  const where: Prisma.CommunityWhereInput = {
    ...(query.search ? { name: { contains: query.search, mode: "insensitive" } } : {}),
    ...(query.type ? { type: query.type } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.managerState === "assigned"
      ? { staffAssignments: { some: managerFilter } }
      : query.managerState === "unassigned"
        ? { staffAssignments: { none: managerFilter } }
        : {}),
  };

  const [total, rows] = await Promise.all([
    db.community.count({ where }),
    db.community.findMany({
      where,
      select: {
        ...communitySelect,
        memberships: { where: { status: { in: ["active", "pending"] } }, select: { status: true } },
        staffAssignments: { where: { status: "active" }, select: staffSelect },
      },
      orderBy: [{ status: "asc" }, { name: "asc" }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);

  const communities = rows.map((row) => {
    // The list query does not load which users hold a membership, so residency
    // is reported as unknown here and resolved on the detail page. Better an
    // absent badge than one the data does not support.
    const residencyUnknown: ReadonlySet<string> = new Set();

    const manager = row.staffAssignments.find(
      (assignment) =>
        assignment.role === "neighborhood_manager" || assignment.role === "hoa_manager",
    );

    return serializeCommunity(row, {
      activeMemberCount: row.memberships.filter((m) => m.status === "active").length,
      pendingMemberCount: row.memberships.filter((m) => m.status === "pending").length,
      hoaTeamCount: row.staffAssignments.filter((a) => a.role === "hoa_team").length,
      manager: manager ? serializeStaff(manager, residencyUnknown) : null,
    });
  });

  return { communities, total, page: query.page, pageSize: query.pageSize };
}

export async function getCommunityDetail(communityId: string): Promise<CommunityDetail | null> {
  const row = await db.community.findUnique({
    where: { id: communityId },
    select: {
      ...communitySelect,
      memberships: {
        select: memberSelect,
        orderBy: [{ status: "asc" }, { createdAt: "asc" }],
      },
      staffAssignments: {
        where: { status: "active" },
        select: staffSelect,
        orderBy: { assignedAt: "desc" },
      },
    },
  });

  if (!row) return null;

  const activeMemberIds = new Set(
    row.memberships.filter((m) => m.status === "active").map((m) => m.user.id),
  );

  const staffRolesByUser = new Map<string, CommunityStaffRole[]>();
  for (const assignment of row.staffAssignments) {
    const roles = staffRolesByUser.get(assignment.user.id) ?? [];
    roles.push(assignment.role as CommunityStaffRole);
    staffRolesByUser.set(assignment.user.id, roles);
  }

  const members: CommunityMemberSummary[] = row.memberships.map((membership) => {
    const { isWithinRadius, distanceMi } = isWithinCommunity(
      membership.user.latitude !== null && membership.user.longitude !== null
        ? { latitude: membership.user.latitude, longitude: membership.user.longitude }
        : null,
      row,
    );

    return {
      membershipId: membership.id,
      user: toPersonSummary(membership.user),
      status: membership.status as CommunityMemberSummary["status"],
      joinedAt: membership.joinedAt?.toISOString() ?? null,
      isPrimary: membership.isPrimary,
      isAdminOverride: membership.isAdminOverride,
      distanceMi,
      isWithinRadius,
      staffRoles: staffRolesByUser.get(membership.user.id) ?? [],
    };
  });

  const staff = row.staffAssignments.map((assignment) => serializeStaff(assignment, activeMemberIds));
  const manager =
    staff.find((a) => a.role === "neighborhood_manager" || a.role === "hoa_manager") ?? null;

  return {
    community: serializeCommunity(row, {
      activeMemberCount: members.filter((m) => m.status === "active").length,
      pendingMemberCount: members.filter((m) => m.status === "pending").length,
      hoaTeamCount: staff.filter((a) => a.role === "hoa_team").length,
      manager,
    }),
    members,
    staff,
  };
}

/**
 * Homeowners the portal may legitimately offer for a given assignment.
 *
 * For a neighborhood manager the list is exactly the active residents of that
 * community, because nobody else is eligible. For HOA roles it is any
 * homeowner account, because HOA staff need not live there — so that branch is
 * search-driven and capped rather than enumerating the whole user table.
 */
export async function listStaffCandidates(
  communityId: string,
  role: CommunityStaffRole,
  search: string,
): Promise<StaffCandidate[]> {
  const community = await requireCommunity(communityId);
  assertStaffRoleMatchesCommunity(role, community);

  const nameOrEmail: Prisma.UserWhereInput = search
    ? {
        OR: [
          { fullName: { contains: search, mode: "insensitive" } },
          { email: { contains: search, mode: "insensitive" } },
        ],
      }
    : {};

  if (role === "neighborhood_manager") {
    const memberships = await db.communityMembership.findMany({
      where: { communityId, status: "active", user: { role: "homeowner", ...nameOrEmail } },
      select: { status: true, user: { select: personSelect } },
      orderBy: { user: { fullName: "asc" } },
      take: 50,
    });

    return memberships.map((membership) => ({
      ...toPersonSummary(membership.user),
      membershipStatus: membership.status as StaffCandidate["membershipStatus"],
    }));
  }

  const users = await db.user.findMany({
    where: { role: "homeowner", ...nameOrEmail },
    select: {
      ...personSelect,
      communityMemberships: { where: { communityId }, select: { status: true } },
    },
    orderBy: { fullName: "asc" },
    take: 50,
  });

  return users.map((user) => ({
    ...toPersonSummary(user),
    membershipStatus:
      (user.communityMemberships[0]?.status as StaffCandidate["membershipStatus"]) ?? null,
  }));
}

/** Search-driven homeowner picker for the internal member-add workflow. */
export async function listHomeownerCandidates(
  communityId: string,
  search: string,
): Promise<StaffCandidate[]> {
  await requireCommunity(communityId);
  if (search.trim().length < 2) return [];

  const users = await db.user.findMany({
    where: {
      role: "homeowner",
      OR: [
        { fullName: { contains: search, mode: "insensitive" } },
        { email: { contains: search, mode: "insensitive" } },
      ],
    },
    select: {
      ...personSelect,
      communityMemberships: { where: { communityId }, select: { status: true } },
    },
    orderBy: { fullName: "asc" },
    take: 25,
  });

  return users.map((user) => ({
    ...toPersonSummary(user),
    membershipStatus:
      (user.communityMemberships[0]?.status as StaffCandidate["membershipStatus"]) ?? null,
  }));
}

export async function getAdminOverview(): Promise<AdminOverview> {
  const managerFilter = MANAGER_ASSIGNMENT_FILTER;
  const now = new Date();

  const [
    hoaCommunities,
    neighborhoodCommunities,
    archivedCommunities,
    communitiesWithoutManager,
    homeowners,
    activeMemberships,
    pendingMemberships,
    pendingHoaInvitations,
    providerCounts,
    providersAwaitingVerification,
    auditRows,
  ] = await Promise.all([
    db.community.count({ where: { type: "hoa", status: "active" } }),
    db.community.count({ where: { type: "neighborhood", status: "active" } }),
    db.community.count({ where: { status: "archived" } }),
    db.community.count({ where: { status: "active", staffAssignments: { none: managerFilter } } }),
    db.user.count({ where: { role: "homeowner" } }),
    db.communityMembership.count({ where: { status: "active" } }),
    db.communityMembership.count({ where: { status: "pending" } }),
    db.communityInvitation.count({
      where: {
        status: "pending",
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
    }),
    db.providerProfile.groupBy({ by: ["accountStatus"], _count: { _all: true } }),
    db.providerProfile.count({
      where: { OR: [{ licenseVerifiedAt: null }, { insuranceVerifiedAt: null }] },
    }),
    db.adminAuditLog.findMany({
      select: auditSelect,
      orderBy: { createdAt: "desc" },
      take: 8,
    }),
  ]);

  const providersByStatus: AdminOverview["providersByStatus"] = {
    pending: 0,
    active: 0,
    suspended: 0,
  };
  for (const group of providerCounts) {
    const status = group.accountStatus as keyof AdminOverview["providersByStatus"];
    if (status in providersByStatus) providersByStatus[status] = group._count._all;
  }

  return {
    hoaCommunities,
    neighborhoodCommunities,
    archivedCommunities,
    communitiesWithoutManager,
    homeowners,
    activeMemberships,
    pendingMemberships,
    pendingHoaInvitations,
    providersByStatus,
    providersAwaitingVerification,
    recentAudit: auditRows.map((row) => serializeAuditEntry(row, toPersonSummary)),
  };
}

export const auditSelect = {
  id: true,
  action: true,
  targetType: true,
  targetId: true,
  communityId: true,
  providerUserId: true,
  metadata: true,
  createdAt: true,
  actor: { select: personSelect },
  community: { select: { name: true } },
} as const;

/* ── Writes ──────────────────────────────────────────────────────────────── */

type Actor = { id: string };

function isUniqueWriteConflict(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as { code?: unknown; meta?: { code?: unknown } };
  return (
    candidate.code === "P2002" ||
    candidate.code === "23505" ||
    candidate.meta?.code === "23505"
  );
}

async function requireCommunity(communityId: string) {
  const community = await db.community.findUnique({
    where: { id: communityId },
    select: {
      id: true,
      name: true,
      type: true,
      status: true,
      centerLatitude: true,
      centerLongitude: true,
      radiusMiles: true,
    },
  });

  if (!community) {
    throw new CommunityRuleError("not_found", "That community no longer exists.");
  }

  return {
    ...community,
    type: community.type as CommunitySummary["type"],
    status: community.status as CommunitySummary["status"],
  };
}

export async function createCommunity(
  actor: Actor,
  input: {
    name: string;
    type: CommunitySummary["type"];
    centerLatitude: number | null;
    centerLongitude: number | null;
    radiusMiles: number | null;
  },
): Promise<string> {
  const communityId = randomUUID();

  await db.$transaction([
    db.community.create({ data: { id: communityId, ...input } }),
    db.adminAuditLog.create({
      data: buildAuditEntry({
        actorUserId: actor.id,
        action: "community_created",
        targetType: "community",
        targetId: communityId,
        communityId,
        metadata: { name: input.name, type: input.type, radiusMiles: input.radiusMiles },
      }),
    }),
  ]);

  return communityId;
}

/**
 * Edits a community, or archives/restores it.
 *
 * Archiving rather than deleting is the only option offered: memberships and
 * assignments reference the row, and an archived community keeps its history
 * readable where a delete would take that history with it.
 */
export async function updateCommunity(
  actor: Actor,
  communityId: string,
  input: CommunityUpdateInput,
): Promise<void> {
  const existing = await requireCommunity(communityId);

  // A neighborhood without geometry cannot match anybody, and the database
  // CHECK would reject it with a message no admin could act on.
  if (existing.type === "neighborhood") {
    const nextLatitude =
      "centerLatitude" in input ? input.centerLatitude : undefined;
    const nextRadius = "radiusMiles" in input ? input.radiusMiles : undefined;

    if (nextLatitude === null || nextRadius === null) {
      throw new CommunityRuleError(
        "neighborhood_requires_geometry",
        "A location-based neighborhood must keep a centre point and a radius.",
      );
    }
  }

  const action =
    input.status === "archived" && existing.status !== "archived"
      ? "community_archived"
      : input.status === "active" && existing.status === "archived"
        ? "community_restored"
        : "community_updated";

  await db.$transaction([
    db.community.update({ where: { id: communityId }, data: input }),
    db.adminAuditLog.create({
      data: buildAuditEntry({
        actorUserId: actor.id,
        action,
        targetType: "community",
        targetId: communityId,
        communityId,
        metadata: {
          changedFields: Object.keys(input),
          previousStatus: existing.status,
          nextStatus: input.status ?? existing.status,
          nextRadiusMiles: input.radiusMiles ?? null,
        },
      }),
    }),
  ]);
}

/**
 * Adds a homeowner to a community, or revives a membership that was removed.
 *
 * Idempotent by construction: the unique `communityId`/`userId` pair means a
 * duplicated submit updates the same row instead of creating a second one, so
 * a double-clicked "Add member" cannot produce two memberships.
 */
export async function addMember(
  actor: Actor,
  communityId: string,
  input: MembershipCreateInput,
): Promise<{ membershipId: string; alreadyMember: boolean }> {
  const community = await requireCommunity(communityId);

  if (community.status === "archived") {
    throw new CommunityRuleError(
      "community_archived",
      "This community is archived. Restore it before changing membership.",
    );
  }

  const user = await db.user.findUnique({
    where: { id: input.userId },
    select: {
      id: true,
      role: true,
      latitude: true,
      longitude: true,
      communityMemberships: {
        where: currentMembershipWhere,
        select: { community: { select: { type: true } } },
      },
    },
  });
  if (!user) throw new CommunityRuleError("not_found", "That account no longer exists.");

  assertCanBeMember(isAppRole(user.role) ? user.role : "homeowner");

  const existing = await db.communityMembership.findUnique({
    where: { communityId_userId: { communityId, userId: user.id } },
    select: { id: true, status: true, joinedAt: true },
  });

  if (existing && existing.status !== "removed") {
    // POST means add/revive, not rewrite an existing membership. This makes a
    // duplicate request a true no-op and prevents it from downgrading an
    // active neighborhood manager to a pending resident.
    return { membershipId: existing.id, alreadyMember: true };
  }

  const conflictingType = community.type === "hoa" ? "neighborhood" : "hoa";
  if (
    user.communityMemberships.some(
      (membership) => membership.community.type === conflictingType,
    )
  ) {
    throw new CommunityRuleError(
      "community_type_membership_conflict",
      community.type === "hoa"
        ? "Remove this homeowner from their location-based neighborhood before adding them to an HOA."
        : "An HOA resident cannot also join a location-based neighborhood community.",
    );
  }

  // Recomputed here, never accepted from the request. It is recorded so an
  // override is auditable as an override, with the fact it overrode.
  const { isWithinRadius, distanceMi } = isWithinCommunity(
    user.latitude !== null && user.longitude !== null
      ? { latitude: user.latitude, longitude: user.longitude }
      : null,
    community,
  );

  if (
    community.type === "neighborhood" &&
    isWithinRadius !== true &&
    input.isAdminOverride !== true
  ) {
    throw new CommunityRuleError(
      "manual_override_required",
      "This homeowner is outside the neighborhood radius or has no verified location. Confirm a manual override to add them.",
    );
  }

  const membershipId = existing?.id ?? randomUUID();
  const becomingActive = input.status === "active";
  const joinedAt = existing?.joinedAt ?? (becomingActive ? new Date() : null);

  const metadata = {
    memberUserId: user.id,
    status: input.status,
    isAdminOverride: input.isAdminOverride ?? false,
    distanceMi,
    isWithinRadius,
    note: input.note ?? null,
  };

  if (existing) {
    await updateMembership(actor, communityId, existing.id, {
      status: input.status,
      isPrimary: input.isPrimary,
      isAdminOverride: input.isAdminOverride,
      note: input.note,
    });
    return { membershipId: existing.id, alreadyMember: true };
  }

  try {
    await db.$transaction([
      db.communityMembership.create({
        data: {
          id: membershipId,
          communityId,
          userId: user.id,
          status: input.status,
          joinedAt,
          isPrimary: input.isPrimary ?? false,
          isAdminOverride: input.isAdminOverride ?? false,
        },
      }),
      db.adminAuditLog.create({
        data: buildAuditEntry({
          actorUserId: actor.id,
          action: "member_added",
          targetType: "membership",
          targetId: membershipId,
          communityId,
          metadata,
        }),
      }),
    ]);
  } catch (error) {
    // A concurrent duplicate loses the unique-key race. Its transaction—and
    // therefore its audit row—rolls back; returning the winner makes the
    // request idempotent instead of surfacing a spurious conflict.
    if (isUniqueWriteConflict(error)) {
      const winner = await db.communityMembership.findUnique({
        where: { communityId_userId: { communityId, userId: user.id } },
        select: { id: true },
      });
      if (winner) return { membershipId: winner.id, alreadyMember: true };
    }
    throw error;
  }

  return { membershipId, alreadyMember: false };
}

/**
 * Changes a membership's status.
 *
 * When a resident stops being active, any scoped role that depended on their
 * residency is revoked in the same transaction. That is the rule from the
 * spec — "removing the neighborhood manager's homeowner membership must first
 * revoke or transfer their manager assignment in the same operation" — and it
 * is the reason this is a batch rather than two calls.
 */
export async function updateMembership(
  actor: Actor,
  communityId: string,
  membershipId: string,
  input: MembershipUpdateInput,
): Promise<{ revokedStaffRoles: CommunityStaffRole[] }> {
  const community = await requireCommunity(communityId);
  if (community.status === "archived") {
    throw new CommunityRuleError(
      "community_archived",
      "This community is archived. Restore it before changing membership.",
    );
  }

  const membership = await db.communityMembership.findFirst({
    where: { id: membershipId, communityId },
    select: {
      id: true,
      status: true,
      userId: true,
      joinedAt: true,
      isPrimary: true,
      isAdminOverride: true,
      user: { select: { latitude: true, longitude: true } },
    },
  });
  if (!membership) {
    throw new CommunityRuleError("not_found", "That membership no longer exists.");
  }

  const nextStatus = input.status ?? membership.status;
  const nextOverride = input.isAdminOverride ?? membership.isAdminOverride;
  const { isWithinRadius } = isWithinCommunity(
    membership.user.latitude !== null && membership.user.longitude !== null
      ? { latitude: membership.user.latitude, longitude: membership.user.longitude }
      : null,
    community,
  );
  if (
    community.type === "neighborhood" &&
    nextStatus !== "removed" &&
    isWithinRadius !== true &&
    nextOverride !== true
  ) {
    throw new CommunityRuleError(
      "manual_override_required",
      "This homeowner is outside the neighborhood radius or has no verified location. Confirm a manual override to keep this membership.",
    );
  }

  const losesResidency = nextStatus !== "active";

  const currentAssignments = losesResidency
    ? await db.communityStaffAssignment.findMany({
        where: { communityId, userId: membership.userId, status: "active" },
        select: { id: true, role: true },
      })
    : [];

  const toRevoke = currentAssignments.filter((assignment) =>
    staffRolesInvalidatedByMembershipLoss([assignment.role as CommunityStaffRole]).length > 0,
  );

  const now = new Date();
  const action = input.status === "removed" ? "member_removed" : "member_status_changed";

  const hasStateChange =
    (input.status !== undefined && input.status !== membership.status) ||
    (input.isPrimary !== undefined && input.isPrimary !== membership.isPrimary) ||
    (input.isAdminOverride !== undefined && input.isAdminOverride !== membership.isAdminOverride);
  if (!hasStateChange && toRevoke.length === 0) {
    return { revokedStaffRoles: [] };
  }

  const operations: Prisma.PrismaPromise<unknown>[] = [];

  for (const assignment of toRevoke) {
    operations.push(
      db.communityStaffAssignment.update({
        where: { id: assignment.id },
        data: { status: "revoked", revokedAt: now, revokedByUserId: actor.id },
      }),
      db.adminAuditLog.create({
        data: buildAuditEntry({
          actorUserId: actor.id,
          action: "staff_revoked",
          targetType: "staff_assignment",
          targetId: assignment.id,
          communityId,
          metadata: {
            assigneeUserId: membership.userId,
            role: assignment.role,
            reason: "Membership ended, so the residency-based role was revoked with it.",
          },
        }),
      }),
    );
  }

  // Revoke residency-dependent assignments first. A database trigger also
  // enforces this order when concurrent requests race.
  operations.push(
    db.communityMembership.update({
      where: { id: membership.id },
      data: {
        status: input.status ?? undefined,
        isPrimary: input.isPrimary ?? undefined,
        isAdminOverride: input.isAdminOverride ?? undefined,
        // First activation stamps the join date; later ones leave it alone.
        joinedAt:
          input.status === "active" && membership.joinedAt === null ? now : undefined,
      },
    }),
  );

  operations.push(
    db.adminAuditLog.create({
      data: buildAuditEntry({
        actorUserId: actor.id,
        action,
        targetType: "membership",
        targetId: membership.id,
        communityId,
        metadata: {
          memberUserId: membership.userId,
          previousStatus: membership.status,
          nextStatus: input.status ?? membership.status,
          note: input.note ?? null,
          revokedRoles: toRevoke.map((assignment) => assignment.role),
        },
      }),
    }),
  );

  await db.$transaction(operations);

  return { revokedStaffRoles: toRevoke.map((a) => a.role as CommunityStaffRole) };
}

/**
 * Grants a scoped role.
 *
 * Appointing a neighborhood manager where one already exists is a *replacement*
 * and needs an explicit acknowledgement, so a mis-click cannot silently unseat
 * someone. When acknowledged, the revoke and the new assignment go out as one
 * transaction; the partial unique index in the migration is what makes that
 * safe against two admins appointing different managers at the same moment.
 */
export async function assignStaffRole(
  actor: Actor,
  communityId: string,
  input: StaffAssignInput,
): Promise<{ assignmentId: string; replacedAssignmentId: string | null }> {
  const community = await requireCommunity(communityId);

  if (input.role === "hoa_manager") {
    throw new CommunityRuleError(
      "hoa_manager_invitation_required",
      "HOA managers must accept the separate manager-account invitation instead of being assigned from an existing homeowner account.",
    );
  }

  const assignee = await db.user.findUnique({
    where: { id: input.userId },
    select: {
      id: true,
      role: true,
      communityMemberships: { where: { communityId }, select: { status: true } },
    },
  });
  if (!assignee) throw new CommunityRuleError("not_found", "That account no longer exists.");

  assertCanAssignStaffRole({
    actorUserId: actor.id,
    role: input.role,
    community,
    assignee: {
      id: assignee.id,
      role: isAppRole(assignee.role) ? assignee.role : "homeowner",
      membershipStatus:
        (assignee.communityMemberships[0]?.status as
          | "pending"
          | "active"
          | "removed"
          | undefined) ?? null,
    },
  });

  const alreadyHeld = await db.communityStaffAssignment.findFirst({
    where: { communityId, userId: assignee.id, role: input.role, status: "active" },
    select: { id: true },
  });
  // A repeated submit of the same grant is the state the caller asked for, so
  // it succeeds without writing a second row or a second audit entry.
  if (alreadyHeld) {
    return { assignmentId: alreadyHeld.id, replacedAssignmentId: null };
  }

  const incumbent =
    input.role === "neighborhood_manager"
      ? await db.communityStaffAssignment.findFirst({
          where: { communityId, role: input.role, status: "active" },
          select: { id: true, userId: true },
        })
      : null;

  if (incumbent && !input.replaceExistingManager) {
    throw new CommunityRuleError(
      "manager_already_assigned",
      "This community already has a manager. Confirm the replacement to continue.",
    );
  }

  const assignmentId = randomUUID();
  const now = new Date();
  const operations: Prisma.PrismaPromise<unknown>[] = [];

  if (incumbent) {
    operations.push(
      db.communityStaffAssignment.update({
        where: { id: incumbent.id },
        data: { status: "revoked", revokedAt: now, revokedByUserId: actor.id },
      }),
      db.adminAuditLog.create({
        data: buildAuditEntry({
          actorUserId: actor.id,
          action: "staff_revoked",
          targetType: "staff_assignment",
          targetId: incumbent.id,
          communityId,
          metadata: {
            assigneeUserId: incumbent.userId,
            role: input.role,
            reason: "Replaced by a newly assigned community manager.",
          },
        }),
      }),
    );
  }

  operations.push(
    db.communityStaffAssignment.create({
      data: {
        id: assignmentId,
        communityId,
        userId: assignee.id,
        role: input.role,
        assignedByUserId: actor.id,
        assignedAt: now,
      },
    }),
    db.adminAuditLog.create({
      data: buildAuditEntry({
        actorUserId: actor.id,
        action: "staff_assigned",
        targetType: "staff_assignment",
        targetId: assignmentId,
        communityId,
        metadata: {
          assigneeUserId: assignee.id,
          role: input.role,
          replacedAssignmentId: incumbent?.id ?? null,
          note: input.note ?? null,
        },
      }),
    }),
  );

  try {
    await db.$transaction(operations);
  } catch (error) {
    if (isUniqueWriteConflict(error)) {
      const winner = await db.communityStaffAssignment.findFirst({
        where: { communityId, userId: assignee.id, role: input.role, status: "active" },
        select: { id: true },
      });
      if (winner) {
        return { assignmentId: winner.id, replacedAssignmentId: null };
      }
    }
    throw error;
  }

  return { assignmentId, replacedAssignmentId: incumbent?.id ?? null };
}

export async function revokeStaffAssignment(
  actor: Actor,
  communityId: string,
  assignmentId: string,
  note: string | null,
): Promise<void> {
  const assignment = await db.communityStaffAssignment.findFirst({
    where: { id: assignmentId, communityId },
    select: { id: true, userId: true, role: true, status: true },
  });
  if (!assignment) {
    throw new CommunityRuleError("not_found", "That role assignment no longer exists.");
  }

  assertCanRevokeStaffRole({ actorUserId: actor.id, assigneeUserId: assignment.userId });

  // Already revoked: the caller's intent is satisfied, so a repeated request
  // is not an error and does not append a duplicate audit entry.
  if (assignment.status === "revoked") return;

  await db.$transaction([
    db.communityStaffAssignment.update({
      where: { id: assignment.id },
      data: { status: "revoked", revokedAt: new Date(), revokedByUserId: actor.id },
    }),
    db.adminAuditLog.create({
      data: buildAuditEntry({
        actorUserId: actor.id,
        action: "staff_revoked",
        targetType: "staff_assignment",
        targetId: assignment.id,
        communityId,
        metadata: { assigneeUserId: assignment.userId, role: assignment.role, note },
      }),
    }),
  ]);
}

/* ── Geolocation matching ────────────────────────────────────────────────── */

type NeighborhoodPlacementUser = {
  id: string;
  role: string;
  isVerified: boolean;
  neighborhood: string | null;
  latitude: number | null;
  longitude: number | null;
};

const currentMembershipWhere: Prisma.CommunityMembershipWhereInput = {
  status: { in: ["active", "pending"] },
};

function automaticNeighborhoodName(neighborhood: string | null): string {
  const locality = neighborhood?.trim().replace(/\s+/g, " ").slice(0, 90);
  return locality ? `${locality} Neighborhood` : "Local Neighborhood";
}

async function readPlacementUser(userId: string): Promise<NeighborhoodPlacementUser | null> {
  return db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      role: true,
      isVerified: true,
      neighborhood: true,
      latitude: true,
      longitude: true,
    },
  });
}

async function findAvailableNeighborhoodForUser(user: NeighborhoodPlacementUser) {
  if (
    user.role !== "homeowner" ||
    !user.isVerified ||
    user.latitude === null ||
    user.longitude === null
  ) {
    return null;
  }

  const candidates = await db.community.findMany({
    where: { type: "neighborhood", status: "active" },
    select: {
      id: true,
      centerLatitude: true,
      centerLongitude: true,
      radiusMiles: true,
      _count: { select: { memberships: { where: currentMembershipWhere } } },
    },
  });

  return matchAvailableNeighborhood(
    { latitude: user.latitude, longitude: user.longitude },
    candidates.map((candidate) => ({
      ...candidate,
      currentHomeowners: candidate._count.memberships,
    })),
    MAX_HOMEOWNERS_PER_NEIGHBORHOOD,
  );
}

/**
 * Verified homeowners near `seed` who have no current membership of any kind.
 *
 * The `none` relation is the HOA exclusion as well as duplicate-neighborhood
 * protection: an HOA resident, even one physically inside this circle, never
 * enters the automatic candidate set. The rectangle is a DB pre-filter only;
 * the Haversine pass below makes the actual radius decision.
 */
async function findUnassignedHomeownersNear(
  seed: NeighborhoodPlacementUser & { latitude: number; longitude: number },
) {
  const bounds = coordinateBoundsForRadius(seed, COMMUNITY_RADIUS_MI);
  const longitudePredicate = Prisma.join(
    bounds.longitudeRanges.map(
      (range) =>
        Prisma.sql`("longitude" >= ${range.min} AND "longitude" <= ${range.max})`,
    ),
    " OR ",
  );

  // Exact Haversine ordering happens in Postgres, after an index-friendly
  // bounding-box filter. Only the nearest available slots cross the network;
  // a dense city therefore does not load every local homeowner into memory.
  const rows = await db.$queryRaw<Array<{ id: string; distanceMi: number }>>(Prisma.sql`
    WITH eligible AS (
      SELECT
        candidate."id",
        2 * 3958.7613 * ASIN(
          LEAST(
            1,
            SQRT(
              POWER(SIN(RADIANS(candidate."latitude" - ${seed.latitude}) / 2), 2) +
              COS(RADIANS(${seed.latitude})) *
              COS(RADIANS(candidate."latitude")) *
              POWER(SIN(RADIANS(candidate."longitude" - ${seed.longitude}) / 2), 2)
            )
          )
        ) AS "distanceMi"
      FROM "User" candidate
      WHERE candidate."id" <> ${seed.id}
        AND candidate."role" = 'homeowner'
        AND candidate."isVerified" = true
        AND candidate."latitude" IS NOT NULL
        AND candidate."longitude" IS NOT NULL
        AND candidate."latitude" >= ${bounds.minLatitude}
        AND candidate."latitude" <= ${bounds.maxLatitude}
        AND (${longitudePredicate})
        AND NOT EXISTS (
          SELECT 1
          FROM "CommunityMembership" membership
          WHERE membership."userId" = candidate."id"
            AND membership."status" IN ('active', 'pending')
        )
    )
    SELECT "id", "distanceMi"
    FROM eligible
    WHERE "distanceMi" <= ${COMMUNITY_RADIUS_MI}
    ORDER BY "distanceMi", "id"
    LIMIT ${MAX_HOMEOWNERS_PER_NEIGHBORHOOD - 1}
  `);

  return [
    { id: seed.id, distanceMi: 0 },
    ...rows.map((row) => ({ id: row.id, distanceMi: Number(row.distanceMi) })),
  ];
}

/**
 * The neighborhood a homeowner's stored coordinates fall into.
 *
 * Only active neighborhood communities are considered, so an HOA resident is
 * never pulled into a radius-based group. Full communities are skipped, and
 * overlapping eligible radii resolve through `matchAvailableNeighborhood`:
 * nearest centre, then lowest id. Returns `null` when the homeowner has no
 * coordinates or falls inside nothing — an honest "no match" rather than a
 * nearest-anyway guess.
 */
export async function findNeighborhoodForUser(
  userId: string,
): Promise<{ communityId: string; distanceMi: number } | null> {
  const user = await readPlacementUser(userId);
  return user ? findAvailableNeighborhoodForUser(user) : null;
}

/**
 * Places a homeowner in a neighborhood or forms one when a local cluster is
 * large enough.
 *
 * Called after onboarding and after an address change. Four things it
 * deliberately does *not* do:
 *
 * - It never touches someone who already belongs to a community, in either
 *   direction. An HOA resident is not moved into a radius group, and a
 *   homeowner is not evicted from one because their coordinates drifted —
 *   removing a member is an admin decision with an audit entry behind it.
 * - It never trusts a distance or community id from the request. Both the
 *   coordinates and the match are read and computed here.
 * - It never manufactures an admin actor. A radius match is the system doing
 *   arithmetic, not staff making a call; membership rows record
 *   `isAdminOverride: false`. A newly formed community does get one actor-less
 *   audit row so its origin remains traceable without logging addresses or
 *   coordinates.
 * - It does not create an approval queue. Matching is the product decision:
 *   once the verified homeowner is inside the configured radius, the
 *   membership is active immediately. HOA membership remains invitation-only
 *   and never enters this matcher.
 *
 * Returns the community it joined the user to, or `null` when it did nothing.
 */
async function syncNeighborhoodMembershipAttempt(
  userId: string,
  retryAfterConflict: boolean,
): Promise<string | null> {
  const existing = await db.communityMembership.findFirst({
    where: { userId, ...currentMembershipWhere },
    select: { communityId: true },
  });
  if (existing) return null;

  const user = await readPlacementUser(userId);
  if (
    !user ||
    user.role !== "homeowner" ||
    !user.isVerified ||
    user.latitude === null ||
    user.longitude === null
  ) {
    return null;
  }

  const match = await findAvailableNeighborhoodForUser(user);

  if (match) {
    // `create` rather than `upsert`: a `removed` membership means someone
    // decided this person does not belong here, and the matcher must not undo
    // that. The unique pair makes a concurrent duplicate a no-op.
    try {
      await db.communityMembership.create({
        data: {
          communityId: match.communityId,
          userId,
          status: "active",
          joinedAt: new Date(),
          isPrimary: true,
          isAdminOverride: false,
        },
      });
    } catch (error) {
      if (isUniqueWriteConflict(error)) {
        return retryAfterConflict
          ? null
          : syncNeighborhoodMembershipAttempt(userId, true);
      }
      throw error;
    }

    return match.communityId;
  }

  const nearby = await findUnassignedHomeownersNear({
    ...user,
    latitude: user.latitude,
    longitude: user.longitude,
  });
  if (
    nearby.length < MIN_HOMEOWNERS_TO_FORM_NEIGHBORHOOD ||
    !nearby.some((homeowner) => homeowner.id === user.id)
  ) {
    return null;
  }

  const communityId = randomUUID();
  const operations = [
    db.community.create({
      data: {
        id: communityId,
        name: automaticNeighborhoodName(user.neighborhood),
        type: "neighborhood",
        status: "active",
        centerLatitude: user.latitude,
        centerLongitude: user.longitude,
        radiusMiles: COMMUNITY_RADIUS_MI,
      },
    }),
    db.communityMembership.createMany({
      data: [...nearby].sort((left, right) => left.id.localeCompare(right.id)).map((homeowner) => ({
        id: randomUUID(),
        communityId,
        userId: homeowner.id,
        status: "active" as const,
        joinedAt: new Date(),
        isPrimary: true,
        isAdminOverride: false,
      })),
    }),
    db.adminAuditLog.create({
      data: buildAuditEntry({
        actorUserId: null,
        action: "community_created",
        targetType: "community",
        targetId: communityId,
        communityId,
        metadata: { type: "neighborhood", radiusMiles: COMMUNITY_RADIUS_MI },
      }),
    }),
  ];

  try {
    await db.$transaction(operations);
  } catch (error) {
    // Another request may have grouped one of these users first. Never create
    // a second current placement just to make this request report success.
    if (isUniqueWriteConflict(error)) {
      return retryAfterConflict
        ? null
        : syncNeighborhoodMembershipAttempt(userId, true);
    }
    throw error;
  }

  return communityId;
}

export async function syncNeighborhoodMembership(userId: string): Promise<string | null> {
  return syncNeighborhoodMembershipAttempt(userId, false);
}

/* ── Viewer context ──────────────────────────────────────────────────────── */

/**
 * The live role context behind the top-right identity area.
 *
 * Every field is read from Neon on each call. Clerk supplies the session and
 * nothing else, so an admin's assignment change takes effect on the customer's
 * next revalidation without a new sign-in, and no client-stored value can
 * manufacture a label the database does not back.
 */
export async function resolveViewerContext(user: {
  id: string;
  email: string;
  name: string | null;
  role: ViewerContext["role"];
}): Promise<ViewerContext> {
  const [record, assignments, memberships] = await Promise.all([
    db.user.findUnique({
      where: { id: user.id },
      select: { avatarUrl: true, providerProfile: { select: { accountStatus: true } } },
    }),
    db.communityStaffAssignment.findMany({
      where: { userId: user.id, status: "active", community: { status: "active" } },
      select: {
        role: true,
        community: { select: { id: true, name: true, type: true } },
      },
    }),
    db.communityMembership.findMany({
      where: { userId: user.id, status: { in: ["active", "pending"] } },
      select: {
        status: true,
        isPrimary: true,
        community: { select: { id: true, name: true, type: true } },
      },
      orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    }),
  ]);

  const staffRoles = assignments.map((a) => a.role as CommunityStaffRole);
  const fullName = user.name ?? "";

  return {
    userId: user.id,
    fullName,
    initials: initialsFromName(fullName),
    email: user.email,
    avatarUrl: record?.avatarUrl ?? null,
    role: user.role,
    roleLabel: viewerRoleLabel(user.role, staffRoles),
    providerStatus:
      user.role === "provider"
        ? ((record?.providerProfile?.accountStatus ?? "pending") as ViewerContext["providerStatus"])
        : null,
    assignments: assignments
      .map((assignment) => ({
        communityId: assignment.community.id,
        communityName: assignment.community.name,
        communityType: assignment.community.type as ViewerContext["communities"][number]["communityType"],
        role: assignment.role as CommunityStaffRole,
        roleLabel: STAFF_ROLE_LABELS[assignment.role as CommunityStaffRole],
      }))
      .sort((a, b) => a.roleLabel.localeCompare(b.roleLabel)),
    communities: memberships.map((membership) => ({
      communityId: membership.community.id,
      communityName: membership.community.name,
      communityType: membership.community.type as ViewerContext["communities"][number]["communityType"],
      status: membership.status as ViewerContext["communities"][number]["status"],
      isPrimary: membership.isPrimary,
    })),
    // Navigation only. Every management read and write re-derives this from
    // the same live assignments; hiding a link is not a permission check.
    canManageCommunity: user.role === "homeowner" && assignments.length > 0,
  };
}

/* ── Customer-side management reads ──────────────────────────────────────── */

export type ManagedCommunity = {
  community: Omit<CommunitySummary, "manager"> & {
    manager: {
      role: CommunityStaffRole;
      roleLabel: string;
      user: CustomerPersonSummary;
    } | null;
  };
  /** The caller's own scoped roles in this community. */
  roles: CommunityStaffRole[];
  roleLabels: string[];
  /**
   * Residents, without the eligibility and override detail the internal portal
   * shows. A community manager sees who their neighbours are; the distance and
   * override columns are a Bundleen staff concern.
   */
  members: Array<{
    user: CustomerPersonSummary;
    status: CommunityMemberSummary["status"];
    joinedAt: string | null;
  }>;
};

/**
 * The communities this user actually manages, resolved from live assignments.
 *
 * This is the authorization, not a filter applied after a broader read: the
 * membership query is scoped to community ids that came back from the caller's
 * own active assignments, so a request naming someone else's community returns
 * nothing rather than someone else's residents.
 *
 * Read-only by design for this release. Bundleen staff assignment and
 * enforcement are the priority; inventing manager write powers before they are
 * specified would be the wrong thing to guess at.
 */
export async function listManagedCommunities(userId: string): Promise<ManagedCommunity[]> {
  const assignments = await db.communityStaffAssignment.findMany({
    where: { userId, status: "active", community: { status: "active" } },
    select: { role: true, communityId: true },
  });

  if (assignments.length === 0) return [];

  const rolesByCommunity = new Map<string, CommunityStaffRole[]>();
  for (const assignment of assignments) {
    const roles = rolesByCommunity.get(assignment.communityId) ?? [];
    roles.push(assignment.role as CommunityStaffRole);
    rolesByCommunity.set(assignment.communityId, roles);
  }

  const managedIds = [...rolesByCommunity.keys()];
  const [communities, membershipCounts] = await Promise.all([
    db.community.findMany({
      where: { id: { in: managedIds } },
      select: {
        ...communitySelect,
        memberships: {
          // Only approved neighbours' identities leave the database query.
          where: { status: "active" },
          select: {
            status: true,
            joinedAt: true,
            user: { select: { id: true, fullName: true, avatarUrl: true } },
          },
          orderBy: { createdAt: "asc" },
          take: 200,
        },
        staffAssignments: {
          where: { status: "active" },
          select: {
            role: true,
            user: { select: { id: true, fullName: true, avatarUrl: true } },
          },
        },
      },
      orderBy: { name: "asc" },
    }),
    db.communityMembership.groupBy({
      by: ["communityId", "status"],
      where: { communityId: { in: managedIds }, status: { in: ["active", "pending"] } },
      _count: { _all: true },
    }),
  ]);

  const countByCommunity = new Map<string, { active: number; pending: number }>();
  for (const count of membershipCounts) {
    const current = countByCommunity.get(count.communityId) ?? { active: 0, pending: 0 };
    if (count.status === "active") current.active = count._count._all;
    if (count.status === "pending") current.pending = count._count._all;
    countByCommunity.set(count.communityId, current);
  }

  return communities.map((row) => {
    const roles = rolesByCommunity.get(row.id) ?? [];
    const counts = countByCommunity.get(row.id) ?? { active: 0, pending: 0 };
    const manager = row.staffAssignments.find(
      (a) => a.role === "neighborhood_manager" || a.role === "hoa_manager",
    );
    const communitySummary = serializeCommunity(row, {
      activeMemberCount: counts.active,
      pendingMemberCount: counts.pending,
      hoaTeamCount: row.staffAssignments.filter((a) => a.role === "hoa_team").length,
      manager: null,
    });

    return {
      community: {
        ...communitySummary,
        manager: manager
          ? {
              role: manager.role as CommunityStaffRole,
              roleLabel: STAFF_ROLE_LABELS[manager.role as CommunityStaffRole],
              user: toCustomerPersonSummary(manager.user),
            }
          : null,
      },
      roles,
      roleLabels: roles.map((role) => STAFF_ROLE_LABELS[role]),
      members: row.memberships.map((membership) => ({
        user: toCustomerPersonSummary(membership.user),
        status: membership.status as CommunityMemberSummary["status"],
        joinedAt: membership.joinedAt?.toISOString() ?? null,
      })),
    };
  });
}
