import "server-only";

import { randomUUID } from "node:crypto";

import type { UserRole } from "@/generated/prisma/enums";
import type { AdminAccessSummary } from "@/lib/admin-access";
import { isPrimaryAdminEmail } from "@/lib/admin-access";
import { buildAuditEntry } from "@/lib/server/audit";
import { db } from "@/lib/server/db";
import { normalizeEmail } from "@/lib/validation/auth";

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
  level: true,
  status: true,
  grantedAt: true,
  acceptedAt: true,
  revokedAt: true,
  user: { select: { fullName: true } },
  grantedBy: { select: { fullName: true } },
} as const;

type AccessRow = {
  id: string;
  email: string;
  level: "owner" | "admin";
  status: "pending" | "active" | "revoked";
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
    fullName: row.user?.fullName ?? null,
    grantedByName: row.grantedBy?.fullName ?? null,
    grantedAt: row.grantedAt.toISOString(),
    acceptedAt: row.acceptedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
  };
}

export async function listAdminAccess(): Promise<AdminAccessSummary[]> {
  const rows = await db.adminAccessGrant.findMany({
    select: accessSelect,
    orderBy: [{ level: "desc" }, { grantedAt: "asc" }],
  });
  return rows.map(serializeAccess);
}

/** Links a verified Clerk sign-in to a previously approved email grant. */
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
    select: { id: true, status: true, previousRole: true, userId: true },
  });
  if (!grant || grant.status === "revoked") return false;

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

  // Never relink a Bundleen profile to a different Clerk identity.
  if (byEmail && byEmail.clerkUserId !== input.clerkUserId) return false;
  if (byClerk && normalizeEmail(byClerk.email) !== email) return false;

  const previousRole: UserRole =
    grant.previousRole ?? (byClerk?.role === "admin" ? "homeowner" : byClerk?.role ?? "homeowner");

  const user = await db.user.upsert({
    where: { clerkUserId: input.clerkUserId },
    create: {
      clerkUserId: input.clerkUserId,
      email,
      fullName: input.fullName || email.split("@")[0],
      role: "admin",
      isVerified: true,
    },
    update: {
      email,
      fullName: input.fullName || undefined,
      role: "admin",
      isVerified: true,
    },
    select: { id: true },
  });

  await db.adminAccessGrant.update({
    where: { id: grant.id },
    data: {
      status: "active",
      userId: user.id,
      previousRole,
      acceptedAt: grant.status === "active" ? undefined : new Date(),
      revokedAt: null,
      revokedByUserId: null,
    },
  });
  return true;
}

/**
 * Grants access only to an existing, verified Bundleen identity.
 *
 * This is deliberately not an account-creation endpoint. Clerk remains the
 * only credential system and the recipient must already own the exact email.
 */
export async function grantAdminAccess(input: {
  actorUserId: string;
  email: string;
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
        isVerified: true,
        staffAssignments: {
          where: { status: "active" },
          select: { id: true },
          take: 1,
        },
      },
    }),
    db.adminAccessGrant.findUnique({
      where: { email },
      select: { id: true, level: true, status: true, previousRole: true },
    }),
  ]);

  if (!target || !target.isVerified) {
    throw new AdminAccessError(
      "That email must first belong to an existing, email-verified Bundleen account.",
      404,
    );
  }

  if (target.staffAssignments.length > 0) {
    throw new AdminAccessError(
      "Remove this account's active community-management role before granting internal admin access.",
    );
  }

  if (existingGrant?.level === "owner") {
    throw new AdminAccessError("The primary owner already has permanent admin access.");
  }
  if (existingGrant?.status === "active") {
    throw new AdminAccessError("That account already has admin access.");
  }

  const now = new Date();
  const grantId = existingGrant?.id ?? randomUUID();
  const previousRole: UserRole =
    target.role === "admin"
      ? existingGrant?.previousRole ?? "homeowner"
      : target.role;

  await db.$transaction([
    db.adminAccessGrant.upsert({
      where: { email },
      create: {
        id: grantId,
        email,
        level: "admin",
        status: "active",
        userId: target.id,
        previousRole,
        grantedByUserId: input.actorUserId,
        grantedAt: now,
        acceptedAt: now,
      },
      update: {
        status: "active",
        userId: target.id,
        previousRole,
        grantedByUserId: input.actorUserId,
        grantedAt: now,
        acceptedAt: now,
        revokedByUserId: null,
        revokedAt: null,
      },
    }),
    db.user.update({ where: { id: target.id }, data: { role: "admin" } }),
    db.adminAuditLog.create({
      data: buildAuditEntry({
        actorUserId: input.actorUserId,
        action: "admin_access_granted",
        targetType: "admin_access",
        targetId: grantId,
        metadata: { nextStatus: "active" },
      }),
    }),
  ]);

  const created = await db.adminAccessGrant.findUnique({
    where: { id: grantId },
    select: accessSelect,
  });
  if (!created) throw new AdminAccessError("Admin access was not saved.", 500);
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
    },
  });

  if (!grant) throw new AdminAccessError("Admin access record not found.", 404);
  if (grant.level === "owner" || isPrimaryAdminEmail(grant.email)) {
    throw new AdminAccessError("The primary owner's access cannot be revoked.", 403);
  }
  if (grant.status !== "active") {
    throw new AdminAccessError("That admin access is not active.");
  }

  const now = new Date();
  const nextRole: UserRole = grant.previousRole ?? "homeowner";
  const operations = [
    db.adminAccessGrant.update({
      where: { id: grant.id },
      data: {
        status: "revoked",
        revokedByUserId: input.actorUserId,
        revokedAt: now,
      },
    }),
    ...(grant.userId
      ? [
          db.user.update({
            where: { id: grant.userId },
            data: {
              role: nextRole,
              ...(nextRole === "homeowner"
                ? { homeownerProfile: { upsert: { create: {}, update: {} } } }
                : nextRole === "provider"
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
        metadata: { previousStatus: "active", nextStatus: "revoked" },
      }),
    }),
  ];

  await db.$transaction(operations);

  const revoked = await db.adminAccessGrant.findUnique({
    where: { id: grant.id },
    select: accessSelect,
  });
  if (!revoked) throw new AdminAccessError("Admin access was not revoked.", 500);
  return serializeAccess(revoked);
}
