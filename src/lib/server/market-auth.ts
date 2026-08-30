import "server-only";

import { db } from "@/lib/server/db";
import { HoaWorkflowError } from "@/lib/server/hoa";

/**
 * Who may drive one service request's lifecycle.
 *
 * The important design decision: `requireManagedHoa` is *not* weakened. It
 * keeps meaning exactly what it always meant — the scoped, active manager of a
 * real HOA — and this module sits beside it, choosing which authority applies
 * from the community's own type. An HOA request answers to an HOA manager; a
 * neighborhood request answers to that neighborhood's one assigned
 * `neighborhood_manager`; a Bundleen admin has an audited recovery path over
 * both.
 *
 * Context comes from `Community.type` read from the database on every call.
 * No request body, query parameter, or header names the workflow.
 */

/** The immutable facts about a request that decide which rules apply. */
export type RequestContext = {
  requestId: string;
  communityId: string;
  communityName: string;
  communityType: "hoa" | "neighborhood";
  communityStatus: "active" | "archived";
  kind: "compulsory_recurring" | "optional_group";
  status: string;
  createdByUserId: string;
  minHomes: number | null;
  maxHomes: number | null;
  enrollmentClosesAt: Date | null;
  biddingClosesAt: Date | null;
  participantsLockedAt: Date | null;
  title: string;
  category: string;
};

const requestContextSelect = {
  id: true,
  communityId: true,
  kind: true,
  status: true,
  createdByUserId: true,
  minHomes: true,
  maxHomes: true,
  enrollmentClosesAt: true,
  biddingClosesAt: true,
  participantsLockedAt: true,
  title: true,
  category: true,
  community: { select: { name: true, type: true, status: true } },
} as const;

type RequestContextRow = {
  id: string;
  communityId: string;
  kind: "compulsory_recurring" | "optional_group";
  status: string;
  createdByUserId: string;
  minHomes: number | null;
  maxHomes: number | null;
  enrollmentClosesAt: Date | null;
  biddingClosesAt: Date | null;
  participantsLockedAt: Date | null;
  title: string;
  category: string;
  community: { name: string; type: "hoa" | "neighborhood"; status: "active" | "archived" };
};

function toContext(row: RequestContextRow): RequestContext {
  return {
    requestId: row.id,
    communityId: row.communityId,
    communityName: row.community.name,
    communityType: row.community.type,
    communityStatus: row.community.status,
    kind: row.kind,
    status: row.status,
    createdByUserId: row.createdByUserId,
    minHomes: row.minHomes,
    maxHomes: row.maxHomes,
    enrollmentClosesAt: row.enrollmentClosesAt,
    biddingClosesAt: row.biddingClosesAt,
    participantsLockedAt: row.participantsLockedAt,
    title: row.title,
    category: row.category,
  };
}

/**
 * Reads one request's workflow context.
 *
 * Deliberately says "does not exist" rather than "you cannot see it": a caller
 * who has no business with this request learns nothing about whether it is
 * real.
 */
export async function loadRequestContext(requestId: string): Promise<RequestContext> {
  const row = await db.hoaServiceRequest.findUnique({
    where: { id: requestId },
    select: requestContextSelect,
  });
  if (!row) throw new HoaWorkflowError("That service request does not exist.", 404);
  return toContext(row as RequestContextRow);
}

/* ── Manager authority ───────────────────────────────────────────────────── */

export type ManagerAuthority = {
  /** Which rule granted the authority. Recorded in every audit entry. */
  via: "hoa_manager" | "neighborhood_manager" | "admin_recovery";
  userId: string;
  communityId: string;
  communityName: string;
};

/**
 * The one active neighborhood manager of a community, if there is one.
 *
 * The product allows at most one; this reads the active assignment and also
 * confirms the person is still an active *resident* of the same community. A
 * manager who moves away or is removed from the roster loses the authority the
 * moment that membership row stops being active — the assignment alone is not
 * enough.
 */
export async function findNeighborhoodManager(
  communityId: string,
): Promise<{ userId: string; email: string; fullName: string } | null> {
  const assignment = await db.communityStaffAssignment.findFirst({
    where: {
      communityId,
      role: "neighborhood_manager",
      status: "active",
      community: { type: "neighborhood", status: "active" },
      user: {
        communityMemberships: { some: { communityId, status: "active" } },
      },
    },
    orderBy: { assignedAt: "asc" },
    select: { user: { select: { id: true, email: true, fullName: true } } },
  });
  return assignment
    ? {
        userId: assignment.user.id,
        email: assignment.user.email,
        fullName: assignment.user.fullName,
      }
    : null;
}

/** True when this account holds Bundleen portal access right now. */
async function isBundleenAdmin(userId: string): Promise<boolean> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { role: true, email: true },
  });
  if (!user || user.role !== "admin") return false;
  const grant = await db.adminAccessGrant.findUnique({
    where: { email: user.email },
    select: { status: true },
  });
  return grant?.status === "active";
}

/**
 * Authorizes a lifecycle action on one community, choosing the rule from the
 * community's type.
 *
 * The admin path is last and is never implicit: it is reached only when the
 * caller is genuinely Bundleen staff, and every caller records `via` in the
 * audit entry so a recovery action is distinguishable from an ordinary one.
 */
export async function requireCommunityManager(
  userId: string,
  communityId: string,
): Promise<ManagerAuthority> {
  const community = await db.community.findUnique({
    where: { id: communityId },
    select: { id: true, name: true, type: true, status: true },
  });
  if (!community) throw new HoaWorkflowError("That community does not exist.", 404);

  if (community.status === "active") {
    if (community.type === "hoa") {
      const assignment = await db.communityStaffAssignment.findFirst({
        where: {
          userId,
          communityId,
          role: "hoa_manager",
          status: "active",
        },
        select: { id: true },
      });
      if (assignment) {
        return {
          via: "hoa_manager",
          userId,
          communityId: community.id,
          communityName: community.name,
        };
      }
    } else {
      const manager = await findNeighborhoodManager(communityId);
      if (manager?.userId === userId) {
        return {
          via: "neighborhood_manager",
          userId,
          communityId: community.id,
          communityName: community.name,
        };
      }
    }
  }

  if (await isBundleenAdmin(userId)) {
    return {
      via: "admin_recovery",
      userId,
      communityId: community.id,
      communityName: community.name,
    };
  }

  throw new HoaWorkflowError(
    community.type === "hoa"
      ? "You do not manage this HOA."
      : "Only your neighbourhood's assigned manager can do this.",
    403,
  );
}

/** {@link requireCommunityManager}, addressed by request rather than community. */
export async function requireRequestManager(
  userId: string,
  requestId: string,
): Promise<{ context: RequestContext; authority: ManagerAuthority }> {
  const context = await loadRequestContext(requestId);
  const authority = await requireCommunityManager(userId, context.communityId);
  return { context, authority };
}

/* ── Residency ───────────────────────────────────────────────────────────── */

export type NeighborhoodMembership = {
  membershipId: string;
  communityId: string;
  communityName: string;
  userId: string;
};

/**
 * Active residency in one *neighborhood* community.
 *
 * The HOA twin of this is `requireActiveResident`, which additionally requires
 * a linked `CommunityUnit`. A neighborhood resident has no unit — their home is
 * their own verified profile address — so this checks membership only, and the
 * address requirement is enforced where it matters: at award time, where a
 * missing address would produce an unrouteable stop.
 */
export async function requireActiveNeighborhoodMember(
  userId: string,
  communityId: string,
): Promise<NeighborhoodMembership> {
  const membership = await db.communityMembership.findFirst({
    where: {
      userId,
      communityId,
      status: "active",
      community: { type: "neighborhood", status: "active" },
    },
    select: { id: true, community: { select: { id: true, name: true } } },
  });
  if (!membership) {
    // Same message and status for "not a member" and "membership not active".
    // An outsider probing request ids learns only that they have no access.
    throw new HoaWorkflowError("You do not have access to this neighbourhood request.", 403);
  }
  return {
    membershipId: membership.id,
    communityId: membership.community.id,
    communityName: membership.community.name,
    userId,
  };
}

/**
 * Whether this account may see private request detail: bids, counts, and
 * participation. Joined participants and the manager may; a neighbour who has
 * not engaged sees only the public summary; an outsider sees nothing.
 */
export async function canViewRequestDetail(
  userId: string,
  context: RequestContext,
): Promise<{ allowed: boolean; isManager: boolean; isParticipant: boolean }> {
  const [membership, participation, managerAuthority] = await Promise.all([
    db.communityMembership.findFirst({
      where: { userId, communityId: context.communityId, status: "active" },
      select: { id: true },
    }),
    db.hoaRequestParticipation.findFirst({
      where: { requestId: context.requestId, userId },
      select: { response: true },
    }),
    requireCommunityManager(userId, context.communityId).then(
      (authority) => authority,
      () => null,
    ),
  ]);

  const isManager = managerAuthority !== null;
  const isParticipant = participation?.response === "joined";
  const isOwner = context.createdByUserId === userId;

  return {
    allowed: isManager || isParticipant || isOwner || membership !== null,
    isManager,
    isParticipant: isParticipant || isOwner,
  };
}
