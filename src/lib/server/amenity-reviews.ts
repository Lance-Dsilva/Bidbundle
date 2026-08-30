import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import type { AmenityReviewView } from "@/lib/amenity-types";
import type { AmenityScope } from "@/lib/server/amenity-auth";
import { buildAuditEntry } from "@/lib/server/audit";
import { db } from "@/lib/server/db";
import { HoaWorkflowError } from "@/lib/server/hoa";
import { toMediaRef } from "@/lib/server/media";
import type { AmenityReviewInput } from "@/lib/validation/amenities";

/**
 * Amenity ratings, private to one HOA.
 *
 * ── Eligibility, as decided and documented ───────────────────────────────
 *
 * - A **bookable** amenity is reviewable once per *completed* booking. A
 *   resident with three completed court sessions may leave three reviews, each
 *   tied to the session it describes and each badged "verified booking".
 * - A **non-bookable** common area is reviewable once by any active resident,
 *   because there is no booking to verify against. A partial unique index
 *   (`AmenityReview_one_open_review_per_resident`) enforces the "once" in the
 *   database, so a double submit cannot produce two.
 *
 * ── The aggregate ────────────────────────────────────────────────────────
 *
 * `Amenity.ratingCount` / `ratingSum` are maintained in the same transaction
 * as every review write, never recomputed on read and never trusted from a
 * client. A CHECK constraint bounds them, so a drift bug becomes a failed
 * write rather than a wrong star rating that nobody notices.
 *
 * ── What a manager may and may not do ────────────────────────────────────
 *
 * Respond: yes, once per review, always labelled. Edit or delete a resident's
 * words: never — there is deliberately no code path for it. Removal is a
 * Bundleen admin moderation action that records a reason and writes an audit
 * row.
 */

const REVIEW_INCLUDE = {
  author: { select: { id: true, fullName: true } },
  response: {
    include: { responder: { select: { fullName: true } } },
  },
  media: {
    where: { status: "active" },
    orderBy: { createdAt: "asc" },
    select: { id: true, width: true, height: true },
  },
} satisfies Prisma.AmenityReviewInclude;

type ReviewRow = Prisma.AmenityReviewGetPayload<{ include: typeof REVIEW_INCLUDE }>;

export function serializeReview(row: ReviewRow, viewerUserId: string): AmenityReviewView {
  return {
    id: row.id,
    rating: row.rating,
    comment: row.comment,
    authorName: row.author.fullName,
    isMine: row.authorUserId === viewerUserId,
    verifiedBooking: row.bookingId !== null,
    createdAt: row.createdAt.toISOString(),
    editedAt: row.editedAt?.toISOString() ?? null,
    photos: row.media.map(toMediaRef),
    response: row.response
      ? {
          body: row.response.body,
          responderName: row.response.responder.fullName,
          createdAt: row.response.createdAt.toISOString(),
        }
      : null,
  };
}

export type ReviewPage = {
  reviews: AmenityReviewView[];
  nextCursor: string | null;
};

/** Bounded, sortable review list. Removed reviews are visible to staff only. */
export async function listReviews(
  scope: AmenityScope,
  amenityId: string,
  options: { sort?: "newest" | "highest" | "lowest"; cursor?: string; limit?: number } = {},
): Promise<ReviewPage> {
  const amenity = await db.amenity.findFirst({
    where: { id: amenityId, communityId: scope.communityId },
    select: { id: true },
  });
  if (!amenity) throw new HoaWorkflowError("That amenity is not available.", 404);

  const limit = Math.min(Math.max(options.limit ?? 10, 1), 50);
  const orderBy: Prisma.AmenityReviewOrderByWithRelationInput[] =
    options.sort === "highest"
      ? [{ rating: "desc" }, { createdAt: "desc" }]
      : options.sort === "lowest"
        ? [{ rating: "asc" }, { createdAt: "desc" }]
        : [{ createdAt: "desc" }];

  const rows = await db.amenityReview.findMany({
    where: {
      amenityId,
      communityId: scope.communityId,
      ...(scope.canManage ? {} : { status: "published" }),
    },
    orderBy: [...orderBy, { id: "desc" }],
    take: limit + 1,
    ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
    include: REVIEW_INCLUDE,
  });

  const page = rows.slice(0, limit);
  return {
    reviews: page.map((row) => serializeReview(row, scope.userId)),
    nextCursor: rows.length > limit ? (page.at(-1)?.id ?? null) : null,
  };
}

/**
 * Checks the documented eligibility rule and returns the booking to attach.
 *
 * Returns `undefined` for the non-bookable case, which is distinct from
 * "ineligible" — the caller stores a null `bookingId` there.
 */
async function resolveEligibleBooking(
  scope: AmenityScope,
  amenity: { id: string; bookingRequired: boolean },
  requestedBookingId: string | undefined,
): Promise<string | null> {
  if (!amenity.bookingRequired) return null;

  if (!requestedBookingId) {
    throw new HoaWorkflowError(
      "Choose the completed booking this review is about.",
      422,
    );
  }

  const booking = await db.amenityBooking.findFirst({
    where: {
      id: requestedBookingId,
      amenityId: amenity.id,
      communityId: scope.communityId,
      userId: scope.userId,
      status: "completed",
    },
    select: { id: true, reviews: { select: { id: true }, take: 1 } },
  });
  if (!booking) {
    throw new HoaWorkflowError(
      "You can review this amenity after a completed booking.",
      422,
    );
  }
  if (booking.reviews.length > 0) {
    throw new HoaWorkflowError("You have already reviewed that booking.", 409);
  }
  return booking.id;
}

/** Posts one review and moves the amenity's aggregate in the same transaction. */
export async function createReview(
  scope: AmenityScope,
  amenityId: string,
  input: AmenityReviewInput,
): Promise<{ reviewId: string }> {
  if (!scope.membershipId) {
    throw new HoaWorkflowError("Only active residents of this HOA can review.", 403);
  }

  const amenity = await db.amenity.findFirst({
    where: { id: amenityId, communityId: scope.communityId, status: "published" },
    select: { id: true, bookingRequired: true },
  });
  if (!amenity) throw new HoaWorkflowError("That amenity is not available.", 404);

  const bookingId = await resolveEligibleBooking(scope, amenity, input.bookingId);

  if (bookingId === null) {
    const existing = await db.amenityReview.findFirst({
      where: {
        amenityId,
        authorUserId: scope.userId,
        bookingId: null,
        status: "published",
      },
      select: { id: true },
    });
    if (existing) {
      throw new HoaWorkflowError(
        "You have already reviewed this amenity. Edit your review instead.",
        409,
      );
    }
  }

  try {
    const [review] = await db.$transaction([
      db.amenityReview.create({
        data: {
          communityId: scope.communityId,
          amenityId,
          authorUserId: scope.userId,
          bookingId,
          rating: input.rating,
          comment: input.comment,
        },
        select: { id: true },
      }),
      db.amenity.update({
        where: { id: amenityId },
        data: {
          ratingCount: { increment: 1 },
          ratingSum: { increment: input.rating },
        },
      }),
    ]);
    return { reviewId: review.id };
  } catch (error) {
    // The partial unique index is the real guard against a double submit.
    if (
      typeof error === "object" &&
      error !== null &&
      (error as { code?: unknown }).code === "P2002"
    ) {
      throw new HoaWorkflowError("You have already reviewed this amenity.", 409);
    }
    throw error;
  }
}

/**
 * Edits the caller's own review.
 *
 * The aggregate moves by the delta rather than being recomputed, and
 * `editedAt` is stamped so "Edited" is shown honestly rather than a rewritten
 * review passing as the original.
 */
export async function updateReview(
  scope: AmenityScope,
  reviewId: string,
  input: AmenityReviewInput,
  now = new Date(),
): Promise<void> {
  const review = await db.amenityReview.findFirst({
    where: {
      id: reviewId,
      communityId: scope.communityId,
      authorUserId: scope.userId,
      status: "published",
    },
    select: { id: true, rating: true, amenityId: true },
  });
  if (!review) throw new HoaWorkflowError("That review was not found.", 404);

  await db.$transaction([
    db.amenityReview.update({
      where: { id: reviewId },
      data: { rating: input.rating, comment: input.comment, editedAt: now },
    }),
    db.amenity.update({
      where: { id: review.amenityId },
      data: { ratingSum: { increment: input.rating - review.rating } },
    }),
  ]);
}

/** Removes the caller's own review and reverses its contribution. */
export async function deleteOwnReview(
  scope: AmenityScope,
  reviewId: string,
): Promise<void> {
  const review = await db.amenityReview.findFirst({
    where: {
      id: reviewId,
      communityId: scope.communityId,
      authorUserId: scope.userId,
      status: "published",
    },
    select: { id: true, rating: true, amenityId: true },
  });
  if (!review) return;

  await db.$transaction([
    db.amenityReview.delete({ where: { id: reviewId } }),
    db.amenity.update({
      where: { id: review.amenityId },
      data: {
        ratingCount: { decrement: 1 },
        ratingSum: { decrement: review.rating },
      },
    }),
  ]);
}

/** One manager response per review, created or replaced. Never anonymous. */
export async function respondToReview(
  scope: AmenityScope,
  reviewId: string,
  body: string,
): Promise<void> {
  if (!scope.canManage) {
    throw new HoaWorkflowError("You do not manage this HOA.", 403);
  }

  const review = await db.amenityReview.findFirst({
    where: { id: reviewId, communityId: scope.communityId, status: "published" },
    select: { id: true },
  });
  if (!review) throw new HoaWorkflowError("That review was not found.", 404);

  await db.amenityReviewResponse.upsert({
    where: { reviewId },
    create: { reviewId, responderUserId: scope.userId, body },
    update: { responderUserId: scope.userId, body },
  });
}

/**
 * Soft-removes a review under the moderation policy.
 *
 * Restricted to Bundleen admins on purpose: letting an HOA manager delete a
 * one-star review would make every remaining rating worthless. The row and its
 * reason survive; only its visibility and its contribution to the average go.
 */
export async function moderateReview(
  scope: AmenityScope,
  reviewId: string,
  reason: string,
  now = new Date(),
): Promise<void> {
  if (scope.role !== "admin") {
    throw new HoaWorkflowError(
      "Only Bundleen staff can remove a resident review. You can respond to it instead.",
      403,
    );
  }

  const review = await db.amenityReview.findFirst({
    where: { id: reviewId, communityId: scope.communityId, status: "published" },
    select: { id: true, rating: true, amenityId: true },
  });
  if (!review) throw new HoaWorkflowError("That review was not found.", 404);

  await db.$transaction([
    db.amenityReview.update({
      where: { id: reviewId },
      data: {
        status: "removed",
        moderatedByUserId: scope.userId,
        moderationReason: reason,
        moderatedAt: now,
      },
    }),
    db.amenity.update({
      where: { id: review.amenityId },
      data: {
        ratingCount: { decrement: 1 },
        ratingSum: { decrement: review.rating },
      },
    }),
    db.adminAuditLog.create({
      data: buildAuditEntry({
        actorUserId: scope.userId,
        action: "amenity_review_moderated",
        targetType: "amenity_review",
        targetId: reviewId,
        communityId: scope.communityId,
        metadata: { via: scope.role, rating: review.rating, reason },
      }),
    }),
  ]);
}
