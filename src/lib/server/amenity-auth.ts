import "server-only";

import type { SessionUser } from "@/lib/server/auth";
import { db } from "@/lib/server/db";
import { HoaWorkflowError } from "@/lib/server/hoa";

/**
 * Tenant scoping for everything under Part 5.
 *
 * One rule, applied without exception: an amenity, booking, issue, review, or
 * photo is reachable only through a live relationship to the *exact* official
 * HOA that owns it. Neither a global `homeowner` role, nor membership of a
 * different HOA, nor a `neighborhood` membership, nor a provider account is
 * ever sufficient.
 *
 * Every guard resolves the community from the database and returns the scope
 * the caller must then use for its query. Callers never build a `where` clause
 * from a client-supplied community id.
 */

/** How the caller reached this HOA. Determines what a serializer may include. */
export type AmenityViewerRole = "resident" | "manager" | "admin";

export type AmenityScope = {
  userId: string;
  communityId: string;
  communityName: string;
  /** The HOA's IANA zone; every local time in the product is rendered in it. */
  timezone: string;
  role: AmenityViewerRole;
  /** Present for a resident; null for a manager or admin who does not live here. */
  membershipId: string | null;
  unitId: string | null;
  unitLabel: string | null;
  /** True when the caller may configure amenities, not only use them. */
  canManage: boolean;
};

const DEFAULT_TIMEZONE = "America/Chicago";

function isBundleenAdmin(user: SessionUser): boolean {
  return user.role === "admin" && user.adminAccessLevel !== null;
}

/**
 * Active resident of one official HOA.
 *
 * The `community.type` filter is the line that keeps a location-based
 * neighborhood out of this whole feature: a neighborhood membership can never
 * satisfy it, so amenities stay invisible to non-HOA homeowners.
 */
export async function requireAmenityResident(
  userId: string,
  communityId: string,
): Promise<AmenityScope> {
  const membership = await db.communityMembership.findFirst({
    where: {
      userId,
      communityId,
      status: "active",
      community: { type: "hoa", status: "active" },
    },
    select: {
      id: true,
      unitId: true,
      unit: { select: { label: true } },
      community: {
        select: { id: true, name: true, hoaProfile: { select: { timezone: true } } },
      },
    },
  });

  if (!membership) {
    // Deliberately identical to the message an outsider gets for a community
    // that does not exist: a 403 must not confirm which HOAs are real.
    throw new HoaWorkflowError("You do not have access to this community.", 403);
  }

  return {
    userId,
    communityId: membership.community.id,
    communityName: membership.community.name,
    timezone: membership.community.hoaProfile?.timezone ?? DEFAULT_TIMEZONE,
    role: "resident",
    membershipId: membership.id,
    unitId: membership.unitId,
    unitLabel: membership.unit?.label ?? null,
    canManage: false,
  };
}

/**
 * Scoped HOA staff, or a Bundleen admin exercising audited recovery access.
 *
 * `hoa_team` is included: the product lets a manager delegate day-to-day
 * amenity operations without handing over the whole HOA.
 */
export async function requireAmenityManager(
  user: SessionUser,
  communityId: string,
): Promise<AmenityScope> {
  const community = await db.community.findFirst({
    where: { id: communityId, type: "hoa", status: "active" },
    select: { id: true, name: true, hoaProfile: { select: { timezone: true } } },
  });
  if (!community) {
    throw new HoaWorkflowError("You do not have access to this community.", 403);
  }

  const base = {
    userId: user.id,
    communityId: community.id,
    communityName: community.name,
    timezone: community.hoaProfile?.timezone ?? DEFAULT_TIMEZONE,
    membershipId: null,
    unitId: null,
    unitLabel: null,
    canManage: true,
  };

  if (isBundleenAdmin(user)) {
    return { ...base, role: "admin" };
  }

  const assignment = await db.communityStaffAssignment.findFirst({
    where: {
      userId: user.id,
      communityId,
      role: { in: ["hoa_manager", "hoa_team"] },
      status: "active",
    },
    select: { id: true },
  });
  if (!assignment) {
    throw new HoaWorkflowError("You do not manage this HOA.", 403);
  }

  return { ...base, role: "manager" };
}

/**
 * Any authorized reader: resident, scoped staff, or Bundleen admin.
 *
 * Resident is tried first so a manager who also lives in the HOA is treated as
 * a manager (the wider scope) rather than losing their operational view.
 */
export async function requireAmenityViewer(
  user: SessionUser,
  communityId: string,
): Promise<AmenityScope> {
  try {
    const managerScope = await requireAmenityManager(user, communityId);
    // A manager who is also a resident keeps their unit context, so "my
    // bookings" still works from the manager surface.
    const membership = await db.communityMembership.findFirst({
      where: { userId: user.id, communityId, status: "active" },
      select: { id: true, unitId: true, unit: { select: { label: true } } },
    });
    return membership
      ? {
          ...managerScope,
          membershipId: membership.id,
          unitId: membership.unitId,
          unitLabel: membership.unit?.label ?? null,
        }
      : managerScope;
  } catch (error) {
    if (!(error instanceof HoaWorkflowError)) throw error;
    return requireAmenityResident(user.id, communityId);
  }
}

/** Official HOAs where this account is an active resident. */
export async function listResidentHoaCommunities(userId: string): Promise<
  Array<{ id: string; name: string; timezone: string; unitLabel: string | null }>
> {
  const memberships = await db.communityMembership.findMany({
    where: {
      userId,
      status: "active",
      community: { type: "hoa", status: "active" },
    },
    select: {
      unit: { select: { label: true } },
      community: {
        select: { id: true, name: true, hoaProfile: { select: { timezone: true } } },
      },
    },
    orderBy: { community: { name: "asc" } },
  });

  return memberships.map((membership) => ({
    id: membership.community.id,
    name: membership.community.name,
    timezone: membership.community.hoaProfile?.timezone ?? DEFAULT_TIMEZONE,
    unitLabel: membership.unit?.label ?? null,
  }));
}

/** Official HOAs this account actively staffs. Empty for a Bundleen admin. */
export async function listManagedHoaCommunities(
  userId: string,
): Promise<Array<{ id: string; name: string; timezone: string }>> {
  const assignments = await db.communityStaffAssignment.findMany({
    where: {
      userId,
      status: "active",
      role: { in: ["hoa_manager", "hoa_team"] },
      community: { type: "hoa", status: "active" },
    },
    select: {
      community: {
        select: { id: true, name: true, hoaProfile: { select: { timezone: true } } },
      },
    },
    orderBy: { community: { name: "asc" } },
  });

  const unique = new Map<string, { id: string; name: string; timezone: string }>();
  for (const assignment of assignments) {
    unique.set(assignment.community.id, {
      id: assignment.community.id,
      name: assignment.community.name,
      timezone: assignment.community.hoaProfile?.timezone ?? DEFAULT_TIMEZONE,
    });
  }
  return [...unique.values()];
}

/**
 * Resolves an amenity id to the community that owns it, then applies the
 * caller's scope to that community.
 *
 * Doing the lookup this way round is the point: authorization is derived from
 * where the row actually lives, so passing another HOA's amenity id produces a
 * 403 rather than a cross-tenant read.
 */
export async function scopeForAmenity(
  user: SessionUser,
  amenityId: string,
  mode: "view" | "manage" = "view",
): Promise<{ scope: AmenityScope; amenityId: string }> {
  const amenity = await db.amenity.findUnique({
    where: { id: amenityId },
    select: { id: true, communityId: true },
  });
  if (!amenity) {
    throw new HoaWorkflowError("That amenity is not available.", 404);
  }

  const scope =
    mode === "manage"
      ? await requireAmenityManager(user, amenity.communityId)
      : await requireAmenityViewer(user, amenity.communityId);

  return { scope, amenityId: amenity.id };
}

/**
 * True when a resident may still see an amenity at all.
 *
 * Drafts and archived amenities exist only for the people configuring them.
 */
export function visibleStatusesFor(scope: AmenityScope): Array<"draft" | "published" | "archived"> {
  return scope.canManage ? ["draft", "published", "archived"] : ["published"];
}

/**
 * Notification recipients for one HOA's operational staff.
 *
 * Separate from {@link listHoaStaff} because it returns email addresses, which
 * only the notification layer has a reason to hold.
 */
export async function listHoaManagerRecipients(
  communityId: string,
): Promise<Array<{ id: string; email: string; name: string }>> {
  const assignments = await db.communityStaffAssignment.findMany({
    where: {
      communityId,
      status: "active",
      role: { in: ["hoa_manager", "hoa_team"] },
    },
    select: { user: { select: { id: true, email: true, fullName: true } } },
  });

  const unique = new Map<string, { id: string; email: string; name: string }>();
  for (const assignment of assignments) {
    unique.set(assignment.user.id, {
      id: assignment.user.id,
      email: assignment.user.email,
      name: assignment.user.fullName,
    });
  }
  return [...unique.values()];
}

/** Active staff of one HOA, for the issue-assignment picker. */
export async function listHoaStaff(
  communityId: string,
): Promise<Array<{ id: string; name: string; role: string }>> {
  const assignments = await db.communityStaffAssignment.findMany({
    where: {
      communityId,
      status: "active",
      role: { in: ["hoa_manager", "hoa_team"] },
    },
    select: { role: true, user: { select: { id: true, fullName: true } } },
  });

  const unique = new Map<string, { id: string; name: string; role: string }>();
  for (const assignment of assignments) {
    if (unique.has(assignment.user.id)) continue;
    unique.set(assignment.user.id, {
      id: assignment.user.id,
      name: assignment.user.fullName,
      role: assignment.role,
    });
  }
  return [...unique.values()];
}
