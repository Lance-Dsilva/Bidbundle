import "server-only";

import type { ProviderAccountStatus } from "@/generated/prisma/enums";
import { db } from "@/lib/server/db";
import {
  countUnreadMessages,
  listConversations,
  type ConversationThread,
} from "@/lib/server/conversations";
import { getProviderRatingSummary } from "@/lib/server/provider-reviews";

/**
 * The provider dashboard's aggregate metrics, in one authorized read.
 *
 * This exists because the console's headline numbers — pipeline, revenue, win
 * rate, rating, unread messages — come from five different tables, and asking
 * the browser to assemble them meant either five round trips or a hook that
 * invented the figures. Every number below is a query against rows this
 * provider owns; `providerUserId` arrives from the verified session and
 * appears in the `where` of every one of them.
 *
 * Money is always the agreement's *snapshotted* `amountCents`, the terms
 * accepted at award, never a recomputation from the current bid row — which the
 * provider could since have edited.
 */

const DAY_MS = 86_400_000;
/** How far back the dashboard's revenue trend looks. */
const TREND_MONTHS = 6;

export type ProviderMonthlyRevenue = { month: string; cents: number };

export type ProviderOverview = {
  companyName: string | null;
  accountStatus: ProviderAccountStatus;

  /** Bids still awaiting a decision. */
  activeBids: number;
  /** Agreements won and finished. */
  jobsCompleted: number;
  /** Agreements won and still running. */
  activeJobs: number;

  revenueTotalCents: number;
  revenue30dCents: number;
  /** The 30 days before that, so the trend chip states a real comparison. */
  previous30dCents: number;
  /** Null when there is no prior period to compare against. */
  revenueChangePct: number | null;
  /** Oldest first, `YYYY-MM`. Always {@link TREND_MONTHS} entries. */
  monthlyRevenue: ProviderMonthlyRevenue[];
  currency: string;

  /** Decided bids won, as a percentage. Null until a bid has been decided. */
  winRatePct: number | null;

  averageRating: number | null;
  reviewsCount: number;

  unreadMessages: number;
  /** The few most recently active threads, for the dashboard's inbox card. */
  recentThreads: ConversationThread[];
};

/**
 * A provider's own identity for the console shell.
 *
 * Read on the server by the provider layout, so the shared chrome needs no API
 * call of its own on every route. Keep it to what the chrome actually renders.
 */
export type ProviderShellIdentity = {
  companyName: string | null;
  accountStatus: ProviderAccountStatus;
  unreadMessages: number;
};

export async function getProviderShellIdentity(
  providerUserId: string,
): Promise<ProviderShellIdentity> {
  const [profile, unreadMessages] = await Promise.all([
    db.providerProfile.findUnique({
      where: { userId: providerUserId },
      select: { companyName: true, accountStatus: true },
    }),
    countUnreadMessages(providerUserId),
  ]);

  return {
    companyName: profile?.companyName ?? null,
    // A provider account with no profile row has not finished onboarding; it
    // is treated as pending rather than assumed active.
    accountStatus: profile?.accountStatus ?? "pending",
    unreadMessages,
  };
}

/** `2026-09` for a date, in UTC — the unit every revenue bucket is keyed by. */
function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** The last {@link TREND_MONTHS} month keys, oldest first, ending this month. */
function trailingMonthKeys(now: Date): string[] {
  const keys: string[] = [];
  for (let back = TREND_MONTHS - 1; back >= 0; back -= 1) {
    keys.push(monthKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1))));
  }
  return keys;
}

export async function getProviderOverview(
  providerUserId: string,
  now = new Date(),
): Promise<ProviderOverview> {
  const thirtyDaysAgo = new Date(now.getTime() - 30 * DAY_MS);
  const sixtyDaysAgo = new Date(now.getTime() - 60 * DAY_MS);
  const trendStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (TREND_MONTHS - 1), 1),
  );

  const [profile, bidCounts, agreementCounts, totals, recent, ratings, unreadMessages, inbox] =
    await Promise.all([
      db.providerProfile.findUnique({
        where: { userId: providerUserId },
        select: { companyName: true, accountStatus: true },
      }),
      db.serviceBid.groupBy({
        by: ["status"],
        where: { providerUserId },
        _count: { _all: true },
      }),
      db.serviceAgreement.groupBy({
        by: ["status"],
        where: { providerUserId },
        _count: { _all: true },
        _sum: { amountCents: true },
      }),
      db.serviceAgreement.aggregate({
        where: { providerUserId, status: "completed" },
        _sum: { amountCents: true },
      }),
      // Bounded window rather than the whole history: everything older than the
      // trend start contributes to the totals above, not to the chart.
      db.serviceAgreement.findMany({
        where: { providerUserId, status: "completed", updatedAt: { gte: sixtyDaysAgo < trendStart ? sixtyDaysAgo : trendStart } },
        orderBy: { updatedAt: "desc" },
        take: 500,
        select: { amountCents: true, currency: true, updatedAt: true },
      }),
      getProviderRatingSummary(providerUserId),
      countUnreadMessages(providerUserId),
      listConversations(providerUserId, { limit: 3 }),
    ]);

  const bidsByStatus = new Map(bidCounts.map((row) => [row.status, row._count._all]));
  const agreementsByStatus = new Map(
    agreementCounts.map((row) => [row.status, row._count._all]),
  );

  const accepted = bidsByStatus.get("accepted") ?? 0;
  const rejected = bidsByStatus.get("rejected") ?? 0;
  const decided = accepted + rejected;

  // "Completed" is dated by the agreement's last write, which is what closes
  // it — the same rule `getProviderEarnings` uses, so the dashboard and the
  // earnings page can never disagree about which month a job landed in.
  const revenue30dCents = recent
    .filter((agreement) => agreement.updatedAt >= thirtyDaysAgo)
    .reduce((sum, agreement) => sum + agreement.amountCents, 0);
  const previous30dCents = recent
    .filter(
      (agreement) => agreement.updatedAt >= sixtyDaysAgo && agreement.updatedAt < thirtyDaysAgo,
    )
    .reduce((sum, agreement) => sum + agreement.amountCents, 0);

  const buckets = new Map(trailingMonthKeys(now).map((key) => [key, 0]));
  for (const agreement of recent) {
    const key = monthKey(agreement.updatedAt);
    if (buckets.has(key)) buckets.set(key, (buckets.get(key) ?? 0) + agreement.amountCents);
  }

  return {
    companyName: profile?.companyName ?? null,
    accountStatus: profile?.accountStatus ?? "pending",

    activeBids: bidsByStatus.get("submitted") ?? 0,
    jobsCompleted: agreementsByStatus.get("completed") ?? 0,
    activeJobs: agreementsByStatus.get("active") ?? 0,

    revenueTotalCents: totals._sum.amountCents ?? 0,
    revenue30dCents,
    previous30dCents,
    // No prior period means no honest percentage to state, so none is stated.
    revenueChangePct:
      previous30dCents > 0
        ? Math.round(((revenue30dCents - previous30dCents) / previous30dCents) * 100)
        : null,
    monthlyRevenue: [...buckets].map(([month, cents]) => ({ month, cents })),
    currency: recent[0]?.currency ?? "usd",

    winRatePct: decided > 0 ? Math.round((accepted / decided) * 100) : null,

    averageRating: ratings.averageRating,
    reviewsCount: ratings.totalCount,

    unreadMessages,
    recentThreads: inbox.threads,
  };
}
