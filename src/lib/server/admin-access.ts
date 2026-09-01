import "server-only";

import { randomUUID } from "node:crypto";

import { clerkClient } from "@clerk/nextjs/server";
import type { UserRole } from "@/generated/prisma/enums";
import type { AdminAccessSummary } from "@/lib/admin-access";
import { isPrimaryAdminEmail } from "@/lib/admin-access";
import { normalizeAdminPermissions } from "@/lib/admin-permissions";
import { buildAuditEntry } from "@/lib/server/audit";
import { db } from "@/lib/server/db";
import { buildPreferenceAwareNotificationOps } from "@/lib/server/notifications";
import { normalizeEmail } from "@/lib/validation/auth";

const ADMIN_INVITATION_LIFETIME_DAYS = 7;

export class AdminAccessError extends Error {
  readonly status: number;

  constructor(message: string, status = 409) {
    super(message);
    this.name = "AdminAccessError";
    this.status = status;
  }
}

const accessSelect = {
  id: true,
  email: true,
  inviteeName: true,
  level: true,
  status: true,
  permissions: true,
  invitationExpiresAt: true,
  grantedAt: true,
  acceptedAt: true,
  revokedAt: true,
  user: { select: { fullName: true } },
  grantedBy: { select: { fullName: true } },
} as const;

type AccessRow = {
  id: string;
  email: string;
  inviteeName: string | null;
  level: "owner" | "admin";
  status: "pending" | "active" | "revoked";
  permissions: string[];
  invitationExpiresAt: Date | null;
  grantedAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
  user: { fullName: string } | null;
  grantedBy: { fullName: string } | null;
};

function serializeAccess(row: AccessRow): AdminAccessSummary {
  return {
    id: row.id,
    email: row.email,
    level: row.level,
    status: row.status,
    fullName: row.user?.fullName ?? row.inviteeName,
    invitationExpiresAt: row.invitationExpiresAt?.toISOString() ?? null,
    grantedByName: row.grantedBy?.fullName ?? null,
    grantedAt: row.grantedAt.toISOString(),
    acceptedAt: row.acceptedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    permissions: normalizeAdminPermissions(row.permissions),
  };
}

function invitationOrigin(requestUrl: string): string {
  const configured = process.env.BUNDLEEN_APP_URL?.trim().replace(/\/$/, "");
  if (configured) return new URL(configured).origin;

  const productionHost = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (productionHost) return `https://${productionHost}`;

  return new URL(requestUrl).origin;
}

async function createAdminClerkInvitation(input: {
  grantId: string;
  email: string;
  fullName: string;
  requestUrl: string;
}) {
  const client = await clerkClient();
  return client.invitations.createInvitation({
    emailAddress: input.email,
    expiresInDays: ADMIN_INVITATION_LIFETIME_DAYS,
    ignoreExisting: true,
    notify: true,
    publicMetadata: {
      bundleenAdminGrantId: input.grantId,
      bundleenInvitedName: input.fullName,
      bundleenInvitationRole: "admin",
    },
    redirectUrl: `${invitationOrigin(input.requestUrl)}/admin/join/${input.grantId}`,
  });
}

export async function setAdminPermissions(input: {
  actorUserId: string;
  grantId: string;
  permissions: readonly string[];
}): Promise<AdminAccessSummary> {
  const grant = await db.adminAccessGrant.findUnique({
    where: { id: input.grantId },
    select: { id: true, level: true, status: true },
  });
  if (!grant) throw new AdminAccessError("That admin access record does not exist.", 404);
  if (grant.level === "owner") {
    throw new AdminAccessError("The Bundleen owner already holds every permission.", 400);
  }
  if (grant.status === "revoked") {
    throw new AdminAccessError("Restore this admin's access before changing permissions.", 409);
  }

  const permissions = normalizeAdminPermissions(input.permissions);
  const [updated] = await db.$transaction([
    db.adminAccessGrant.update({
      where: { id: input.grantId },
      data: { permissions },
      select: accessSelect,
    }),
    db.adminAuditLog.create({
      data: buildAuditEntry({
        actorUserId: input.actorUserId,
        action: "admin_permissions_changed",
        targetType: "admin_access",
        targetId: input.grantId,
        metadata: { changedFields: permissions.length > 0 ? permissions : ["none"] },
      }),
    }),
  ]);
  return serializeAccess(updated);
}

export async function listAdminAccess(): Promise<AdminAccessSummary[]> {
  const rows = await db.adminAccessGrant.findMany({
    select: accessSelect,
    orderBy: [{ level: "desc" }, { grantedAt: "asc" }],
  });
  return rows.map(serializeAccess);
}

/** Links a verified Clerk identity to an email-bound owner/admin grant. */
export async function activateApprovedAdminIdentity(input: {
  clerkUserId: string;
  email: string;
  emailVerified: boolean;
  fullName: string;
}): Promise<boolean> {
  if (!input.emailVerified) return false;
  const email = normalizeEmail(input.email);
  const grant = await db.adminAccessGrant.findUnique({
    where: { email },
    select: {
      id: true,
      status: true,
      inviteeName: true,
      invitationExpiresAt: true,
      previousRole: true,
      userId: true,
      grantedBy: { select: { id: true, email: true } },
    },
  });
  if (!grant || grant.status === "revoked") return false;
  if (
    grant.status === "pending" &&
    grant.invitationExpiresAt &&
    grant.invitationExpiresAt <= new Date()
  ) {
    return false;
  }

  const [byClerk, byEmail] = await Promise.all([
    db.user.findUnique({
      where: { clerkUserId: input.clerkUserId },
      select: { id: true, role: true, email: true },
    }),
    db.user.findUnique({
      where: { email },
      select: { id: true, clerkUserId: true, role: true },
    }),
  ]);

  if (byEmail && byEmail.clerkUserId !== input.clerkUserId) return false;
  if (byClerk && normalizeEmail(byClerk.email) !== email) return false;
  if (grant.userId && grant.userId !== byClerk?.id && grant.userId !== byEmail?.id) return false;

  const existingRole = byClerk?.role ?? byEmail?.role ?? null;
  const previousRole: UserRole | null =
    grant.previousRole ?? (existingRole && existingRole !== "admin" ? existingRole : null);
  const acceptedName = grant.inviteeName || input.fullName || email.split("@")[0];

  const user = await db.user.upsert({
    where: { clerkUserId: input.clerkUserId },
    create: {
      clerkUserId: input.clerkUserId,
      email,
      fullName: acceptedName,
      role: "admin",
      isVerified: true,
    },
    update: {
      email,
      fullName: acceptedName,
      role: "admin",
      isVerified: true,
    },
    select: { id: true },
  });

  const activating = grant.status === "pending";
  const notificationOps = activating
    ? await buildPreferenceAwareNotificationOps([
        {
          userId: user.id,
          email,
          emailPolicy: "required",
          kind: "security",
          title: "Your Bundleen admin account is ready",
          body: "Your verified staff identity now has access to the internal Bundleen portal.",
          linkPath: "/app/admin/dashboard",
          dedupeKey: `admin-access-accepted:${grant.id}:${user.id}`,
        },
        ...(grant.grantedBy && grant.grantedBy.id !== user.id
          ? [
              {
                userId: grant.grantedBy.id,
                email: grant.grantedBy.email,
                emailPolicy: "required" as const,
                kind: "security" as const,
                title: `${acceptedName} accepted the admin invitation`,
                body: "The invited Bundleen staff account is verified and now has portal access.",
                linkPath: "/app/admin/access",
                dedupeKey: `admin-access-accepted-owner:${grant.id}:${grant.grantedBy.id}`,
              },
            ]
          : []),
      ])
    : [];

  await db.$transaction([
    db.adminAccessGrant.update({
      where: { id: grant.id },
      data: {
        status: "active",
        userId: user.id,
        previousRole,
        acceptedAt: activating ? new Date() : undefined,
        revokedAt: null,
        revokedByUserId: null,
      },
    }),
    ...(activating
      ? [
          db.adminAuditLog.create({
            data: buildAuditEntry({
              actorUserId: user.id,
              action: "admin_access_granted",
              targetType: "admin_access",
              targetId: grant.id,
              metadata: { previousStatus: "pending", nextStatus: "active" },
            }),
          }),
        ]
      : []),
    ...notificationOps,
  ]);
  return true;
}

/**
 * Sends an invitation for a separate internal staff identity.
 *
 * No customer account is required and the pending row grants no authority.
 * Clerk creates/verifies credentials; Bundleen activates the grant only when
 * the exact invited email reaches `activateApprovedAdminIdentity`.
 */
export async function grantAdminAccess(input: {
  actorUserId: string;
  fullName: string;
  email: string;
  requestUrl: string;
}): Promise<AdminAccessSummary> {
  const email = normalizeEmail(input.email);

  if (isPrimaryAdminEmail(email)) {
    throw new AdminAccessError("The primary owner already has permanent admin access.");
  }

  const [target, existingGrant] = await Promise.all([
    db.user.findUnique({
      where: { email },
      select: {
        id: true,
        role: true,
        communityMemberships: {
          where: { status: { in: ["active", "pending"] } },
          select: { id: true },
          take: 1,
        },
        staffAssignments: {
          where: { status: "active" },
          select: { id: true },
          take: 1,
        },
      },
    }),
    db.adminAccessGrant.findUnique({
      where: { email },
      select: {
        id: true,
        level: true,
        status: true,
        previousRole: true,
        clerkInvitationId: true,
        invitationExpiresAt: true,
      },
    }),
  ]);

  if (target && target.role !== "admin") {
    throw new AdminAccessError(
      "Use a separate internal staff email rather than an existing homeowner or provider account.",
    );
  }
  if (target && (target.communityMemberships.length > 0 || target.staffAssignments.length > 0)) {
    throw new AdminAccessError(
      "Use a separate internal staff email rather than an account with customer or HOA access.",
    );
  }
  if (existingGrant?.level === "owner") {
    throw new AdminAccessError("The primary owner already has permanent admin access.");
  }
  if (existingGrant?.status === "active") {
    throw new AdminAccessError("That account already has admin access.");
  }
  if (
    existingGrant?.status === "pending" &&
    (!existingGrant.invitationExpiresAt || existingGrant.invitationExpiresAt > new Date())
  ) {
    throw new AdminAccessError("A current admin invitation has already been sent to that email.");
  }

  if (existingGrant?.clerkInvitationId) {
    try {
      const client = await clerkClient();
      await client.invitations.revokeInvitation(existingGrant.clerkInvitationId);
    } catch {
      // A stale Clerk ticket still has no authority; the Bundleen grant below
      // is replaced and exact-email verification remains mandatory.
    }
  }

  const now = new Date();
  const grantId = existingGrant?.id ?? randomUUID();
  const invitationExpiresAt = new Date(
    now.getTime() + ADMIN_INVITATION_LIFETIME_DAYS * 24 * 60 * 60 * 1_000,
  );

  let clerkInvitation: Awaited<ReturnType<typeof createAdminClerkInvitation>>;
  try {
    clerkInvitation = await createAdminClerkInvitation({
      grantId,
      email,
      fullName: input.fullName,
      requestUrl: input.requestUrl,
    });
  } catch {
    throw new AdminAccessError(
      "The admin invitation email could not be sent. Check the address and try again.",
      502,
    );
  }

  try {
    await db.$transaction([
      db.adminAccessGrant.upsert({
        where: { email },
        create: {
          id: grantId,
          email,
          inviteeName: input.fullName,
          level: "admin",
          status: "pending",
          userId: target?.id ?? null,
          previousRole: existingGrant?.previousRole ?? null,
          clerkInvitationId: clerkInvitation.id,
          invitationExpiresAt,
          grantedByUserId: input.actorUserId,
          grantedAt: now,
        },
        update: {
          inviteeName: input.fullName,
          status: "pending",
          userId: target?.id ?? null,
          previousRole: existingGrant?.previousRole ?? null,
          clerkInvitationId: clerkInvitation.id,
          invitationExpiresAt,
          grantedByUserId: input.actorUserId,
          grantedAt: now,
          acceptedAt: null,
          revokedByUserId: null,
          revokedAt: null,
        },
      }),
      db.adminAuditLog.create({
        data: buildAuditEntry({
          actorUserId: input.actorUserId,
          action: "admin_access_granted",
          targetType: "admin_access",
          targetId: grantId,
          metadata: { nextStatus: "pending" },
        }),
      }),
    ]);
  } catch (error) {
    try {
      const client = await clerkClient();
      await client.invitations.revokeInvitation(clerkInvitation.id);
    } catch {
      // No matching active Bundleen grant means the orphaned ticket is inert.
    }
    throw error;
  }

  const created = await db.adminAccessGrant.findUnique({
    where: { id: grantId },
    select: accessSelect,
  });
  if (!created) throw new AdminAccessError("Admin invitation was not saved.", 500);
  return serializeAccess(created);
}

export async function revokeAdminAccess(input: {
  actorUserId: string;
  grantId: string;
}): Promise<AdminAccessSummary> {
  const grant = await db.adminAccessGrant.findUnique({
    where: { id: input.grantId },
    select: {
      id: true,
      email: true,
      level: true,
      status: true,
      userId: true,
      previousRole: true,
      clerkInvitationId: true,
    },
  });

  if (!grant) throw new AdminAccessError("Admin access record not found.", 404);
  if (grant.level === "owner" || isPrimaryAdminEmail(grant.email)) {
    throw new AdminAccessError("The primary owner's access cannot be revoked.", 403);
  }
  if (grant.status === "revoked") {
    throw new AdminAccessError("That admin invitation or access is already revoked.");
  }

  const now = new Date();
  const notificationOps = grant.status === "active" && grant.userId
    ? await buildPreferenceAwareNotificationOps([
        {
          userId: grant.userId,
          email: grant.email,
          emailPolicy: "required",
          kind: "security",
          title: "Bundleen admin access removed",
          body: "Your internal Bundleen admin access was removed. If you did not expect this change, contact the primary owner immediately.",
          linkPath: "/",
          dedupeKey: `admin-access-revoked:${grant.id}:${now.toISOString()}`,
        },
      ])
    : [];

  await db.$transaction([
    db.adminAccessGrant.update({
      where: { id: grant.id },
      data: {
        status: "revoked",
        revokedByUserId: input.actorUserId,
        revokedAt: now,
      },
    }),
    ...(grant.status === "active" && grant.userId && grant.previousRole
      ? [
          db.user.update({
            where: { id: grant.userId },
            data: {
              role: grant.previousRole,
              ...(grant.previousRole === "homeowner"
                ? { homeownerProfile: { upsert: { create: {}, update: {} } } }
                : grant.previousRole === "provider"
                  ? { providerProfile: { upsert: { create: {}, update: {} } } }
                  : {}),
            },
          }),
        ]
      : []),
    db.adminAuditLog.create({
      data: buildAuditEntry({
        actorUserId: input.actorUserId,
        action: "admin_access_revoked",
        targetType: "admin_access",
        targetId: grant.id,
        metadata: { previousStatus: grant.status, nextStatus: "revoked" },
      }),
    }),
    ...notificationOps,
  ]);

  if (grant.clerkInvitationId) {
    try {
      const client = await clerkClient();
      await client.invitations.revokeInvitation(grant.clerkInvitationId);
    } catch {
      // Revoked database state is authoritative even if Clerk cleanup fails.
    }
  }

  const revoked = await db.adminAccessGrant.findUnique({
    where: { id: grant.id },
    select: accessSelect,
  });
  if (!revoked) throw new AdminAccessError("Admin access was not revoked.", 500);
  return serializeAccess(revoked);
}
