import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Amenity reviews: who may write one, what the aggregate does, and the line a
 * manager may not cross.
 *
 * The aggregate assertions matter because `Amenity.ratingCount` / `ratingSum`
 * are stored rather than recomputed. Every write here is checked to move them
 * by exactly the right delta, in the same transaction as the review itself.
 */

type Op = { model: string; action: string; args: Record<string, unknown> };

const state = vi.hoisted(() => ({
  amenity: null as Record<string, unknown> | null,
  booking: null as Record<string, unknown> | null,
  existingReview: null as Record<string, unknown> | null,
  ownReview: null as Record<string, unknown> | null,
  writes: [] as Op[],
  batches: [] as Op[][],
}));

function op(model: string, action: string) {
  return (args: Record<string, unknown> = {}): Op => {
    const entry = { model, action, args };
    state.writes.push(entry);
    return entry;
  };
}

vi.mock("@/lib/server/db", () => ({
  db: {
    amenity: {
      findFirst: async () => state.amenity,
      update: op("amenity", "update"),
    },
    amenityBooking: { findFirst: async () => state.booking },
    amenityReview: {
      findFirst: async (args: Record<string, unknown>) => {
        const where = (args.where ?? {}) as Record<string, unknown>;
        // The "already reviewed this common area" probe looks for a null
        // bookingId; everything else is asking for the caller's own review.
        return where.bookingId === null ? state.existingReview : state.ownReview;
      },
      findMany: async () => [],
      create: op("amenityReview", "create"),
      update: op("amenityReview", "update"),
      delete: op("amenityReview", "delete"),
    },
    amenityReviewResponse: { upsert: op("amenityReviewResponse", "upsert") },
    adminAuditLog: { create: op("adminAuditLog", "create") },
    $transaction: async (ops: Op[]) => {
      state.batches.push(ops);
      return ops;
    },
  },
}));

const {
  createReview,
  deleteOwnReview,
  moderateReview,
  respondToReview,
  updateReview,
} = await import("@/lib/server/amenity-reviews");

const RESIDENT = {
  userId: "user-resident",
  communityId: "hoa-1",
  communityName: "Cedar Ridge",
  timezone: "America/Chicago",
  role: "resident" as const,
  membershipId: "m-1",
  unitId: "unit-1",
  unitLabel: "Home 1",
  canManage: false,
};

const MANAGER = { ...RESIDENT, userId: "user-manager", role: "manager" as const, canManage: true, membershipId: null };
const ADMIN = { ...MANAGER, userId: "user-admin", role: "admin" as const };

const BOOKABLE = { id: "amenity-1", bookingRequired: true };
const DROP_IN = { id: "amenity-2", bookingRequired: false };

beforeEach(() => {
  state.amenity = BOOKABLE;
  state.booking = null;
  state.existingReview = null;
  state.ownReview = null;
  state.writes = [];
  state.batches = [];
});

describe("review eligibility", () => {
  it("accepts a review tied to the reviewer's own completed booking", async () => {
    state.booking = { id: "booking-1", reviews: [] };

    await createReview(RESIDENT, "amenity-1", {
      rating: 5,
      comment: "Excellent court.",
      bookingId: "booking-1",
    });

    const create = state.writes.find((entry) => entry.model === "amenityReview");
    expect(create?.args.data).toMatchObject({
      amenityId: "amenity-1",
      authorUserId: "user-resident",
      bookingId: "booking-1",
      rating: 5,
    });
  });

  it("refuses a bookable amenity with no booking named", async () => {
    await expect(
      createReview(RESIDENT, "amenity-1", { rating: 5, comment: "Nice." }),
    ).rejects.toMatchObject({ status: 422 });
    expect(state.writes).toHaveLength(0);
  });

  it("refuses a booking that is not the reviewer's own completed one", async () => {
    // The scripted lookup filters on userId and `status: "completed"`, so a
    // booking belonging to someone else simply does not come back.
    state.booking = null;

    await expect(
      createReview(RESIDENT, "amenity-1", {
        rating: 1,
        comment: "Never went.",
        bookingId: "someone-elses-booking",
      }),
    ).rejects.toMatchObject({ status: 422 });
    expect(state.writes).toHaveLength(0);
  });

  it("refuses a second review of the same completed booking", async () => {
    state.booking = { id: "booking-1", reviews: [{ id: "review-existing" }] };

    await expect(
      createReview(RESIDENT, "amenity-1", {
        rating: 5,
        comment: "Again!",
        bookingId: "booking-1",
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("lets any active resident review a non-bookable common area once", async () => {
    state.amenity = DROP_IN;

    await createReview(RESIDENT, "amenity-2", { rating: 4, comment: "Well kept." });
    const create = state.writes.find((entry) => entry.model === "amenityReview");
    expect((create?.args.data as Record<string, unknown>).bookingId).toBeNull();
  });

  it("refuses a second review of a non-bookable amenity", async () => {
    state.amenity = DROP_IN;
    state.existingReview = { id: "review-existing" };

    await expect(
      createReview(RESIDENT, "amenity-2", { rating: 2, comment: "Changed my mind." }),
    ).rejects.toMatchObject({ status: 409 });
    expect(state.writes).toHaveLength(0);
  });

  it("refuses a manager who does not live in the HOA", async () => {
    state.amenity = DROP_IN;
    await expect(
      createReview(MANAGER, "amenity-2", { rating: 5, comment: "Lovely." }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("translates the partial unique index's violation into a clear conflict", async () => {
    // The pre-check above catches the ordinary duplicate. This covers the race
    // it cannot: two submits that both pass the check, where the database's
    // `AmenityReview_one_open_review_per_resident` index rejects the second.
    state.amenity = DROP_IN;

    const dbModule = await import("@/lib/server/db");
    const original = dbModule.db.$transaction;
    (dbModule.db as { $transaction: unknown }).$transaction = async () => {
      throw Object.assign(new Error("unique constraint"), { code: "P2002" });
    };

    try {
      await expect(
        createReview(RESIDENT, "amenity-2", { rating: 3, comment: "Fine." }),
      ).rejects.toMatchObject({ status: 409 });
    } finally {
      (dbModule.db as { $transaction: unknown }).$transaction = original;
    }
  });
});

describe("rating aggregates", () => {
  it("increments count and sum in the same transaction as the review", async () => {
    state.booking = { id: "booking-1", reviews: [] };

    await createReview(RESIDENT, "amenity-1", {
      rating: 4,
      comment: "Good.",
      bookingId: "booking-1",
    });

    expect(state.batches).toHaveLength(1);
    const update = state.batches[0].find((entry) => entry.model === "amenity");
    expect(update?.args.data).toEqual({
      ratingCount: { increment: 1 },
      ratingSum: { increment: 4 },
    });
  });

  it("moves the sum by the delta on an edit, leaving the count alone", async () => {
    state.ownReview = { id: "review-1", rating: 2, amenityId: "amenity-1" };

    await updateReview(RESIDENT, "review-1", { rating: 5, comment: "Much better now." });

    const update = state.batches[0].find((entry) => entry.model === "amenity");
    expect(update?.args.data).toEqual({ ratingSum: { increment: 3 } });

    // And the edit is stamped, so "Edited" can be shown honestly.
    const reviewUpdate = state.batches[0].find(
      (entry) => entry.model === "amenityReview",
    );
    expect((reviewUpdate?.args.data as Record<string, unknown>).editedAt).toBeInstanceOf(
      Date,
    );
  });

  it("reverses the contribution when a resident deletes their own review", async () => {
    state.ownReview = { id: "review-1", rating: 3, amenityId: "amenity-1" };

    await deleteOwnReview(RESIDENT, "review-1");

    const update = state.batches[0].find((entry) => entry.model === "amenity");
    expect(update?.args.data).toEqual({
      ratingCount: { decrement: 1 },
      ratingSum: { decrement: 3 },
    });
  });
});

describe("manager responses and moderation", () => {
  it("lets a manager respond exactly once, replacing any earlier reply", async () => {
    state.ownReview = { id: "review-1" };

    await respondToReview(MANAGER, "review-1", "Thanks — the net is fixed.");

    const upsert = state.writes.find(
      (entry) => entry.model === "amenityReviewResponse",
    );
    expect(upsert?.args).toMatchObject({
      where: { reviewId: "review-1" },
      create: { reviewId: "review-1", responderUserId: "user-manager" },
    });
  });

  it("refuses a response from someone who does not manage the HOA", async () => {
    await expect(
      respondToReview(RESIDENT, "review-1", "Let me fix that."),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("refuses to let an HOA manager remove a resident's review", async () => {
    state.ownReview = { id: "review-1", rating: 1, amenityId: "amenity-1" };

    await expect(
      moderateReview(MANAGER, "review-1", "Unfair."),
    ).rejects.toMatchObject({
      status: 403,
      message: expect.stringContaining("Only Bundleen staff"),
    });
    expect(state.writes).toHaveLength(0);
  });

  it("lets a Bundleen admin remove one, with a reason and an audit row", async () => {
    state.ownReview = { id: "review-1", rating: 1, amenityId: "amenity-1" };

    await moderateReview(ADMIN, "review-1", "Contains a neighbour's address.");

    const models = state.batches[0].map((entry) => entry.model);
    expect(models).toContain("amenityReview");
    expect(models).toContain("amenity");
    expect(models).toContain("adminAuditLog");

    const removal = state.batches[0].find((entry) => entry.model === "amenityReview");
    expect(removal?.args.data).toMatchObject({
      status: "removed",
      moderatedByUserId: "user-admin",
      moderationReason: "Contains a neighbour's address.",
    });

    // A removed review stops counting toward the average.
    const aggregate = state.batches[0].find((entry) => entry.model === "amenity");
    expect(aggregate?.args.data).toEqual({
      ratingCount: { decrement: 1 },
      ratingSum: { decrement: 1 },
    });
  });
});
