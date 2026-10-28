import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The one provider marketplace feed.
 *
 * What is under test is eligibility and *redaction*: which opportunities a
 * provider is shown, and how little of a customer's location travels with
 * them. A feed that quietly includes an out-of-area job is a nuisance; a feed
 * that includes a participant's address is a privacy failure, so both are
 * asserted on the real serialized payload rather than on source text.
 */

type Row = Record<string, unknown>;

const state = vi.hoisted(() => ({
  provider: null as Row | null,
  areas: [] as Row[],
  requests: [] as Row[],
  bids: [] as Row[],
  agreements: [] as Row[],
  occurrences: [] as Row[],
}));

vi.mock("@/lib/server/db", () => ({
  db: {
    user: { findUnique: async () => state.provider },
    providerServiceArea: { findMany: async () => state.areas },
    hoaServiceRequest: { findMany: async () => state.requests },
    serviceBid: { findMany: async () => state.bids },
    serviceAgreement: { findMany: async () => state.agreements },
    serviceOccurrence: { findMany: async () => state.occurrences },
    community: { findUnique: async () => null },
    hoaProfile: { findUnique: async () => null },
    providerProfile: { findMany: async () => [] },
    communityStaffAssignment: { findFirst: async () => null },
    communityMembership: { findMany: async () => [] },
    homeownerProfile: { findMany: async () => [] },
    notification: { createMany: () => ({}) },
    outboxEvent: { createMany: () => ({}) },
    $transaction: async (ops: unknown[]) => ops,
  },
}));

import { getProviderHoaWorkspace } from "@/lib/server/hoa-market";

/** An active, fully verified provider who offers cleaning. */
function verifiedProvider(overrides: Row = {}) {
  return {
    role: "provider",
    providerProfile: {
      trades: ["Cleaning"],
      accountStatus: "active",
      licenseVerifiedAt: new Date(),
      insuranceVerifiedAt: new Date(),
      ...overrides,
    },
  };
}

/** A circle centred on Austin that comfortably covers the test communities. */
const AUSTIN_AREA = {
  id: "area-1",
  label: "Austin",
  centerLatitude: 30.4,
  centerLongitude: -97.72,
  radiusMiles: 15,
  postalCodes: [],
  isPrimary: true,
  status: "active",
  formattedAddress: null,
  locality: "Austin",
  region: "TX",
  postalCode: "78758",
  countryCode: "US",
};

function neighbourhoodRequest(overrides: Row = {}) {
  return {
    id: "request-1",
    title: "Pressure washing",
    category: "cleaning",
    description: "Driveways.",
    kind: "optional_group",
    recurrenceLabel: null,
    totalOccurrences: 1,
    startDate: null,
    biddingClosesAt: new Date(Date.now() + 86_400_000),
    budgetMinCents: 10_000,
    budgetMaxCents: 30_000,
    community: {
      name: "Oakwood Heights",
      type: "neighborhood",
      centerLatitude: 30.41,
      centerLongitude: -97.73,
      hoaProfile: null,
    },
    participations: [{ id: "p1" }, { id: "p2" }],
    bids: [],
    ...overrides,
  };
}

function hoaRequest(overrides: Row = {}) {
  return {
    id: "request-2",
    title: "Biweekly gardening",
    category: "cleaning",
    description: "Common areas.",
    kind: "compulsory_recurring",
    recurrenceLabel: "Biweekly",
    totalOccurrences: 3,
    startDate: null,
    biddingClosesAt: new Date(Date.now() + 86_400_000),
    budgetMinCents: null,
    budgetMaxCents: null,
    community: {
      name: "Cedar Park HOA",
      type: "hoa",
      centerLatitude: null,
      centerLongitude: null,
      hoaProfile: {
        latitude: 30.402,
        longitude: -97.7266,
        postalCode: "78758",
        locality: "Austin",
        region: "TX",
        addressVerificationStatus: "verified",
      },
    },
    participations: [{ id: "p1" }],
    bids: [],
    ...overrides,
  };
}

beforeEach(() => {
  state.provider = verifiedProvider();
  state.areas = [AUSTIN_AREA];
  state.requests = [];
  state.bids = [];
  state.agreements = [];
  state.occurrences = [];
});

describe("what the feed includes", () => {
  it("carries HOA and neighbourhood work in one list, each labelled", async () => {
    state.requests = [neighbourhoodRequest(), hoaRequest()];

    const workspace = await getProviderHoaWorkspace("provider-1");
    expect(workspace.feed.map((item) => item.context).sort()).toEqual(["hoa", "neighborhood"]);
  });

  it("excludes work outside every active service area", async () => {
    state.areas = [{ ...AUSTIN_AREA, centerLatitude: 29.42, centerLongitude: -98.49 }];
    state.requests = [neighbourhoodRequest(), hoaRequest()];

    await expect(getProviderHoaWorkspace("provider-1")).resolves.toMatchObject({ feed: [] });
  });

  it("excludes a trade the provider does not offer", async () => {
    state.requests = [neighbourhoodRequest({ category: "plumbing" })];
    await expect(getProviderHoaWorkspace("provider-1")).resolves.toMatchObject({ feed: [] });
  });

  it.each([
    ["Lawn care", "lawn"],
    ["lawn", "Lawn care"],
    ["Landscaping", "Gardening"],
    ["Pool care", "Pool"],
    ["Gutters", "gutter"],
    ["Pest control", "pest_control"],
    ["Painting", "painting"],
    ["Seasonal maintenance", "seasonal_maintenance"],
  ])("routes the provider's %s to matching request %s", async (trade, category) => {
    state.provider = verifiedProvider({ trades: [trade] });
    state.requests = [neighbourhoodRequest({ category }), hoaRequest({ category })];
    const workspace = await getProviderHoaWorkspace("provider-1");
    expect(workspace.feed.map((item) => item.requestId).sort()).toEqual(["request-1", "request-2"]);
  });

  it("does not turn unknown legacy trades into broad matching permission", async () => {
    state.provider = verifiedProvider({ trades: ["Drain clearing"] });
    state.requests = [
      neighbourhoodRequest({ category: "Drain clearing" }),
      hoaRequest({ category: "other" }),
    ];
    expect((await getProviderHoaWorkspace("provider-1")).feed).toEqual([]);
  });

  it("still applies coverage after canonicalizing legacy lawn-care trades", async () => {
    state.provider = verifiedProvider({ trades: ["Lawn care"] });
    state.areas = [{ ...AUSTIN_AREA, centerLatitude: 29.42, centerLongitude: -98.49 }];
    state.requests = [neighbourhoodRequest({ category: "lawn" })];
    expect((await getProviderHoaWorkspace("provider-1")).feed).toEqual([]);
  });

  it("excludes a request whose bidding deadline has passed", async () => {
    state.requests = [
      neighbourhoodRequest({ biddingClosesAt: new Date(Date.now() - 1_000) }),
    ];
    await expect(getProviderHoaWorkspace("provider-1")).resolves.toMatchObject({ feed: [] });
  });

  it("excludes an HOA whose address has never been verified", async () => {
    state.requests = [
      hoaRequest({
        community: {
          name: "Cedar Park HOA",
          type: "hoa",
          centerLatitude: null,
          centerLongitude: null,
          hoaProfile: {
            latitude: 30.402,
            longitude: -97.7266,
            postalCode: null,
            locality: "Austin",
            region: "TX",
            // Coordinates exist but were never confirmed: not routeable.
            addressVerificationStatus: "needs_correction",
          },
        },
      }),
    ];
    await expect(getProviderHoaWorkspace("provider-1")).resolves.toMatchObject({ feed: [] });
  });

  it("excludes a neighbourhood with no admin-set centre", async () => {
    state.requests = [
      neighbourhoodRequest({
        community: {
          name: "Unplaced",
          type: "neighborhood",
          centerLatitude: null,
          centerLongitude: null,
          hoaProfile: null,
        },
      }),
    ];
    await expect(getProviderHoaWorkspace("provider-1")).resolves.toMatchObject({ feed: [] });
  });
});

describe("account status gates", () => {
  it("shows a pending provider nothing to bid on and says why", async () => {
    state.provider = verifiedProvider({ accountStatus: "pending" });
    state.requests = [neighbourhoodRequest()];

    const workspace = await getProviderHoaWorkspace("provider-1");
    expect(workspace.eligible).toBe(false);
    expect(workspace.ineligibleReason).toBeTruthy();
    expect(workspace.feed).toEqual([]);
  });

  it("shows a suspended provider nothing", async () => {
    state.provider = verifiedProvider({ accountStatus: "suspended" });
    state.requests = [neighbourhoodRequest()];

    const workspace = await getProviderHoaWorkspace("provider-1");
    expect(workspace.eligible).toBe(false);
    expect(workspace.feed).toEqual([]);
  });

  it("shows an unverified provider nothing until credentials are checked", async () => {
    state.provider = verifiedProvider({ licenseVerifiedAt: null });
    state.requests = [neighbourhoodRequest()];

    await expect(getProviderHoaWorkspace("provider-1")).resolves.toMatchObject({
      eligible: false,
      feed: [],
    });
  });

  it("refuses a non-provider account outright", async () => {
    state.provider = { role: "homeowner", providerProfile: null };
    await expect(getProviderHoaWorkspace("someone")).rejects.toThrow(/provider accounts/i);
  });
});

describe("what the feed withholds", () => {
  it("gives an approximate distance and no exact location", async () => {
    state.requests = [neighbourhoodRequest()];

    const [item] = (await getProviderHoaWorkspace("provider-1")).feed;
    expect(item.approximateDistanceMi).toBeGreaterThan(0);
    // Rounded to a tenth of a mile: enough to judge a job, far too coarse to
    // locate a home.
    expect(item.approximateDistanceMi).toBe(
      Math.round((item.approximateDistanceMi as number) * 10) / 10,
    );

    const serialized = JSON.stringify(item);
    expect(serialized).not.toContain("30.41");
    expect(serialized).not.toContain("-97.73");
    expect(serialized).not.toContain("latitude");
  });

  it("returns the locked home count but no participant identity", async () => {
    state.requests = [neighbourhoodRequest()];

    const [item] = (await getProviderHoaWorkspace("provider-1")).feed;
    expect(item.homeCount).toBe(2);
    expect(JSON.stringify(item)).not.toContain("p1");
  });

  it("returns this provider's own bid and no competitor amount", async () => {
    state.requests = [
      neighbourhoodRequest({
        bids: [
          {
            id: "bid-mine",
            requestId: "request-1",
            providerUserId: "provider-1",
            status: "submitted",
            amountCents: 22_500,
            currency: "usd",
            pricingBasis: "total",
            perHomeCents: null,
            proposedStartDate: null,
            estimatedDurationLabel: null,
            scope: "Driveways",
            exclusions: null,
            cadenceLabel: null,
            validUntil: null,
            version: 1,
            submittedAt: new Date(),
            provider: {
              fullName: "Shine Co",
              providerProfile: {
                companyName: "Shine Co LLC",
                licenseVerifiedAt: new Date(),
                insuranceVerifiedAt: new Date(),
              },
            },
          },
        ],
      }),
    ];

    const [item] = (await getProviderHoaWorkspace("provider-1")).feed;
    expect(item.myBid?.amountCents).toBe(22_500);
    // The Prisma read is already scoped to this provider's bids; the payload
    // has no field a competitor's amount could travel in.
    expect(Object.keys(item)).not.toContain("bids");
  });

  it("passes through the permitted budget range so a provider can price the job", async () => {
    state.requests = [neighbourhoodRequest()];
    const [item] = (await getProviderHoaWorkspace("provider-1")).feed;
    expect(item.budgetMinCents).toBe(10_000);
    expect(item.budgetMaxCents).toBe(30_000);
  });
});
