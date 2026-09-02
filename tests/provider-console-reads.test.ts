import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The provider console's two aggregate reads: the dashboard overview and the
 * ratings page.
 *
 * Both replace hooks that called endpoints which did not exist, so there are
 * two things worth holding down. The arithmetic — a win rate, a revenue window,
 * an average — must be the database's answer rather than a hard-coded one. And
 * the scope must be the session's provider: every query these services issue is
 * recorded here and asserted to name that account, because a missing
 * `providerUserId` in a `where` is exactly how one provider ends up reading
 * another's pipeline.
 */

type Row = Record<string, unknown>;

const state = vi.hoisted(() => ({
  profile: null as Row | null,
  bidGroups: [] as Row[],
  agreementGroups: [] as Row[],
  completedTotalCents: 0,
  completedAgreements: [] as Row[],
  reviewGroups: [] as Row[],
  reviews: [] as Row[],
  unreadCount: 0,
  conversations: [] as Row[],
  /** Every `where` the services issued, for the scoping assertions. */
  queries: [] as Array<{ model: string; where: unknown }>,
}));

function record(model: string, args?: { where?: unknown }) {
  state.queries.push({ model, where: args?.where });
}

vi.mock("@/lib/server/db", () => ({
  db: {
    providerProfile: {
      findUnique: async (args: Row) => {
        record("providerProfile", args as { where?: unknown });
        return state.profile;
      },
    },
    serviceBid: {
      groupBy: async (args: Row) => {
        record("serviceBid", args as { where?: unknown });
        return state.bidGroups;
      },
    },
    serviceAgreement: {
      groupBy: async (args: Row) => {
        record("serviceAgreement.groupBy", args as { where?: unknown });
        return state.agreementGroups;
      },
      aggregate: async (args: Row) => {
        record("serviceAgreement.aggregate", args as { where?: unknown });
        return { _sum: { amountCents: state.completedTotalCents } };
      },
      findMany: async (args: Row) => {
        record("serviceAgreement.findMany", args as { where?: unknown });
        return state.completedAgreements;
      },
    },
    review: {
      groupBy: async (args: Row) => {
        record("review.groupBy", args as { where?: unknown });
        return state.reviewGroups;
      },
      findMany: async (args: Row) => {
        record("review.findMany", args as { where?: unknown });
        const { skip = 0, take = 20 } = args as { skip?: number; take?: number };
        return state.reviews.slice(skip, skip + take);
      },
    },
    conversationMessage: {
      count: async (args: Row) => {
        record("conversationMessage", args as { where?: unknown });
        return state.unreadCount;
      },
    },
    serviceConversation: {
      findMany: async (args: Row) => {
        record("serviceConversation", args as { where?: unknown });
        return state.conversations;
      },
    },
  },
}));

import { getProviderOverview } from "@/lib/server/provider-overview";
import { getProviderReviews } from "@/lib/server/provider-reviews";

const PROVIDER = "provider-a";
const NOW = new Date("2026-09-01T12:00:00.000Z");

/** `days` before {@link NOW}. */
function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * 86_400_000);
}

/** Every `where` recorded for `model`, flattened for a substring search. */
function whereFor(model: string): string[] {
  return state.queries
    .filter((query) => query.model.startsWith(model))
    .map((query) => JSON.stringify(query.where));
}

beforeEach(() => {
  state.profile = { companyName: "ProFix Plumbing", accountStatus: "active" };
  state.bidGroups = [];
  state.agreementGroups = [];
  state.completedTotalCents = 0;
  state.completedAgreements = [];
  state.reviewGroups = [];
  state.reviews = [];
  state.unreadCount = 0;
  state.conversations = [];
  state.queries = [];
});

describe("provider overview arithmetic", () => {
  it("derives the win rate from decided bids only", async () => {
    state.bidGroups = [
      { status: "submitted", _count: { _all: 4 } },
      { status: "accepted", _count: { _all: 3 } },
      { status: "rejected", _count: { _all: 1 } },
      { status: "withdrawn", _count: { _all: 9 } },
    ];

    const overview = await getProviderOverview(PROVIDER, NOW);
    expect(overview.activeBids).toBe(4);
    // 3 of 4 decided. Submitted and withdrawn bids are not losses.
    expect(overview.winRatePct).toBe(75);
  });

  it("states no win rate at all until a bid has been decided", async () => {
    state.bidGroups = [{ status: "submitted", _count: { _all: 2 } }];
    const overview = await getProviderOverview(PROVIDER, NOW);
    expect(overview.winRatePct).toBeNull();
  });

  it("splits revenue into the last 30 days and the 30 before that", async () => {
    state.completedTotalCents = 250_00;
    state.completedAgreements = [
      { amountCents: 100_00, currency: "usd", updatedAt: daysAgo(5) },
      { amountCents: 60_00, currency: "usd", updatedAt: daysAgo(29) },
      { amountCents: 90_00, currency: "usd", updatedAt: daysAgo(45) },
    ];

    const overview = await getProviderOverview(PROVIDER, NOW);
    expect(overview.revenue30dCents).toBe(160_00);
    expect(overview.previous30dCents).toBe(90_00);
    expect(overview.revenueTotalCents).toBe(250_00);
    // (160 - 90) / 90 ≈ 78%.
    expect(overview.revenueChangePct).toBe(78);
  });

  it("reports no change rather than a fabricated one with no prior period", async () => {
    state.completedAgreements = [
      { amountCents: 100_00, currency: "usd", updatedAt: daysAgo(2) },
    ];
    const overview = await getProviderOverview(PROVIDER, NOW);
    expect(overview.previous30dCents).toBe(0);
    expect(overview.revenueChangePct).toBeNull();
  });

  it("buckets six months of revenue, oldest first, with empty months at zero", async () => {
    state.completedAgreements = [
      { amountCents: 40_00, currency: "usd", updatedAt: new Date("2026-09-10T00:00:00Z") },
      { amountCents: 25_00, currency: "usd", updatedAt: new Date("2026-07-03T00:00:00Z") },
    ];

    const overview = await getProviderOverview(PROVIDER, NOW);
    expect(overview.monthlyRevenue.map((point) => point.month)).toEqual([
      "2026-04",
      "2026-05",
      "2026-06",
      "2026-07",
      "2026-08",
      "2026-09",
    ]);
    expect(overview.monthlyRevenue.map((point) => point.cents)).toEqual([0, 0, 0, 25_00, 0, 40_00]);
  });

  it("counts completed and active agreements separately", async () => {
    state.agreementGroups = [
      { status: "completed", _count: { _all: 7 }, _sum: { amountCents: 1 } },
      { status: "active", _count: { _all: 2 }, _sum: { amountCents: 1 } },
    ];
    const overview = await getProviderOverview(PROVIDER, NOW);
    expect(overview.jobsCompleted).toBe(7);
    expect(overview.activeJobs).toBe(2);
  });

  it("treats a provider with no profile row as pending rather than active", async () => {
    state.profile = null;
    const overview = await getProviderOverview(PROVIDER, NOW);
    expect(overview.accountStatus).toBe("pending");
    expect(overview.companyName).toBeNull();
  });
});

describe("provider overview scoping", () => {
  it("names the session provider in every query it issues", async () => {
    await getProviderOverview(PROVIDER, NOW);

    expect(state.queries.length).toBeGreaterThan(5);
    for (const query of state.queries) {
      expect(
        JSON.stringify(query.where),
        `${query.model} was queried without the provider in its where`,
      ).toContain(PROVIDER);
    }
  });

  it("scopes the rating summary and unread count to the same account", async () => {
    await getProviderOverview(PROVIDER, NOW);
    expect(whereFor("review").join()).toContain(`"providerUserId":"${PROVIDER}"`);
    expect(whereFor("conversationMessage").join()).toContain(PROVIDER);
  });
});

describe("provider ratings", () => {
  beforeEach(() => {
    state.reviewGroups = [
      { rating: 5, _count: { _all: 6 } },
      { rating: 4, _count: { _all: 3 } },
      { rating: 2, _count: { _all: 1 } },
    ];
    state.reviews = [
      {
        id: "review-1",
        rating: 5,
        comment: "Cleared the whole block in a morning.",
        createdAt: new Date("2026-08-20T09:00:00Z"),
        reviewer: { fullName: "Sarah Mills" },
        agreement: { request: { category: "Gutter clearing" }, community: { name: "Cedar Park" } },
        visit: null,
      },
      {
        id: "review-2",
        rating: 4,
        comment: "On time, no mess.",
        createdAt: new Date("2026-08-02T09:00:00Z"),
        reviewer: { fullName: "James Kaur" },
        agreement: null,
        visit: {
          occurrence: {
            agreement: { request: { category: "Lawn care" }, community: { name: "Oakwood" } },
          },
        },
      },
    ];
  });

  it("computes the average and distribution over every published review", async () => {
    const page = await getProviderReviews(PROVIDER);

    // (5×6 + 4×3 + 2×1) / 10 = 4.4 — not an average of the two rows returned.
    expect(page.summary.averageRating).toBe(4.4);
    expect(page.summary.totalCount).toBe(10);
    expect(page.summary.distribution).toEqual([
      { rating: 5, count: 6, percent: 60 },
      { rating: 4, count: 3, percent: 30 },
      { rating: 3, count: 0, percent: 0 },
      { rating: 2, count: 1, percent: 10 },
      { rating: 1, count: 0, percent: 0 },
    ]);
  });

  it("has no rating at all when there are no reviews", async () => {
    state.reviewGroups = [];
    state.reviews = [];
    const page = await getProviderReviews(PROVIDER);
    expect(page.summary.averageRating).toBeNull();
    expect(page.summary.totalCount).toBe(0);
    expect(page.reviews).toEqual([]);
    expect(page.page.hasMore).toBe(false);
  });

  it("labels each review with the job it is about, from either subject", async () => {
    const page = await getProviderReviews(PROVIDER);
    expect(page.reviews.map((review) => review.subjectLabel)).toEqual([
      "Gutter clearing · Cedar Park",
      "Lawn care · Oakwood",
    ]);
  });

  it("returns the reviewer's name and nothing else about them", async () => {
    const page = await getProviderReviews(PROVIDER);
    const serialized = JSON.stringify(page.reviews);
    expect(serialized).toContain("Sarah Mills");
    // No contact details, address, or account id ride along with a review.
    expect(serialized).not.toMatch(/email|address|latitude|reviewerUserId/i);
  });

  it("reports more pages while the total exceeds what was returned", async () => {
    const page = await getProviderReviews(PROVIDER, { limit: 1, offset: 0 });
    expect(page.reviews).toHaveLength(1);
    expect(page.page).toMatchObject({ limit: 1, offset: 0, total: 10, hasMore: true });
  });

  it("only ever reads published reviews belonging to the session provider", async () => {
    await getProviderReviews(PROVIDER);
    for (const where of whereFor("review")) {
      expect(where).toContain(`"providerUserId":"${PROVIDER}"`);
      expect(where).toContain('"status":"published"');
    }
  });
});
