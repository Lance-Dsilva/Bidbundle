import type { AppRole } from "@/lib/validation/auth";
import {
  STAFF_ROLE_COMMUNITY_TYPE,
  STAFF_ROLE_LABELS,
  STAFF_ROLE_PRECEDENCE,
  type CommunityStaffRole,
  type CommunityStatus,
  type CommunityType,
  type MembershipStatus,
} from "@/lib/validation/community";

/**
 * The community permission rules, as pure functions.
 *
 * Separated from the database layer so each rule can be asserted directly in a
 * unit test rather than inferred from an endpoint's response code. The service
 * layer in `@/lib/server/communities` is the only caller; nothing in the
 * browser may use these to decide what to allow, only what to show.
 *
 * The database enforces the two rules that survive a race — one active
 * neighborhood manager per community, one active assignment per
 * community/user/role — through partial unique indexes. These functions exist
 * so the ordinary case fails with a sentence a human can act on.
 */

export type CommunityRuleCode =
  | "not_found"
  | "community_archived"
  | "invalid_role_for_community_type"
  | "member_not_resident"
  | "not_a_homeowner"
  | "self_assignment"
  | "manager_already_assigned"
  | "already_assigned"
  | "neighborhood_requires_geometry"
  | "manager_membership_required"
  | "manual_override_required"
  | "stale_review"
  | "provider_not_active";

/** HTTP status each rule failure maps to. */
const STATUS_BY_CODE: Record<CommunityRuleCode, number> = {
  not_found: 404,
  community_archived: 409,
  invalid_role_for_community_type: 400,
  member_not_resident: 409,
  not_a_homeowner: 400,
  self_assignment: 403,
  manager_already_assigned: 409,
  already_assigned: 409,
  neighborhood_requires_geometry: 400,
  manager_membership_required: 409,
  manual_override_required: 409,
  stale_review: 409,
  provider_not_active: 403,
};

/**
 * A rule violation with a message that is safe to return verbatim.
 *
 * Every message here is about the caller's own request. None of them quote a
 * database error, a table name, or a constraint.
 */
export class CommunityRuleError extends Error {
  readonly code: CommunityRuleCode;
  readonly status: number;

  constructor(code: CommunityRuleCode, message: string) {
    super(message);
    this.name = "CommunityRuleError";
    this.code = code;
    this.status = STATUS_BY_CODE[code];
  }
}

export type CommunityFacts = {
  id: string;
  type: CommunityType;
  status: CommunityStatus;
};

export type AssigneeFacts = {
  id: string;
  role: AppRole;
  /** Membership in *this* community, or `null` when they are not a member. */
  membershipStatus: MembershipStatus | null;
};

/** `neighborhood_manager` is meaningless for an HOA, and vice versa. */
export function assertStaffRoleMatchesCommunity(
  role: CommunityStaffRole,
  community: CommunityFacts,
): void {
  const required = STAFF_ROLE_COMMUNITY_TYPE[role];
  if (community.type === required) return;

  throw new CommunityRuleError(
    "invalid_role_for_community_type",
    required === "neighborhood"
      ? `${STAFF_ROLE_LABELS[role]} can only be assigned in a location-based neighborhood community.`
      : `${STAFF_ROLE_LABELS[role]} can only be assigned in an HOA community.`,
  );
}

/**
 * Whether a scoped assignment may be created.
 *
 * The neighborhood-manager residency requirement is the rule with teeth: an
 * HOA manager runs an association they need not live in, but a neighborhood
 * exists *only* as a set of neighbours, so its manager has to be one of them.
 */
export function assertCanAssignStaffRole(input: {
  actorUserId: string;
  role: CommunityStaffRole;
  community: CommunityFacts;
  assignee: AssigneeFacts;
}): void {
  const { actorUserId, role, community, assignee } = input;

  if (assignee.id === actorUserId) {
    throw new CommunityRuleError(
      "self_assignment",
      "You cannot assign a community role to your own account.",
    );
  }

  if (community.status === "archived") {
    throw new CommunityRuleError(
      "community_archived",
      "This community is archived. Restore it before changing role assignments.",
    );
  }

  assertStaffRoleMatchesCommunity(role, community);

  // Scoped responsibilities sit on top of the homeowner experience. A provider
  // account has a different dashboard entirely, and a Bundleen admin already
  // has portal-wide access that a community assignment would only confuse.
  if (assignee.role !== "homeowner") {
    throw new CommunityRuleError(
      "not_a_homeowner",
      "Only homeowner accounts can hold a community role.",
    );
  }

  if (role === "neighborhood_manager" && assignee.membershipStatus !== "active") {
    throw new CommunityRuleError(
      "member_not_resident",
      "A neighborhood manager must already be an active member of that neighborhood.",
    );
  }
}

/** Revocation is an admin action on someone else, never on oneself. */
export function assertCanRevokeStaffRole(input: {
  actorUserId: string;
  assigneeUserId: string;
}): void {
  if (input.actorUserId === input.assigneeUserId) {
    throw new CommunityRuleError(
      "self_assignment",
      "You cannot revoke your own community role.",
    );
  }
}

/** Only homeowner accounts are residents; providers and staff are not. */
export function assertCanBeMember(assigneeRole: AppRole): void {
  if (assigneeRole !== "homeowner") {
    throw new CommunityRuleError(
      "not_a_homeowner",
      "Only homeowner accounts can be community members.",
    );
  }
}

/**
 * Whether ending a membership also has to end a scoped assignment.
 *
 * A neighborhood manager who stops being a resident stops being eligible, so
 * the two changes are one operation — leaving the assignment behind would put
 * the data in a state `assertCanAssignStaffRole` says cannot exist.
 * HOA assignments are unaffected: they never depended on residency.
 */
export function staffRolesInvalidatedByMembershipLoss(
  roles: readonly CommunityStaffRole[],
): CommunityStaffRole[] {
  return roles.filter((role) => role === "neighborhood_manager");
}

/**
 * The single label the identity area shows.
 *
 * Someone can legitimately hold several scoped roles across communities; the
 * top-right corner has room for one, so the most privileged wins by a fixed
 * order rather than by whichever row the database returned first.
 */
export function primaryStaffRole(
  roles: readonly CommunityStaffRole[],
): CommunityStaffRole | null {
  return STAFF_ROLE_PRECEDENCE.find((role) => roles.includes(role)) ?? null;
}

export function viewerRoleLabel(
  globalRole: AppRole,
  staffRoles: readonly CommunityStaffRole[],
): string {
  if (globalRole === "admin") return "Bundleen admin";
  if (globalRole === "provider") return "Service provider";

  const scoped = primaryStaffRole(staffRoles);
  return scoped ? STAFF_ROLE_LABELS[scoped] : "Homeowner";
}
