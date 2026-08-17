import "server-only";

import { randomUUID } from "node:crypto";

import { clerkClient } from "@clerk/nextjs/server";

import type { HoaInvitationSummary, HoaSurveySummary } from "@/lib/hoa-types";
import { buildAuditEntry } from "@/lib/server/audit";
import { db } from "@/lib/server/db";
import { buildNotificationOps, contentHash } from "@/lib/server/notifications";
import { normalizeEmail } from "@/lib/validation/auth";
import type { HoaSurveyCreateInput, HoaSurveyStatusInput } from "@/lib/validation/hoa";

const INVITATION_LIFETIME_DAYS = 7;

export class HoaWorkflowError extends Error {
  readonly status: number;

  constructor(message: string, status = 409) {
    super(message);
    this.name = "HoaWorkflowError";
    this.status = status;
  }
}

type InvitationRole = "hoa_manager" | "homeowner";

export function serializeInvitation(row: {
  id: string;
  email: string;
  role: InvitationRole;
  status: "pending" | "accepted" | "revoked";
  unitId: string | null;
  unit?: { label: string } | null;
  invitedAt: Date;
  expiresAt: Date | null;
  acceptedAt: Date | null;
}): HoaInvitationSummary {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    status: row.status,
    unitId: row.unitId,
    unitLabel: row.unit?.label ?? null,
    invitedAt: row.invitedAt.toISOString(),
    expiresAt: row.expiresAt?.toISOString() ?? null,
    acceptedAt: row.acceptedAt?.toISOString() ?? null,
  };
}

export function serializeSurvey(
  row: {
    id: string;
    communityId: string;
    monthKey: string;
    question: string;
    options: string[];
    status: "draft" | "open" | "closed";
    closesAt: Date | null;
    createdAt: Date;
    votes: Array<{ userId: string; optionIndex: number }>;
  },
  viewerUserId?: string,
): HoaSurveySummary {
  const voteCounts = row.options.map(() => 0);
  for (const vote of row.votes) {
    if (vote.optionIndex >= 0 && vote.optionIndex < voteCounts.length) {
      voteCounts[vote.optionIndex] += 1;
    }
  }

  return {
    id: row.id,
    communityId: row.communityId,
    monthKey: row.monthKey,
    question: row.question,
    options: row.options,
    status: row.status,
    closesAt: row.closesAt?.toISOString() ?? null,
    voteCounts,
    viewerOptionIndex:
      (viewerUserId
        ? row.votes.find((vote) => vote.userId === viewerUserId)?.optionIndex
        : undefined) ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Returns true only for a live, scoped HOA-manager assignment. */
export async function isHoaManager(userId: string): Promise<boolean> {
  const assignment = await db.communityStaffAssignment.findFirst({
    where: {
      userId,
      role: "hoa_manager",
      status: "active",
      community: { type: "hoa", status: "active" },
    },
    select: { id: true },
  });
  return Boolean(assignment);
}

export async function requireManagedHoa(userId: string, communityId: string) {
  const assignment = await db.communityStaffAssignment.findFirst({
    where: {
      userId,
      communityId,
      role: "hoa_manager",
      status: "active",
      community: { type: "hoa", status: "active" },
    },
    select: { id: true, community: { select: { id: true, name: true } } },
  });
  if (!assignment) {
    throw new HoaWorkflowError("You do not manage this HOA.", 403);
  }
  return assignment.community;
}

/** Active resident membership (with unit) or a 403. */
export async function requireActiveResident(userId: string, communityId: string) {
  const membership = await db.communityMembership.findFirst({
    where: {
      userId,
      communityId,
      status: "active",
      community: { type: "hoa", status: "active" },
    },
    select: { id: true, unitId: true, unit: { select: { id: true, label: true } } },
  });
  if (!membership) {
    throw new HoaWorkflowError("Only active HOA residents can do this.", 403);
  }
  return membership;
}

async function requireInvitableHoa(communityId: string) {
  const community = await db.community.findUnique({
    where: { id: communityId },
    select: { id: true, name: true, type: true, status: true },
  });
  if (!community) throw new HoaWorkflowError("That HOA does not exist.", 404);
  if (community.type !== "hoa") {
    throw new HoaWorkflowError("Email invitations are only used for HOA communities.", 400);
  }
  if (community.status !== "active") {
    throw new HoaWorkflowError("Restore this HOA before sending invitations.");
  }
  return community;
}

function invitationRedirectOrigin(requestUrl: string): string {
  const configured = process.env.BUNDLEEN_APP_URL?.trim().replace(/\/$/, "");
  if (configured) return new URL(configured).origin;

  const vercelProductionHost = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercelProductionHost) return `https://${vercelProductionHost}`;

  return new URL(requestUrl).origin;
}

async function createClerkInvitation(input: {
  invitationId: string;
  email: string;
  requestUrl: string;
}) {
  const client = await clerkClient();
  return client.invitations.createInvitation({
    emailAddress: input.email,
    expiresInDays: INVITATION_LIFETIME_DAYS,
    ignoreExisting: true,
    notify: true,
    redirectUrl: `${invitationRedirectOrigin(input.requestUrl)}/hoa/join/${input.invitationId}`,
  });
}

async function createInvitation(input: {
  actorUserId: string;
  actorEmail: string;
  communityId: string;
  email: string;
  role: InvitationRole;
  unitId: string | null;
  requestUrl: string;
}): Promise<HoaInvitationSummary> {
  const community = await requireInvitableHoa(input.communityId);
  const email = normalizeEmail(input.email);
  if (email === normalizeEmail(input.actorEmail)) {
    throw new HoaWorkflowError("Use a different email address for the invited account.", 400);
  }

  let unit: { id: string; label: string } | null = null;
  if (input.role === "homeowner") {
    if (!input.unitId) throw new HoaWorkflowError("Choose the home this invitation is for.", 400);
    const unitRow = await db.communityUnit.findFirst({
      where: { id: input.unitId, communityId: community.id },
      select: {
        id: true,
        label: true,
        occupancyStatus: true,
        memberships: { where: { status: "active" }, select: { id: true }, take: 1 },
        invitations: { where: { status: "pending" }, select: { id: true }, take: 1 },
      },
    });
    if (!unitRow) throw new HoaWorkflowError("That unit does not exist in this HOA.", 404);
    if (unitRow.occupancyStatus === "inactive") {
      throw new HoaWorkflowError("Reactivate this unit before inviting a homeowner to it.");
    }
    if (unitRow.memberships.length > 0) {
      throw new HoaWorkflowError("This unit already has an active homeowner.");
    }
    if (unitRow.invitations.length > 0) {
      throw new HoaWorkflowError("This unit already has a pending invitation.");
    }
    unit = { id: unitRow.id, label: unitRow.label };
  }

  const [existingInvitation, existingUser] = await Promise.all([
    db.communityInvitation.findUnique({
      where: {
        communityId_email_role: { communityId: community.id, email, role: input.role },
      },
      select: {
        id: true,
        status: true,
        expiresAt: true,
        clerkInvitationId: true,
      },
    }),
    db.user.findUnique({
      where: { email },
      select: {
        id: true,
        role: true,
        communityMemberships: {
          where: { status: { in: ["active", "pending"] } },
          select: { community: { select: { type: true } } },
        },
        staffAssignments: {
          where: { status: "active" },
          select: { id: true },
          take: 1,
        },
      },
    }),
  ]);

  if (existingInvitation?.status === "accepted") {
    throw new HoaWorkflowError("That invitation has already been accepted.");
  }
  if (
    existingInvitation?.status === "pending" &&
    (!existingInvitation.expiresAt || existingInvitation.expiresAt > new Date())
  ) {
    throw new HoaWorkflowError("A current invitation has already been sent to that email.");
  }

  if (existingUser && existingUser.role !== "homeowner") {
    throw new HoaWorkflowError("That email belongs to an account type that cannot join an HOA.");
  }
  if (
    input.role === "homeowner" &&
    existingUser?.communityMemberships.some((item) => item.community.type === "neighborhood")
  ) {
    throw new HoaWorkflowError(
      "That homeowner is currently assigned to a location-based neighborhood. Bundleen support must resolve that membership before the HOA invitation can be accepted.",
    );
  }
  if (
    input.role === "hoa_manager" &&
    existingUser &&
    (existingUser.communityMemberships.length > 0 || existingUser.staffAssignments.length > 0)
  ) {
    throw new HoaWorkflowError(
      "Use a separate account for the HOA manager rather than an existing resident or staff account.",
    );
  }

  if (input.role === "hoa_manager") {
    const managerInviteCutoff = new Date();
    const [activeManager, currentManagerInvite] = await Promise.all([
      db.communityStaffAssignment.findFirst({
        where: { communityId: community.id, role: "hoa_manager", status: "active" },
        select: { id: true },
      }),
      db.communityInvitation.findFirst({
        where: {
          communityId: community.id,
          role: "hoa_manager",
          status: "pending",
          OR: [{ expiresAt: null }, { expiresAt: { gt: managerInviteCutoff } }],
          ...(existingInvitation ? { id: { not: existingInvitation.id } } : {}),
        },
        select: { id: true },
      }),
    ]);
    if (activeManager) throw new HoaWorkflowError("This HOA already has an active manager.");
    if (currentManagerInvite) {
      throw new HoaWorkflowError("This HOA already has a pending manager invitation.");
    }
  }

  const invitationId = existingInvitation?.id ?? randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + INVITATION_LIFETIME_DAYS * 24 * 60 * 60 * 1_000);

  let clerkInvitation: Awaited<ReturnType<typeof createClerkInvitation>>;
  try {
    clerkInvitation = await createClerkInvitation({
      invitationId,
      email,
      requestUrl: input.requestUrl,
    });
  } catch {
    throw new HoaWorkflowError(
      "The invitation email could not be sent. Check the email and try again.",
      502,
    );
  }

  try {
    await db.$transaction([
      db.communityInvitation.upsert({
        where: { id: invitationId },
        create: {
          id: invitationId,
          communityId: community.id,
          email,
          role: input.role,
          unitId: unit?.id ?? null,
          status: "pending",
          clerkInvitationId: clerkInvitation.id,
          invitedByUserId: input.actorUserId,
          invitedAt: now,
          expiresAt,
        },
        update: {
          status: "pending",
          unitId: unit?.id ?? null,
          clerkInvitationId: clerkInvitation.id,
          invitedByUserId: input.actorUserId,
          invitedAt: now,
          expiresAt,
          acceptedByUserId: null,
          acceptedAt: null,
          revokedAt: null,
        },
      }),
      ...(unit
        ? [
            db.communityUnit.update({
              where: { id: unit.id },
              data: { occupancyStatus: "invite_pending" },
            }),
          ]
        : []),
      // The pipeline stage follows real events; a resend does not regress it.
      ...(input.role === "hoa_manager"
        ? [
            db.hoaProfile.updateMany({
              where: { communityId: community.id, onboardingStatus: "draft" },
              data: { onboardingStatus: "manager_invited" },
            }),
          ]
        : [
            db.hoaProfile.updateMany({
              where: { communityId: community.id, onboardingStatus: "manager_active" },
              data: { onboardingStatus: "residents_inviting" },
            }),
          ]),
      db.adminAuditLog.create({
        data: buildAuditEntry({
          actorUserId: input.actorUserId,
          action: "community_invitation_sent",
          targetType: "community_invitation",
          targetId: invitationId,
          communityId: community.id,
          metadata: { role: input.role, status: "pending" },
        }),
      }),
    ]);
  } catch (error) {
    try {
      const client = await clerkClient();
      await client.invitations.revokeInvitation(clerkInvitation.id);
    } catch {
      // The database remains authoritative. The orphaned Clerk invitation has
      // no matching Bundleen row and therefore cannot grant access.
    }
    throw error;
  }

  return {
    id: invitationId,
    email,
    role: input.role,
    status: "pending",
    unitId: unit?.id ?? null,
    unitLabel: unit?.label ?? null,
    invitedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    acceptedAt: null,
  };
}

/** Bundleen staff use this for the first, separate HOA manager account. */
export function inviteHoaManager(input: {
  actorUserId: string;
  actorEmail: string;
  communityId: string;
  email: string;
  requestUrl: string;
}) {
  return createInvitation({ ...input, role: "hoa_manager", unitId: null });
}

export async function listHoaManagerInvitations(
  communityId: string,
): Promise<HoaInvitationSummary[]> {
  await requireInvitableHoa(communityId);
  const rows = await db.communityInvitation.findMany({
    where: { communityId, role: "hoa_manager" },
    orderBy: { invitedAt: "desc" },
    select: {
      id: true,
      email: true,
      role: true,
      status: true,
      unitId: true,
      unit: { select: { label: true } },
      invitedAt: true,
      expiresAt: true,
      acceptedAt: true,
    },
  });
  return rows.map(serializeInvitation);
}

/** A scoped HOA manager invites a resident to one specific home. */
export async function inviteHoaResident(input: {
  actorUserId: string;
  actorEmail: string;
  communityId: string;
  email: string;
  unitId: string;
  requestUrl: string;
}) {
  await requireManagedHoa(input.actorUserId, input.communityId);
  return createInvitation({ ...input, role: "homeowner" });
}

async function revokeInvitation(input: {
  actorUserId: string;
  invitationId: string;
  communityId: string;
  role: InvitationRole;
}): Promise<void> {
  const invitation = await db.communityInvitation.findFirst({
    where: {
      id: input.invitationId,
      communityId: input.communityId,
      role: input.role,
    },
    select: { id: true, status: true, clerkInvitationId: true, unitId: true },
  });
  if (!invitation) throw new HoaWorkflowError("That invitation does not exist.", 404);
  if (invitation.status !== "pending") {
    throw new HoaWorkflowError("Only a pending invitation can be revoked.");
  }

  const now = new Date();
  await db.$transaction([
    db.communityInvitation.update({
      where: { id: invitation.id },
      data: { status: "revoked", revokedAt: now },
    }),
    ...(invitation.unitId
      ? [
          db.communityUnit.updateMany({
            where: { id: invitation.unitId, occupancyStatus: "invite_pending" },
            data: { occupancyStatus: "vacant" },
          }),
        ]
      : []),
    db.adminAuditLog.create({
      data: buildAuditEntry({
        actorUserId: input.actorUserId,
        action: "community_invitation_revoked",
        targetType: "community_invitation",
        targetId: invitation.id,
        communityId: input.communityId,
        metadata: { role: input.role, status: "revoked" },
      }),
    }),
  ]);

  if (invitation.clerkInvitationId) {
    try {
      const client = await clerkClient();
      await client.invitations.revokeInvitation(invitation.clerkInvitationId);
    } catch {
      // Bundleen's revoked row is the authorization boundary, so the emailed
      // link cannot grant access even if Clerk's best-effort cleanup fails.
    }
  }
}

export async function revokeHoaResidentInvitation(input: {
  actorUserId: string;
  communityId: string;
  invitationId: string;
}) {
  await requireManagedHoa(input.actorUserId, input.communityId);
  return revokeInvitation({ ...input, role: "homeowner" });
}

export async function revokeHoaManagerInvitation(input: {
  actorUserId: string;
  communityId: string;
  invitationId: string;
}) {
  await requireInvitableHoa(input.communityId);
  return revokeInvitation({ ...input, role: "hoa_manager" });
}

export async function acceptHoaInvitation(input: {
  invitationId: string;
  clerkUserId: string;
  email: string;
  emailVerified: boolean;
  fullName: string;
}): Promise<"manager" | "resident"> {
  if (!input.emailVerified) {
    throw new HoaWorkflowError("Verify your email before accepting this invitation.", 403);
  }
  const email = normalizeEmail(input.email);
  const invitation = await db.communityInvitation.findUnique({
    where: { id: input.invitationId },
    select: {
      id: true,
      email: true,
      role: true,
      status: true,
      unitId: true,
      expiresAt: true,
      invitedByUserId: true,
      acceptedBy: { select: { clerkUserId: true } },
      community: { select: { id: true, type: true, status: true } },
    },
  });

  if (!invitation) throw new HoaWorkflowError("This invitation does not exist.", 404);
  if (invitation.status === "accepted") {
    if (
      invitation.email !== email ||
      invitation.acceptedBy?.clerkUserId !== input.clerkUserId
    ) {
      throw new HoaWorkflowError("Sign in with the email address that accepted this invitation.", 403);
    }
    return invitation.role === "hoa_manager" ? "manager" : "resident";
  }
  if (invitation.status !== "pending") throw new HoaWorkflowError("This invitation is no longer active.");
  if (invitation.expiresAt && invitation.expiresAt <= new Date()) {
    throw new HoaWorkflowError("This invitation has expired. Ask the HOA manager to send another one.", 410);
  }
  if (invitation.email !== email) {
    throw new HoaWorkflowError("Sign in with the email address that received this invitation.", 403);
  }
  if (invitation.community.type !== "hoa" || invitation.community.status !== "active") {
    throw new HoaWorkflowError("This HOA is not currently accepting invitations.");
  }
  if (invitation.role === "homeowner" && !invitation.unitId) {
    throw new HoaWorkflowError(
      "This invitation is not linked to a home. Ask the HOA manager to send a new one.",
    );
  }

  const [byClerk, byEmail] = await Promise.all([
    db.user.findUnique({
      where: { clerkUserId: input.clerkUserId },
      select: { id: true, email: true, role: true },
    }),
    db.user.findUnique({
      where: { email },
      select: {
        id: true,
        clerkUserId: true,
        role: true,
        communityMemberships: {
          where: { status: { in: ["active", "pending"] } },
          select: { community: { select: { type: true } } },
        },
        staffAssignments: { where: { status: "active" }, select: { id: true }, take: 1 },
      },
    }),
  ]);

  if (byEmail && byEmail.clerkUserId !== input.clerkUserId) {
    throw new HoaWorkflowError("That email is already linked to another Bundleen identity.", 409);
  }
  if (byClerk && normalizeEmail(byClerk.email) !== email) {
    throw new HoaWorkflowError("This signed-in account does not match the invitation.", 403);
  }
  if ((byClerk?.role ?? byEmail?.role) && (byClerk?.role ?? byEmail?.role) !== "homeowner") {
    throw new HoaWorkflowError("This account type cannot accept an HOA invitation.", 409);
  }
  if (
    invitation.role === "homeowner" &&
    byEmail?.communityMemberships.some((item) => item.community.type === "neighborhood")
  ) {
    throw new HoaWorkflowError(
      "This account is currently assigned to a location-based neighborhood. Contact Bundleen support before joining the HOA.",
    );
  }
  if (
    invitation.role === "hoa_manager" &&
    byEmail &&
    (byEmail.communityMemberships.length > 0 || byEmail.staffAssignments.length > 0)
  ) {
    throw new HoaWorkflowError("The HOA manager invitation requires a separate account.");
  }

  const user = await db.user.upsert({
    where: { clerkUserId: input.clerkUserId },
    create: {
      clerkUserId: input.clerkUserId,
      email,
      fullName: input.fullName || email.split("@")[0],
      role: "homeowner",
      isVerified: true,
      homeownerProfile: { create: {} },
    },
    update: {
      email,
      fullName: input.fullName || undefined,
      isVerified: true,
      homeownerProfile: { upsert: { create: {}, update: {} } },
    },
    select: { id: true },
  });

  const now = new Date();
  if (invitation.role === "hoa_manager") {
    const currentManager = await db.communityStaffAssignment.findFirst({
      where: {
        communityId: invitation.community.id,
        role: "hoa_manager",
        status: "active",
      },
      select: { id: true, userId: true },
    });
    if (currentManager && currentManager.userId !== user.id) {
      throw new HoaWorkflowError("This HOA already has an active manager.");
    }

    const previousAssignment = await db.communityStaffAssignment.findFirst({
      where: { communityId: invitation.community.id, userId: user.id, role: "hoa_manager" },
      orderBy: { assignedAt: "desc" },
      select: { id: true },
    });
    const assignmentId = previousAssignment?.id ?? randomUUID();

    await db.$transaction([
      previousAssignment
        ? db.communityStaffAssignment.update({
            where: { id: assignmentId },
            data: {
              status: "active",
              assignedByUserId: invitation.invitedByUserId,
              assignedAt: now,
              revokedAt: null,
              revokedByUserId: null,
            },
          })
        : db.communityStaffAssignment.create({
            data: {
              id: assignmentId,
              communityId: invitation.community.id,
              userId: user.id,
              role: "hoa_manager",
              status: "active",
              assignedByUserId: invitation.invitedByUserId,
              assignedAt: now,
            },
          }),
      db.communityInvitation.update({
        where: { id: invitation.id },
        data: { status: "accepted", acceptedByUserId: user.id, acceptedAt: now },
      }),
      db.hoaProfile.updateMany({
        where: {
          communityId: invitation.community.id,
          onboardingStatus: { in: ["draft", "manager_invited"] },
        },
        data: { onboardingStatus: "manager_active" },
      }),
      db.adminAuditLog.create({
        data: buildAuditEntry({
          actorUserId: user.id,
          action: "community_invitation_accepted",
          targetType: "community_invitation",
          targetId: invitation.id,
          communityId: invitation.community.id,
          metadata: { role: invitation.role, status: "accepted" },
        }),
      }),
    ]);
    return "manager";
  }

  const unitId = invitation.unitId as string;
  const existingMembership = await db.communityMembership.findUnique({
    where: {
      communityId_userId: { communityId: invitation.community.id, userId: user.id },
    },
    select: { id: true, joinedAt: true },
  });

  try {
    await db.$transaction([
      db.communityMembership.upsert({
        where: {
          communityId_userId: { communityId: invitation.community.id, userId: user.id },
        },
        create: {
          id: randomUUID(),
          communityId: invitation.community.id,
          userId: user.id,
          unitId,
          status: "active",
          joinedAt: now,
          isPrimary: true,
          isAdminOverride: false,
        },
        update: {
          status: "active",
          unitId,
          joinedAt: existingMembership?.joinedAt ?? now,
          isPrimary: true,
          isAdminOverride: false,
        },
      }),
      db.communityUnit.update({
        where: { id: unitId },
        data: { occupancyStatus: "occupied" },
      }),
      db.communityInvitation.update({
        where: { id: invitation.id },
        data: { status: "accepted", acceptedByUserId: user.id, acceptedAt: now },
      }),
      db.adminAuditLog.create({
        data: buildAuditEntry({
          actorUserId: user.id,
          action: "community_invitation_accepted",
          targetType: "community_invitation",
          targetId: invitation.id,
          communityId: invitation.community.id,
          metadata: { role: invitation.role, status: "accepted" },
        }),
      }),
    ]);
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") {
      // The one-active-resident-per-unit index caught a race with another
      // acceptance. The unit is taken; this invitation cannot complete.
      throw new HoaWorkflowError(
        "This home already has an active resident. Ask the HOA manager for a new invitation.",
      );
    }
    throw error;
  }
  return "resident";
}

/* ── Surveys ─────────────────────────────────────────────────────────────── */

export async function createHoaSurvey(
  userId: string,
  communityId: string,
  input: HoaSurveyCreateInput,
): Promise<string> {
  const community = await requireManagedHoa(userId, communityId);
  const surveyId = randomUUID();

  const residents =
    input.status === "open"
      ? await db.communityMembership.findMany({
          where: { communityId, status: "active", NOT: { userId } },
          select: { user: { select: { id: true, email: true } } },
        })
      : [];

  await db.$transaction([
    db.hoaSurvey.create({
      data: {
        id: surveyId,
        communityId,
        createdByUserId: userId,
        monthKey: input.monthKey,
        question: input.question,
        options: input.options,
        status: input.status,
        closesAt: input.closesAt ? new Date(input.closesAt) : null,
      },
    }),
    db.adminAuditLog.create({
      data: buildAuditEntry({
        actorUserId: userId,
        action: "hoa_survey_created",
        targetType: "hoa_survey",
        targetId: surveyId,
        communityId,
        metadata: { status: input.status },
      }),
    }),
    ...buildNotificationOps(
      residents.map(({ user }) => ({
        userId: user.id,
        email: user.email,
        kind: "survey" as const,
        title: `New survey from ${community.name}`,
        body: input.question,
        linkPath: "/app/homeowner/community",
        dedupeKey: `survey-open:${surveyId}:${user.id}`,
      })),
    ),
  ]);
  return surveyId;
}

/** Opens or closes a monthly survey for the manager's own HOA. */
export async function updateHoaSurveyStatus(
  userId: string,
  surveyId: string,
  input: HoaSurveyStatusInput,
): Promise<void> {
  const survey = await db.hoaSurvey.findUnique({
    where: { id: surveyId },
    select: { id: true, communityId: true, status: true, question: true },
  });
  if (!survey) throw new HoaWorkflowError("That HOA survey does not exist.", 404);
  const community = await requireManagedHoa(userId, survey.communityId);
  if (survey.status === input.status) return;
  if (survey.status === "closed") {
    throw new HoaWorkflowError("A closed survey stays closed; create next month's survey instead.");
  }

  const residents =
    input.status === "open"
      ? await db.communityMembership.findMany({
          where: { communityId: survey.communityId, status: "active", NOT: { userId } },
          select: { user: { select: { id: true, email: true } } },
        })
      : [];

  await db.$transaction([
    db.hoaSurvey.update({
      where: { id: survey.id },
      data: { status: input.status },
    }),
    db.adminAuditLog.create({
      data: buildAuditEntry({
        actorUserId: userId,
        action: "hoa_survey_status_changed",
        targetType: "hoa_survey",
        targetId: survey.id,
        communityId: survey.communityId,
        metadata: { previousStatus: survey.status, nextStatus: input.status },
      }),
    }),
    ...buildNotificationOps(
      residents.map(({ user }) => ({
        userId: user.id,
        email: user.email,
        kind: "survey" as const,
        title: `New survey from ${community.name}`,
        body: survey.question,
        linkPath: "/app/homeowner/community",
        dedupeKey: `survey-open:${survey.id}:${user.id}`,
      })),
    ),
  ]);
}

export async function voteInHoaSurvey(
  userId: string,
  surveyId: string,
  optionIndex: number,
): Promise<void> {
  const survey = await db.hoaSurvey.findUnique({
    where: { id: surveyId },
    select: {
      id: true,
      communityId: true,
      options: true,
      status: true,
      closesAt: true,
    },
  });
  if (!survey) throw new HoaWorkflowError("That HOA survey does not exist.", 404);
  await requireActiveResident(userId, survey.communityId);
  if (survey.status !== "open" || (survey.closesAt && survey.closesAt <= new Date())) {
    throw new HoaWorkflowError("This survey is closed.");
  }
  if (optionIndex < 0 || optionIndex >= survey.options.length) {
    throw new HoaWorkflowError("Choose a valid survey option.", 400);
  }

  await db.hoaSurveyVote.upsert({
    where: { surveyId_userId: { surveyId, userId } },
    create: { id: randomUUID(), surveyId, userId, optionIndex },
    update: { optionIndex },
  });
}
