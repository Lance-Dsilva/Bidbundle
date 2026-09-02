import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import type { AuditListQuery } from "@/lib/validation/community";

const AGE_MS = {
  "24h": 24 * 60 * 60 * 1_000,
  "7d": 7 * 24 * 60 * 60 * 1_000,
  "30d": 30 * 24 * 60 * 60 * 1_000,
  "90d": 90 * 24 * 60 * 60 * 1_000,
} as const;

/** Builds the one authoritative database filter used by the page and API. */
export function buildAuditWhere(
  query: AuditListQuery,
  now: Date = new Date(),
): Prisma.AdminAuditLogWhereInput {
  const related: Prisma.AdminAuditLogWhereInput =
    query.related === "community"
      ? { communityId: { not: null } }
      : query.related === "provider"
        ? { providerUserId: { not: null } }
        : query.related === "internal"
          ? { communityId: null, providerUserId: null }
          : {};

  return {
    ...(query.communityId ? { communityId: query.communityId } : {}),
    ...(query.providerUserId ? { providerUserId: query.providerUserId } : {}),
    ...(query.action ? { action: query.action } : {}),
    ...(query.actorUserId === "system"
      ? { actorUserId: null }
      : query.actorUserId
        ? { actorUserId: query.actorUserId }
        : {}),
    ...(query.age
      ? { createdAt: { gte: new Date(now.getTime() - AGE_MS[query.age]) } }
      : {}),
    ...related,
  };
}
