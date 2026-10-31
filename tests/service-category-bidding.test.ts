import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
const state = vi.hoisted(() => ({
  trades: ["Lawn care"],
  category: "lawn",
  role: "provider",
  accountStatus: "active",
  licenseVerified: true,
  insuranceVerified: true,
  covered: true,
  open: true,
  deadline: new Date(Date.now() + 86_400_000),
  writes: [] as Row[],
  lockRequest: vi.fn(),
}));

vi.mock("@/lib/server/notifications", () => ({
  buildPreferenceAwareNotificationOps: async () => [],
}));

vi.mock("@/lib/server/db", () => ({
  db: {
    user: { findUnique: async () => ({ role: state.role, providerProfile: {
      trades: state.trades,
      accountStatus: state.accountStatus,
      licenseVerifiedAt: state.licenseVerified ? new Date() : null,
      insuranceVerifiedAt: state.insuranceVerified ? new Date() : null,
    } }) },
    hoaServiceRequest: { findUnique: async () => ({
      id: "request-1", communityId: "hoa-1", title: "Shared service", category: state.category,
      status: state.open ? "open_for_bids" : "bidding_closed", biddingClosesAt: state.deadline,
      community: { type: "hoa", status: "active", name: "Test HOA" }, participations: [],
    }) },
    providerServiceArea: { findMany: async () => [{
      centerLatitude: state.covered ? 30.4 : 40,
      centerLongitude: state.covered ? -97.72 : -100,
      radiusMiles: 15, postalCodes: [],
    }] },
    community: { findUnique: async () => ({ type: "hoa", name: "Test HOA", hoaProfile: {
      latitude: 30.402, longitude: -97.7266, addressVerificationStatus: "verified",
      postalCode: "78758", locality: "Austin", region: "TX",
    } }) },
    communityStaffAssignment: { findFirst: async () => null },
    serviceBid: {
      findUnique: async () => null,
      create: (args: Row) => { state.writes.push(args); return args; },
      findUniqueOrThrow: async () => ({
        id: "bid-1", requestId: "request-1", providerUserId: "provider-1", status: "submitted",
        amountCents: 20_000, currency: "usd", pricingBasis: "total", perHomeCents: null,
        proposedStartDate: null, estimatedDurationLabel: null, scope: "Full service",
        exclusions: null, cadenceLabel: null, validUntil: null, version: 1, submittedAt: new Date(),
        provider: { fullName: "Green Crew", providerProfile: { companyName: "Green Crew",
          licenseVerifiedAt: new Date(), insuranceVerifiedAt: new Date() } },
      }),
    },
    // The parent lock's result is unused. This unit mock models the call only;
    // it cannot establish PostgreSQL transaction or concurrency behavior.
    $queryRaw: state.lockRequest,
    $transaction: async (ops: unknown[]) => ops,
  },
}));

import { submitBid } from "@/lib/server/hoa-market";
import { bidSubmitSchema } from "@/lib/validation/hoa";

const bid = bidSubmitSchema.parse({ amountCents: 20_000, pricingBasis: "total", scope: "Full service" });

beforeEach(() => {
  state.trades = ["Lawn care"];
  state.category = "lawn";
  state.role = "provider";
  state.accountStatus = "active";
  state.licenseVerified = true;
  state.insuranceVerified = true;
  state.covered = true;
  state.open = true;
  state.deadline = new Date(Date.now() + 86_400_000);
  state.writes = [];
  state.lockRequest.mockReset().mockResolvedValue([{ id: "request-1" }]);
});

describe("canonical service matching at bid submission", () => {
  it.each([
    ["Lawn care", "lawn"],
    ["lawn", "Lawn care"],
    ["Landscaping", "Gardening"],
    ["Pool care", "Pool"],
    ["Pest control", "pest_control"],
    ["Painting", "painting"],
    ["Gutters", "gutter"],
    ["Seasonal maintenance", "seasonal_maintenance"],
  ])("allows a verified %s provider to bid on %s", async (trade, category) => {
    state.trades = [trade]; state.category = category;
    await expect(submitBid("provider-1", "request-1", bid)).resolves.toMatchObject({
      requestId: "request-1", providerUserId: "provider-1", amountCents: 20_000,
    });
    expect(state.writes).toHaveLength(1);
    expect(state.lockRequest).toHaveBeenCalledOnce();
    expect(state.lockRequest.mock.calls[0]).toEqual([expect.objectContaining({
      strings: ['SELECT "id" FROM "HoaServiceRequest" WHERE "id" = ', ' FOR UPDATE'],
      values: ["request-1"],
    })]);
  });

  it.each([
    ["plumbing", "lawn"],
    ["Drain clearing", "Drain clearing"],
    ["Drain clearing", "other"],
    ["other", "not a supported category"],
  ])("refuses %s for %s without writing a bid", async (trade, category) => {
    state.trades = [trade]; state.category = category;
    await expect(submitBid("provider-1", "request-1", bid)).rejects.toMatchObject({ status: 403 });
    expect(state.writes).toEqual([]);
  });

  it.each(["role", "account", "license", "insurance", "coverage", "closed", "expired"])(
    "keeps the %s guard intact for a normalized lawn-care provider", async (guard) => {
      if (guard === "role") state.role = "homeowner";
      if (guard === "account") state.accountStatus = "suspended";
      if (guard === "license") state.licenseVerified = false;
      if (guard === "insurance") state.insuranceVerified = false;
      if (guard === "coverage") state.covered = false;
      if (guard === "closed") state.open = false;
      if (guard === "expired") state.deadline = new Date(Date.now() - 1_000);
      await expect(submitBid("provider-1", "request-1", bid)).rejects.toThrow();
      expect(state.writes).toEqual([]);
    },
  );
});
