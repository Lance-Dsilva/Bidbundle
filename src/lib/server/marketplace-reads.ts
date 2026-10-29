import "server-only";

import { compareBidQuotes } from "@/lib/bid-pricing";
import type { BidSummary } from "@/lib/hoa-types";
import { db } from "@/lib/server/db";

/**
 * Cross-cutting reads the dashboards need: a homeowner's incoming quotes and a
 * provider's earnings.
 *
 * Both are aggregates over persisted marketplace rows. Neither takes a
 * parameter that could widen its scope: the account id is in the `where`, and
 * there is nothing a caller can pass to see somebody else's money.
 */

/* ── Homeowner: quotes on my requests ────────────────────────────────────── */

export type HomeownerBidView = BidSummary & {
  requestTitle: string;
  requestStatus: string;
  requestCategory: string;
  communityName: string;
  /** Whether this account may accept it — the manager, on a closed request. */
  canAward: boolean;
};

/**
 * Quotes on requests this homeowner opened or joined.
 *
 * `canAward` is computed here rather than guessed in the browser: a
 * participant sees the same transparent comparison the manager does, but only
 * the manager's rows come back awardable, and the award endpoint re-checks
 * anyway.
 */
export async function listHomeownerBids(userId: string): Promise<HomeownerBidView[]> {
  const managedCommunityIds = await db.communityStaffAssignment
    .findMany({
      where: {
        userId,
        role: "neighborhood_manager",
        status: "active",
        community: { type: "neighborhood", status: "active" },
        user: { communityMemberships: { some: { status: "active" } } },
      },
      select: { communityId: true },
    })
    .then((rows) => new Set(rows.map((row) => row.communityId)));

  const rows = await db.serviceBid.findMany({
    where: {
      status: { in: ["submitted", "accepted", "rejected"] },
      request: {
        community: { type: "neighborhood" },
        OR: [
          { createdByUserId: userId },
          { participations: { some: { userId, response: "joined" } } },
        ],
      },
    },
    orderBy: { id: "asc" },
    take: 200,
    include: {
      request: {
        select: {
          title: true,
          status: true,
          category: true,
          communityId: true,
          totalOccurrences: true,
          _count: { select: { participations: { where: { response: "joined" } } } },
          community: { select: { name: true } },
        },
      },
      provider: {
        select: {
          fullName: true,
          providerProfile: {
            select: {
              companyName: true,
              licenseVerifiedAt: true,
              insuranceVerifiedAt: true,
            },
          },
        },
      },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    requestId: row.requestId,
    providerUserId: row.providerUserId,
    providerName: row.provider.fullName,
    providerCompany: row.provider.providerProfile?.companyName ?? null,
    providerVerified: Boolean(
      row.provider.providerProfile?.licenseVerifiedAt &&
        row.provider.providerProfile.insuranceVerifiedAt,
    ),
    status: row.status,
    amountCents: row.amountCents,
    currency: row.currency,
    pricingBasis: row.pricingBasis,
    perHomeCents: row.perHomeCents,
    homeCount: row.request._count?.participations,
    totalOccurrences: row.request.totalOccurrences,
    proposedStartDate: row.proposedStartDate?.toISOString() ?? null,
    estimatedDurationLabel: row.estimatedDurationLabel,
    scope: row.scope,
    exclusions: row.exclusions,
    cadenceLabel: row.cadenceLabel,
    validUntil: row.validUntil?.toISOString() ?? null,
    version: row.version,
    submittedAt: row.submittedAt.toISOString(),
    requestTitle: row.request.title,
    requestStatus: row.request.status,
    requestCategory: row.request.category,
    communityName: row.request.community.name,
    canAward:
      row.status === "submitted" &&
      row.pricingBasis === "total" &&
      ["open_for_bids", "bidding_closed"].includes(row.request.status) &&
      managedCommunityIds.has(row.request.communityId),
  })).sort((a, b) => a.requestId.localeCompare(b.requestId) || compareBidQuotes(a, b));
}

/* ── Provider: earnings ──────────────────────────────────────────────────── */

export type ProviderEarnings = {
  /** Agreed value of work that is fully complete, in whole cents. */
  earnedCents: number;
  /** Agreed value of active agreements not yet complete. */
  pendingCents: number;
  /** Completed in the current calendar month. */
  thisMonthCents: number;
  completedJobs: number;
  activeJobs: number;
  averageJobCents: number;
  /** Completed visits across every agreement — the unit of work actually done. */
  completedVisits: number;
  currency: string;
  recent: Array<{
    agreementId: string;
    requestTitle: string;
    communityName: string;
    context: "hoa" | "neighborhood";
    amountCents: number;
    status: "active" | "completed" | "cancelled";
    completedAt: string | null;
    startDate: string | null;
  }>;
};

/**
 * Real earnings, derived from agreements this provider actually won.
 *
 * Money is the agreement's snapshotted `amountCents` — the terms accepted at
 * award — not a recomputation from the current bid row, which the provider
 * could otherwise have edited. Bundleen holds no payment rails yet, so
 * "earned" means "work completed under an agreement", stated plainly rather
 * than dressed up as a payout balance.
 */
export async function getProviderEarnings(providerUserId: string): Promise<ProviderEarnings> {
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);

  const [agreements, completedVisits] = await Promise.all([
    db.serviceAgreement.findMany({
      where: { providerUserId },
      orderBy: { createdAt: "desc" },
      take: 200,
      select: {
        id: true,
        amountCents: true,
        currency: true,
        status: true,
        startDate: true,
        updatedAt: true,
        request: { select: { title: true } },
        community: { select: { name: true, type: true } },
      },
    }),
    db.serviceVisit.count({
      where: {
        status: "completed",
        occurrence: { agreement: { providerUserId } },
      },
    }),
  ]);

  const completed = agreements.filter((agreement) => agreement.status === "completed");
  const active = agreements.filter((agreement) => agreement.status === "active");

  const earnedCents = completed.reduce((sum, agreement) => sum + agreement.amountCents, 0);
  const pendingCents = active.reduce((sum, agreement) => sum + agreement.amountCents, 0);
  const thisMonthCents = completed
    .filter((agreement) => agreement.updatedAt >= monthStart)
    .reduce((sum, agreement) => sum + agreement.amountCents, 0);

  return {
    earnedCents,
    pendingCents,
    thisMonthCents,
    completedJobs: completed.length,
    activeJobs: active.length,
    averageJobCents: completed.length > 0 ? Math.round(earnedCents / completed.length) : 0,
    completedVisits,
    currency: agreements[0]?.currency ?? "usd",
    recent: agreements.slice(0, 20).map((agreement) => ({
      agreementId: agreement.id,
      requestTitle: agreement.request.title,
      communityName: agreement.community.name,
      context: agreement.community.type === "hoa" ? "hoa" : "neighborhood",
      amountCents: agreement.amountCents,
      status: agreement.status,
      completedAt: agreement.status === "completed" ? agreement.updatedAt.toISOString() : null,
      startDate: agreement.startDate?.toISOString() ?? null,
    })),
  };
}
