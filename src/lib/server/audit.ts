import "server-only";

import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { AdminAuditAction, AdminAuditTargetType } from "@/generated/prisma/enums";
import type { AuditEntry } from "@/lib/community-types";

/**
 * The immutable record of what Bundleen staff did, plus narrowly defined
 * automatic safety events whose actor is the server.
 *
 * Writes go through {@link buildAuditEntry} so every caller produces the same
 * shape, and through {@link redactAuditMetadata} so no caller can accidentally
 * put a street address, a coordinate, a policy number, or a token into a table
 * that by design can never be edited or deleted afterwards.
 */

export type AuditActor = { id: string };

/**
 * Closed set of structured, non-secret facts allowed in an immutable record.
 * Free-form notes are intentionally absent: staff must never be able to paste
 * an address, credential, token, or medical/financial detail into a row that
 * cannot later be corrected or deleted.
 */
const ALLOWED_METADATA_KEYS = new Set([
  "type",
  "radiusMiles",
  "changedFields",
  "previousStatus",
  "nextStatus",
  "nextRadiusMiles",
  "memberUserId",
  "status",
  "isAdminOverride",
  "distanceMi",
  "isWithinRadius",
  "revokedRoles",
  "assigneeUserId",
  "role",
  "reason",
  "replacedAssignmentId",
]);

const MAX_METADATA_STRING_LENGTH = 200;
const MAX_METADATA_KEYS = 24;

/**
 * Strips anything the log must not hold and flattens the rest to primitives.
 *
 * Unknown keys fail closed. Callers adding a new structured audit fact must
 * explicitly review and add that key here.
 */
export function redactAuditMetadata(
  metadata: Record<string, unknown> | null | undefined,
): Record<string, string | number | boolean | null> | null {
  if (!metadata) return null;

  const safe: Record<string, string | number | boolean | null> = {};

  for (const [key, value] of Object.entries(metadata)) {
    if (Object.keys(safe).length >= MAX_METADATA_KEYS) break;
    if (!ALLOWED_METADATA_KEYS.has(key)) continue;
    if (value === undefined) continue;

    if (value === null || typeof value === "boolean") {
      safe[key] = value;
    } else if (typeof value === "number") {
      safe[key] = Number.isFinite(value) ? value : null;
    } else if (typeof value === "string") {
      safe[key] = value.slice(0, MAX_METADATA_STRING_LENGTH);
    } else if (Array.isArray(value)) {
      safe[key] = value
        .filter((item): item is string => typeof item === "string")
        .join(", ")
        .slice(0, MAX_METADATA_STRING_LENGTH);
    }
    // Anything else (nested objects, dates, functions) is dropped: the log is
    // for reading, and a caller who needs a date should pass an ISO string.
  }

  return safe;
}

export type AuditInput = {
  /** Null only for an automatic server action, never for an admin request. */
  actorUserId: string | null;
  action: AdminAuditAction;
  targetType: AdminAuditTargetType;
  targetId: string;
  communityId?: string | null;
  providerUserId?: string | null;
  metadata?: Record<string, unknown> | null;
};

/**
 * Builds the `create` payload for one audit row.
 *
 * Returned rather than written so a service can include it in the same nested
 * write as the change it describes — an action that succeeded but went
 * unlogged is the one outcome this table exists to prevent.
 */
export function buildAuditEntry(input: AuditInput): Prisma.AdminAuditLogCreateInput {
  return {
    ...(input.actorUserId ? { actor: { connect: { id: input.actorUserId } } } : {}),
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    ...(input.communityId ? { community: { connect: { id: input.communityId } } } : {}),
    providerUserId: input.providerUserId ?? null,
    metadata: redactAuditMetadata(input.metadata) ?? undefined,
  };
}

/**
 * Writes one audit row.
 *
 * Accepts a transaction client so a caller inside `$transaction` logs on the
 * same connection and rolls back with the change it describes.
 */
export async function recordAudit(
  client: Pick<PrismaClient, "adminAuditLog">,
  input: AuditInput,
): Promise<void> {
  await client.adminAuditLog.create({ data: buildAuditEntry(input) });
}

/* ── Presentation ────────────────────────────────────────────────────────── */

const ACTION_SUMMARIES: Record<AdminAuditAction, string> = {
  community_created: "created the community",
  community_updated: "updated community details",
  community_archived: "archived the community",
  community_restored: "restored the community",
  member_added: "added a member",
  member_status_changed: "changed a member's status",
  member_removed: "removed a member",
  staff_assigned: "assigned a community role",
  staff_revoked: "revoked a community role",
  provider_status_changed: "changed a provider's account status",
  provider_license_verified: "verified a provider licence",
  provider_license_revoked: "revoked a provider licence verification",
  provider_insurance_verified: "verified provider insurance",
  provider_insurance_revoked: "revoked provider insurance verification",
  admin_access_granted: "granted admin portal access",
  admin_access_revoked: "revoked admin portal access",
};

export function auditActionSummary(action: AdminAuditAction): string {
  return ACTION_SUMMARIES[action] ?? "performed an action";
}

type AuditRow = {
  id: string;
  action: AdminAuditAction;
  targetType: AdminAuditTargetType;
  targetId: string;
  communityId: string | null;
  providerUserId: string | null;
  metadata: unknown;
  createdAt: Date;
  actor: {
    id: string;
    fullName: string;
    email: string;
    role: string;
    avatarUrl: string | null;
  } | null;
  community: { name: string } | null;
};

export function serializeAuditEntry(
  row: AuditRow,
  toPerson: (actor: NonNullable<AuditRow["actor"]>) => AuditEntry["actor"],
): AuditEntry {
  return {
    id: row.id,
    action: row.action,
    summary: auditActionSummary(row.action),
    targetType: row.targetType,
    targetId: row.targetId,
    actor: row.actor ? toPerson(row.actor) : null,
    communityId: row.communityId,
    communityName: row.community?.name ?? null,
    providerUserId: row.providerUserId,
    metadata:
      row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
        ? (row.metadata as Record<string, unknown>)
        : null,
    createdAt: row.createdAt.toISOString(),
  };
}
