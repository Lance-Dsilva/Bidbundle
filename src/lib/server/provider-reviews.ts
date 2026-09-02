import "server-only";

import { db } from "@/lib/server/db";
import { REVIEW_PAGE_SIZE } from "@/lib/validation/provider-console";

/**
 * A provider's own reviews and their real rating summary.
 *
 * Every query here is keyed on `providerUserId`, which comes from the verified
 * session at the route boundary and is never read from a query string or a
 * body. There is nothing to tamper with: the only inputs a caller controls are
 * `limit` and `offset`, both bounded before they arrive.
 *
 * Moderated-away rows (`status: "removed"`) are excluded from the list *and*
 * from the average and distribution, so the three figures always describe the
 * same set of reviews.
 */

export type ProviderReviewView = {
  id: string;
  /** Name of the neighbour or manager who wrote it. No contact details. */
  reviewerName: string;
  rating: number;
  comment: string;
  /** What the review is about, e.g. `Lawn care · Cedar Park HOA`. */
  subjectLabel: string | null;
  createdAt: string;
};

export type ProviderRatingSummary = {
  averageRating: number | null;
  totalCount: number;
  /** Five buckets, always 5★ down to 1★, so the UI never has to fill gaps. */
  distribution: Array<{ rating: number; count: number; percent: number }>;
};

export type ProviderReviewsPage = {
  summary: ProviderRatingSummary;
  reviews: ProviderReviewView[];
  page: { limit: number; offset: number; total: number; hasMore: boolean };
};

const PUBLISHED = { status: "published" } as const;

/**
 * The rating summary alone.
 *
 * Computed with `groupBy` rather than by loading rows, so a provider with
 * thousands of reviews costs the same as one with three — and so the average
 * is the database's, not an accumulation over whatever page happened to load.
 */
export async function getProviderRatingSummary(
  providerUserId: string,
): Promise<ProviderRatingSummary> {
  const grouped = await db.review.groupBy({
    by: ["rating"],
    where: { providerUserId, ...PUBLISHED },
    _count: { _all: true },
  });

  const counts = new Map(grouped.map((row) => [row.rating, row._count._all]));
  const totalCount = grouped.reduce((sum, row) => sum + row._count._all, 0);
  const ratingSum = grouped.reduce((sum, row) => sum + row.rating * row._count._all, 0);

  return {
    // One decimal place, the precision the star display actually uses.
    averageRating: totalCount > 0 ? Math.round((ratingSum / totalCount) * 10) / 10 : null,
    totalCount,
    distribution: [5, 4, 3, 2, 1].map((rating) => {
      const count = counts.get(rating) ?? 0;
      return {
        rating,
        count,
        percent: totalCount > 0 ? Math.round((count / totalCount) * 100) : 0,
      };
    }),
  };
}

/** Builds the `Lawn care · Cedar Park HOA` line under a review's stars. */
function subjectLabelOf(row: {
  visit: { occurrence: { agreement: AgreementLabel } } | null;
  agreement: AgreementLabel | null;
}): string | null {
  const agreement = row.visit?.occurrence.agreement ?? row.agreement;
  if (!agreement) return null;
  return [agreement.request.category, agreement.community.name].filter(Boolean).join(" · ");
}

type AgreementLabel = {
  request: { category: string };
  community: { name: string };
};

const agreementLabelSelect = {
  request: { select: { category: true } },
  community: { select: { name: true } },
} as const;

/**
 * One page of this provider's published reviews, newest first, with the
 * summary over *all* of them rather than over the page.
 */
export async function getProviderReviews(
  providerUserId: string,
  options: { limit?: number; offset?: number } = {},
): Promise<ProviderReviewsPage> {
  const limit = options.limit ?? REVIEW_PAGE_SIZE;
  const offset = options.offset ?? 0;

  const [summary, rows] = await Promise.all([
    getProviderRatingSummary(providerUserId),
    db.review.findMany({
      where: { providerUserId, ...PUBLISHED },
      orderBy: { createdAt: "desc" },
      skip: offset,
      take: limit,
      select: {
        id: true,
        rating: true,
        comment: true,
        createdAt: true,
        reviewer: { select: { fullName: true } },
        agreement: { select: agreementLabelSelect },
        visit: { select: { occurrence: { select: { agreement: { select: agreementLabelSelect } } } } },
      },
    }),
  ]);

  return {
    summary,
    reviews: rows.map((row) => ({
      id: row.id,
      reviewerName: row.reviewer.fullName,
      rating: row.rating,
      comment: row.comment,
      subjectLabel: subjectLabelOf(row),
      createdAt: row.createdAt.toISOString(),
    })),
    page: {
      limit,
      offset,
      total: summary.totalCount,
      hasMore: offset + rows.length < summary.totalCount,
    },
  };
}
