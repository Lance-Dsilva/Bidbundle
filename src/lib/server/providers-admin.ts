import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { CommunityRuleError } from "@/lib/community-rules";
import type {
  AdminPersonSummary,
  ProviderDetail,
  ProviderListResult,
  ProviderSummary,
} from "@/lib/community-types";
import { buildAuditEntry, serializeAuditEntry } from "@/lib/server/audit";
import { auditSelect, toPersonSummary } from "@/lib/server/communities";
import { db } from "@/lib/server/db";
import type {
  ProviderAccountStatus,
  ProviderAdminUpdateInput,
  ProviderListQuery,
} from "@/lib/validation/community";

/**
 * Provider administration for the internal portal.
 *
 * The fields written here are exactly the ones a provider cannot write about
 * themselves: account status and the two verification timestamps. The provider
 * supplies claims — a licence number, an insurer — and staff decide, from
 * evidence handled off-platform, whether those claims have been checked. Every
 * change records who made it and when, in the provider row for display and in
 * the append-only audit log for the record.
 */

const personSelect = {
  id: true,
  fullName: true,
  email: true,
  role: true,
  avatarUrl: true,
} as const;

const providerSummarySelect = {
  userId: true,
  companyName: true,
  trades: true,
  accountStatus: true,
  accountStatusUpdatedAt: true,
  licenseVerifiedAt: true,
  insuranceVerifiedAt: true,
  updatedAt: true,
  createdAt: true,
  user: { select: { ...personSelect, neighborhood: true } },
} as const;

type ProviderSummaryRow = {
  userId: string;
  companyName: string | null;
  trades: string[];
  accountStatus: string;
  accountStatusUpdatedAt: Date | null;
  licenseVerifiedAt: Date | null;
  insuranceVerifiedAt: Date | null;
  updatedAt: Date;
  createdAt: Date;
  user: {
    id: string;
    fullName: string;
    email: string;
    role: string;
    avatarUrl: string | null;
    neighborhood: string | null;
  };
};

function serializeProviderSummary(row: ProviderSummaryRow): ProviderSummary {
  return {
    userId: row.userId,
    user: toPersonSummary(row.user),
    companyName: row.companyName,
    trades: row.trades,
    serviceArea: row.user.neighborhood,
    accountStatus: row.accountStatus as ProviderAccountStatus,
    accountStatusUpdatedAt: row.accountStatusUpdatedAt?.toISOString() ?? null,
    // "Verified" means a staff member recorded a timestamp. A provider filling
    // in a licence number never moves this to true.
    isLicenseVerified: row.licenseVerifiedAt !== null,
    isInsuranceVerified: row.insuranceVerifiedAt !== null,
    updatedAt: row.updatedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listProviders(query: ProviderListQuery): Promise<ProviderListResult> {
  const tradeSearchVariants = query.search
    ? [...new Set([
        query.search,
        query.search.toLowerCase(),
        query.search.toUpperCase(),
        query.search.replace(/\b\w/g, (letter) => letter.toUpperCase()),
      ])]
    : [];
  const where: Prisma.ProviderProfileWhereInput = {
    ...(query.status ? { accountStatus: query.status } : {}),
    ...(query.verification === "verified"
      ? { licenseVerifiedAt: { not: null }, insuranceVerifiedAt: { not: null } }
      : query.verification === "unverified"
        ? { OR: [{ licenseVerifiedAt: null }, { insuranceVerifiedAt: null }] }
        : {}),
    ...(query.search
      ? {
          AND: [
            {
              OR: [
                { companyName: { contains: query.search, mode: "insensitive" } },
                { user: { fullName: { contains: query.search, mode: "insensitive" } } },
                { user: { email: { contains: query.search, mode: "insensitive" } } },
                // Array membership itself is case-sensitive, so include the
                // common normalized spellings used by provider forms.
                { trades: { hasSome: tradeSearchVariants } },
              ],
            },
          ],
        }
      : {}),
  };

  const [total, rows] = await Promise.all([
    db.providerProfile.count({ where }),
    db.providerProfile.findMany({
      where,
      select: providerSummarySelect,
      orderBy: [{ accountStatus: "asc" }, { createdAt: "desc" }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);

  return {
    providers: rows.map(serializeProviderSummary),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
}

export async function getProviderDetail(userId: string): Promise<ProviderDetail | null> {
  const row = await db.providerProfile.findUnique({
    where: { userId },
    select: {
      ...providerSummarySelect,
      bio: true,
      licenseNumber: true,
      licenseState: true,
      insuranceProvider: true,
      insurancePolicyNumber: true,
      licenseVerifiedByUserId: true,
      insuranceVerifiedByUserId: true,
      accountStatusUpdatedByUserId: true,
      accountStatusNote: true,
      user: { select: { ...personSelect, neighborhood: true, phone: true } },
    },
  });

  if (!row) return null;

  // The three "who did this" columns are plain ids, so the names are resolved
  // in one extra query rather than three relations that exist only for display.
  const actorIds = [
    row.licenseVerifiedByUserId,
    row.insuranceVerifiedByUserId,
    row.accountStatusUpdatedByUserId,
  ].filter((value): value is string => typeof value === "string");

  const [actors, approvals, recentAudit] = await Promise.all([
    actorIds.length > 0
      ? db.user.findMany({ where: { id: { in: actorIds } }, select: personSelect })
      : Promise.resolve([]),
    db.providerCommunityApproval.findMany({
      where: { providerUserId: userId },
      select: { community: { select: { id: true, name: true, type: true } } },
      orderBy: { createdAt: "desc" },
    }),
    db.adminAuditLog.findMany({
      where: { providerUserId: userId },
      select: auditSelect,
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
  ]);

  const actorById = new Map<string, AdminPersonSummary>(
    actors.map((actor) => [actor.id, toPersonSummary(actor)]),
  );
  const actorOrNull = (id: string | null) => (id ? (actorById.get(id) ?? null) : null);

  return {
    ...serializeProviderSummary(row),
    bio: row.bio,
    phone: row.user.phone,
    licenseNumber: row.licenseNumber,
    licenseState: row.licenseState,
    insuranceProvider: row.insuranceProvider,
    insurancePolicyNumber: row.insurancePolicyNumber,
    licenseVerifiedAt: row.licenseVerifiedAt?.toISOString() ?? null,
    licenseVerifiedBy: actorOrNull(row.licenseVerifiedByUserId),
    insuranceVerifiedAt: row.insuranceVerifiedAt?.toISOString() ?? null,
    insuranceVerifiedBy: actorOrNull(row.insuranceVerifiedByUserId),
    accountStatusUpdatedBy: actorOrNull(row.accountStatusUpdatedByUserId),
    accountStatusNote: row.accountStatusNote,
    approvedCommunities: approvals.map((approval) => ({
      id: approval.community.id,
      name: approval.community.name,
      type: approval.community.type as ProviderDetail["approvedCommunities"][number]["type"],
    })),
    recentAudit: recentAudit.map((entry) => serializeAuditEntry(entry, toPersonSummary)),
  };
}

/**
 * Applies a status and/or verification change.
 *
 * Verification is requested as `verify` / `revoke`; the timestamp comes from
 * this process's clock. Sending the state a provider is already in is a no-op
 * rather than an error, which is what makes a double-submitted form safe.
 *
 * A licence cannot be verified while there is no licence claim to verify —
 * otherwise the profile would show a verification badge over an empty field.
 */
export async function updateProviderAdministration(
  actor: { id: string },
  userId: string,
  input: ProviderAdminUpdateInput,
): Promise<{ changed: boolean }> {
  const provider = await db.providerProfile.findUnique({
    where: { userId },
    select: {
      accountStatus: true,
      licenseNumber: true,
      licenseVerifiedAt: true,
      insuranceProvider: true,
      insuranceVerifiedAt: true,
    },
  });

  if (!provider) {
    throw new CommunityRuleError("not_found", "That provider account no longer exists.");
  }

  if (actor.id === userId) {
    throw new CommunityRuleError(
      "self_assignment",
      "You cannot change the status or verification of your own account.",
    );
  }

  if (
    (input.accountStatus || input.license || input.insurance) &&
    (!input.expectedUpdatedAt || !Number.isFinite(new Date(input.expectedUpdatedAt).getTime()))
  ) {
    throw new CommunityRuleError(
      "stale_review",
      "Reload this provider and review the latest account state before making this change.",
    );
  }

  if (input.license === "verify" && !provider.licenseNumber) {
    throw new CommunityRuleError(
      "not_found",
      "This provider has not submitted a licence number to verify.",
    );
  }
  if (input.insurance === "verify" && !provider.insuranceProvider) {
    throw new CommunityRuleError(
      "not_found",
      "This provider has not submitted insurance details to verify.",
    );
  }

  const now = new Date();
  const data: Prisma.ProviderProfileUpdateInput = {};
  const auditEntries: Prisma.AdminAuditLogCreateInput[] = [];

  const statusChanging =
    input.accountStatus !== undefined && input.accountStatus !== provider.accountStatus;

  if (statusChanging) {
    data.accountStatus = input.accountStatus;
    data.accountStatusUpdatedAt = now;
    data.accountStatusUpdatedByUserId = actor.id;
    data.accountStatusNote = input.note ?? null;

    auditEntries.push(
      buildAuditEntry({
        actorUserId: actor.id,
        action: "provider_status_changed",
        targetType: "provider",
        targetId: userId,
        providerUserId: userId,
        metadata: {
          previousStatus: provider.accountStatus,
          nextStatus: input.accountStatus,
          note: input.note ?? null,
        },
      }),
    );
  }

  const licenseChanging =
    input.license !== undefined &&
    (input.license === "verify") !== (provider.licenseVerifiedAt !== null);

  if (licenseChanging) {
    const verifying = input.license === "verify";
    data.licenseVerifiedAt = verifying ? now : null;
    data.licenseVerifiedByUserId = verifying ? actor.id : null;

    auditEntries.push(
      buildAuditEntry({
        actorUserId: actor.id,
        action: verifying ? "provider_license_verified" : "provider_license_revoked",
        targetType: "provider",
        targetId: userId,
        providerUserId: userId,
        metadata: { note: input.note ?? null },
      }),
    );
  }

  const insuranceChanging =
    input.insurance !== undefined &&
    (input.insurance === "verify") !== (provider.insuranceVerifiedAt !== null);

  if (insuranceChanging) {
    const verifying = input.insurance === "verify";
    data.insuranceVerifiedAt = verifying ? now : null;
    data.insuranceVerifiedByUserId = verifying ? actor.id : null;

    auditEntries.push(
      buildAuditEntry({
        actorUserId: actor.id,
        action: verifying ? "provider_insurance_verified" : "provider_insurance_revoked",
        targetType: "provider",
        targetId: userId,
        providerUserId: userId,
        metadata: { note: input.note ?? null },
      }),
    );
  }

  if (auditEntries.length === 0) return { changed: false };

  await db.$transaction([
    db.providerProfile.update({
      where: {
        userId,
        ...(input.expectedUpdatedAt
          ? { updatedAt: new Date(input.expectedUpdatedAt) }
          : {}),
      },
      data,
    }),
    ...auditEntries.map((entry) => db.adminAuditLog.create({ data: entry })),
  ]);

  return { changed: true };
}

/**
 * Whether a provider may perform provider-only writes.
 *
 * Suspension blocks new bidding and other provider mutations; it never touches
 * existing bids or jobs, which stay readable exactly as they were. Call this
 * from every provider write endpoint as those are built — a suspended account
 * that can still act is a suspension in name only.
 */
export async function assertProviderCanAct(
  userId: string,
  options: { requireActive?: boolean } = {},
): Promise<void> {
  const provider = await db.providerProfile.findUnique({
    where: { userId },
    select: { accountStatus: true },
  });

  if (!provider) {
    throw new CommunityRuleError("not_found", "No provider profile found for this account.");
  }

  if (provider.accountStatus === "suspended") {
    throw new CommunityRuleError(
      "provider_not_active",
      "This provider account is suspended. Contact Bundleen support to restore it.",
    );
  }

  if (options.requireActive && provider.accountStatus === "pending") {
    throw new CommunityRuleError(
      "provider_not_active",
      "This provider account is awaiting Bundleen review before it can bid.",
    );
  }
}
