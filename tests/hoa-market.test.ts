import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Marketplace service tests with a scripted database, in the same style as
 * `community-service.test.ts`: assert what is written and that related writes
 * travel as one `$transaction` batch, because a half-applied award is exactly
 * the failure the service exists to prevent.
 */

type Op = { model: string; action: string; args: Record<string, unknown> };

const state = vi.hoisted(() => ({
  request: null as Record<string, unknown> | null,
  managerAssignment: null as Record<string, unknown> | null,
  bid: null as Record<string, unknown> | null,
  providerUser: null as Record<string, unknown> | null,
  losingBids: [] as Array<Record<string, unknown>>,
  residents: [] as Array<Record<string, unknown>>,
  batches: [] as Op[][],
}));

function op(model: string, action: string) {
  return (args: Record<string, unknown>): Op => ({ model, action, args });
}

vi.mock("@/lib/server/db", () => ({
  db: {
    hoaServiceRequest: {
      findUnique: async () => state.request,
      update: op("hoaServiceRequest", "update"),
      updateMany: op("hoaServiceRequest", "updateMany"),
    },
    communityStaffAssignment: {
      findFirst: async () => state.managerAssignment,
      findMany: async () => [],
    },
    communityMembership: {
      findFirst: async () => null,
      findMany: async () => state.residents,
    },
    serviceBid: {
      findUnique: async () => state.bid,
      findMany: async () => state.losingBids,
      update: op("serviceBid", "update"),
      updateMany: op("serviceBid", "updateMany"),
    },
    user: {
      findUnique: async () => state.providerUser,
    },
    serviceAgreement: {
      create: op("serviceAgreement", "create"),
      findUnique: async () => null,
    },
    serviceOccurrence: {
      createMany: op("serviceOccurrence", "createMany"),
      count: async () => 0,
    },
    serviceVisit: {
      createMany: op("serviceVisit", "createMany"),
    },
    adminAuditLog: {
      create: op("adminAuditLog", "create"),
    },
    notification: {
      createMany: op("notification", "createMany"),
    },
    outboxEvent: {
      createMany: op("outboxEvent", "createMany"),
    },
    hoaProfile: {
      findUnique: async () => null,
    },
    providerServiceArea: {
      findMany: async () => [],
    },
    $transaction: async (ops: Op[]) => {
      state.batches.push(ops);
      return ops;
    },
  },
}));

import { areaCoversLocation, awardBid } from "@/lib/server/hoa-market";
import { HoaWorkflowError } from "@/lib/server/hoa";
import { buildNotificationOps, contentHash } from "@/lib/server/notifications";

const HOA_LOCATION = {
  latitude: 30.4021,
  longitude: -97.7266,
  postalCode: "78758",
  locality: "Austin",
  region: "TX",
};

describe("areaCoversLocation", () => {
  it("matches a circle that reaches the HOA and rejects one that does not", () => {
    const nearArea = {
      centerLatitude: 30.45,
      centerLongitude: -97.7,
      radiusMiles: 10,
      postalCodes: [],
    };
    const farArea = {
      centerLatitude: 29.42,
      centerLongitude: -98.49,
      radiusMiles: 10,
      postalCodes: [],
    };
    expect(areaCoversLocation(nearArea, HOA_LOCATION)).toBe(true);
    expect(areaCoversLocation(farArea, HOA_LOCATION)).toBe(false);
  });

  it("matches postal-code coverage case-insensitively", () => {
    const area = {
      centerLatitude: null,
      centerLongitude: null,
      radiusMiles: null,
      postalCodes: ["78758"],
    };
    expect(areaCoversLocation(area, HOA_LOCATION)).toBe(true);
    expect(areaCoversLocation(area, { ...HOA_LOCATION, postalCode: "73301" })).toBe(false);
  });

  it("covers nothing when the HOA has no location on file", () => {
    const area = {
      centerLatitude: 30.45,
      centerLongitude: -97.7,
      radiusMiles: 100,
      postalCodes: [],
    };
    expect(
      areaCoversLocation(area, {
        latitude: null,
        longitude: null,
        postalCode: null,
        locality: null,
        region: null,
      }),
    ).toBe(false);
  });
});

describe("awardBid", () => {
  beforeEach(() => {
    state.batches = [];
    state.managerAssignment = {
      id: "assignment-1",
      community: { id: "hoa-1", name: "Cedar Park HOA" },
    };
    state.request = {
      id: "request-1",
      communityId: "hoa-1",
      status: "bidding_closed",
      kind: "compulsory_recurring",
      title: "Biweekly gardening",
      recurrenceIntervalDays: 14,
      totalOccurrences: 3,
      startDate: new Date("2026-09-01T00:00:00Z"),
      community: { id: "hoa-1", name: "Cedar Park HOA" },
      participations: [
        { unitId: "unit-1", userId: "resident-1" },
        { unitId: "unit-2", userId: null },
      ],
      agreement: null,
    };
    state.bid = {
      id: "bid-1",
      requestId: "request-1",
      providerUserId: "provider-1",
      status: "submitted",
      amountCents: 45_000,
      currency: "usd",
      pricingBasis: "per_visit",
      perHomeCents: null,
      proposedStartDate: null,
      scope: "Mow and edge",
      exclusions: null,
      cadenceLabel: "Biweekly",
      validUntil: null,
      provider: {
        fullName: "Green Crew",
        providerProfile: {
          companyName: "Green Crew LLC",
          licenseVerifiedAt: new Date(),
          insuranceVerifiedAt: new Date(),
        },
      },
    };
    state.providerUser = {
      id: "provider-1",
      email: "provider@example.com",
      providerProfile: { accountStatus: "active" },
    };
    state.losingBids = [
      { id: "bid-2", provider: { id: "provider-2", email: "other@example.com" } },
    ];
    state.residents = [
      { user: { id: "resident-1", email: "resident1@example.com" } },
    ];
  });

  it("performs the entire award as one transaction batch", async () => {
    const agreementId = await awardBid("manager-1", "request-1", { bidId: "bid-1" });
    expect(agreementId).toBeTruthy();
    expect(state.batches).toHaveLength(1);

    const batch = state.batches[0];
    const byModel = (model: string, action?: string) =>
      batch.filter((item) => item.model === model && (!action || item.action === action));

    // Exactly one bid accepted, the rest rejected in the same commit.
    expect(byModel("serviceBid", "update")).toHaveLength(1);
    expect(byModel("serviceBid", "updateMany")).toHaveLength(1);
    const rejectOthers = byModel("serviceBid", "updateMany")[0];
    expect(rejectOthers.args).toMatchObject({
      where: { requestId: "request-1", status: "submitted", id: { not: "bid-1" } },
      data: expect.objectContaining({ status: "rejected" }),
    });

    // Agreement snapshot, materialized occurrences and visits, audit entry.
    const agreement = byModel("serviceAgreement", "create")[0];
    expect(agreement.args).toMatchObject({
      data: expect.objectContaining({
        requestId: "request-1",
        bidId: "bid-1",
        amountCents: 45_000,
        lockedHomeCount: 2,
      }),
    });
    const occurrences = byModel("serviceOccurrence", "createMany")[0];
    expect((occurrences.args.data as unknown[]).length).toBe(3);
    const visits = byModel("serviceVisit", "createMany")[0];
    expect((visits.args.data as unknown[]).length).toBe(6);
    expect(byModel("adminAuditLog", "create")).toHaveLength(1);

    // Winner, loser, and resident notifications ride in the same commit.
    const notifications = byModel("notification", "createMany")[0];
    const rows = notifications.args.data as Array<{ userId: string; dedupeKey: string }>;
    expect(rows.map((row) => row.userId)).toEqual(
      expect.arrayContaining(["provider-1", "provider-2", "resident-1"]),
    );
    expect((notifications.args as { skipDuplicates?: boolean }).skipDuplicates).toBe(true);
  });

  it("refuses to award while bidding is still open", async () => {
    state.request = { ...state.request!, status: "open_for_bids" };
    await expect(awardBid("manager-1", "request-1", { bidId: "bid-1" })).rejects.toThrow(
      HoaWorkflowError,
    );
    expect(state.batches).toHaveLength(0);
  });

  it("returns the existing agreement for a repeated award of the same bid", async () => {
    state.request = {
      ...state.request!,
      status: "awarded",
      agreement: { id: "agreement-1", bidId: "bid-1" },
    };
    await expect(awardBid("manager-1", "request-1", { bidId: "bid-1" })).resolves.toBe(
      "agreement-1",
    );
    expect(state.batches).toHaveLength(0);
  });

  it("rejects a second award for a different bid", async () => {
    state.request = {
      ...state.request!,
      status: "awarded",
      agreement: { id: "agreement-1", bidId: "bid-1" },
    };
    await expect(awardBid("manager-1", "request-1", { bidId: "bid-2" })).rejects.toThrow(
      "different bid",
    );
  });

  it("refuses when the winning provider is no longer active", async () => {
    state.providerUser = {
      id: "provider-1",
      email: "provider@example.com",
      providerProfile: { accountStatus: "suspended" },
    };
    await expect(awardBid("manager-1", "request-1", { bidId: "bid-1" })).rejects.toThrow(
      HoaWorkflowError,
    );
    expect(state.batches).toHaveLength(0);
  });
});

describe("notifications", () => {
  it("hashes content deterministically so retries dedupe and changes do not", () => {
    expect(contentHash(["2026-09-01", "09:00", 1])).toBe(contentHash(["2026-09-01", "09:00", 1]));
    expect(contentHash(["2026-09-01", "09:00", 1])).not.toBe(
      contentHash(["2026-09-01", "10:00", 1]),
    );
  });

  it("creates in-app rows always and outbox rows only for email recipients", () => {
    const ops = buildNotificationOps([
      {
        userId: "user-1",
        email: "user1@example.com",
        kind: "award",
        title: "Provider selected",
        body: "Your HOA chose a provider.",
        dedupeKey: "award:r1:user-1",
      },
      {
        userId: "user-2",
        email: null,
        kind: "award",
        title: "Provider selected",
        body: "Your HOA chose a provider.",
        dedupeKey: "award:r1:user-2",
      },
    ]) as unknown as Op[];

    expect(ops).toHaveLength(2);
    const [notifications, outbox] = ops;
    expect(notifications.model).toBe("notification");
    expect((notifications.args.data as unknown[]).length).toBe(2);
    expect(outbox.model).toBe("outboxEvent");
    const outboxRows = outbox.args.data as Array<{ dedupeKey: string }>;
    expect(outboxRows).toHaveLength(1);
    expect(outboxRows[0].dedupeKey).toBe("email:award:r1:user-1");
  });

  it("returns no operations for an empty intent list", () => {
    expect(buildNotificationOps([])).toHaveLength(0);
  });
});
