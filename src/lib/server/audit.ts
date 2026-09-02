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
  "isPrimary",
  "distanceMi",
  "isWithinRadius",
  "revokedRoles",
  "assigneeUserId",
  "role",
  "reason",
  "replacedAssignmentId",
  "kind",
  "category",
  "onboardingStatus",
  "unitCount",
  "importedCount",
  "duplicateCount",
  "updatedCount",
  "lockedHomeCount",
  "amountCents",
  "currency",
  "sequence",
  "stopCount",
  "occurrenceCount",
  "visitCount",
  "rating",
  // ── Shared HOA / neighbourhood marketplace ────────────────────────────
  /** `hoa` or `neighborhood` — which workflow a transition belonged to. */
  "context",
  /**
   * Which rule granted the authority: `hoa_manager`, `neighborhood_manager`,
   * or `admin_recovery`. The whole point of the recovery path is that it is
   * distinguishable afterwards, which requires this key to survive redaction.
   */
  "via",
  // ── Address verification ──────────────────────────────────────────────
  /** Which record was verified — `hoa_profile`, `unit_import`. Never an address. */
  "subject",
  /** Whether a profile save re-ran the geocoder. */
  "addressReVerified",
  /** Import outcome counts. Counts only; labels and addresses stay out. */
  "resolvedCount",
  "unresolvedCount",
  /** Deadline reconciliation totals. */
  "biddingClosed",
  "enrollmentExpired",
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
  community_invitation_sent: "sent a community invitation",
  community_invitation_accepted: "accepted a community invitation",
  community_invitation_revoked: "revoked a community invitation",
  hoa_request_created: "created an HOA service request",
  hoa_request_status_changed: "changed an HOA service request",
  hoa_survey_created: "created an HOA resident survey",
  hoa_survey_status_changed: "changed an HOA resident survey",
  hoa_profile_updated: "updated the HOA profile",
  hoa_unit_created: "added an HOA home/unit",
  hoa_unit_updated: "updated an HOA home/unit",
  hoa_unit_removed: "removed an unused HOA home/unit",
  hoa_units_imported: "imported HOA homes/units",
  hoa_participants_locked: "locked request participants",
  hoa_bid_awarded: "awarded a service bid",
  hoa_schedule_published: "published a service schedule",
  address_verified: "verified a postal address",
  address_verification_failed: "could not verify a postal address",
  marketplace_recovery_action: "performed a marketplace recovery action",
  hoa_visit_corrected: "corrected a service visit",
  review_moderated: "moderated a review",
  provider_service_area_changed: "changed a provider service area",
  support_ticket_assigned: "assigned a support ticket",
  support_ticket_status_changed: "changed a support ticket's status",
  support_ticket_priority_changed: "changed a support ticket's priority",
  support_ticket_created: "opened a support ticket for a customer",
  support_ticket_replied: "replied to a support ticket",
  support_ticket_ai_draft_approved: "approved and sent an AI-assisted support reply",
  broadcast_created: "created an operational broadcast",
  broadcast_updated: "edited an operational broadcast draft",
  broadcast_test_sent: "sent themselves a broadcast test",
  broadcast_sent: "sent a global operational broadcast",
  broadcast_discarded: "discarded a broadcast draft",
  admin_permissions_changed: "changed an admin's permissions",
  amenity_created: "created an HOA amenity",
  amenity_updated: "updated an HOA amenity",
  amenity_published: "changed an amenity's publication status",
  amenity_archived: "archived an HOA amenity",
  amenity_closure_changed: "changed an amenity closure",
  amenity_booking_status_changed: "changed an amenity booking",
  amenity_issue_status_changed: "changed an amenity issue",
  amenity_issue_assigned: "assigned an amenity issue",
  amenity_review_moderated: "moderated an amenity review",
  amenity_broadcast_sent: "sent an HOA amenity message",
  amenity_media_removed: "removed an amenity photo",
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
