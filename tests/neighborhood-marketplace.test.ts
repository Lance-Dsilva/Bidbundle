import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The non-HOA neighbourhood lifecycle, against a scripted database.
 *
 * These assert *behaviour* — who may act, what gets written, and what is
 * refused — rather than the presence of source text. The scripted `db` records
 * every write so a test can prove that a refusal wrote nothing at all, which
 * is the property a partial award would violate.
 */

type Op = { model: string; action: string; args: Record<string, unknown> };

const state = vi.hoisted(() => ({
  community: null as Record<string, unknown> | null,
  request: null as Record<string, unknown> | null,
  /** Active `neighborhood_manager` assignment, or null when there is none. */
  managerAssignment: null as Record<string, unknown> | null,
  membership: null as Record<string, unknown> | null,
  participation: null as Record<string, unknown> | null,
  joinedCount: 0,
  bid: null as Record<string, unknown> | null,
  providerUser: null as Record<string, unknown> | null,
  losingBids: [] as Array<Record<string, unknown>>,
  participants: [] as Array<Record<string, unknown>>,
  /** Users returned when resolving neighbourhood service targets. */
  users: [] as Array<Record<string, unknown>>,
  adminGrant: null as Record<string, unknown> | null,
  actorRole: "homeowner",
  profile: { address: "1 Oak St", latitude: 30.4, longitude: -97.7 } as { address: string | null; latitude: number | null; longitude: number | null },
  profileReads: [] as unknown[],
  batches: [] as Op[][],
  writes: [] as Op[],
}));

function op(model: string, action: string) {
  return (args: Record<string, unknown>): Op => {
    const entry = { model, action, args };
    state.writes.push(entry);
    return entry;
  };
}

vi.mock("@/lib/server/db", () => ({
  db: {
    community: { findUnique: async () => state.community },
    communityStaffAssignment: {
      findFirst: async (args: { where?: { role?: unknown } }) => {
        const role = args?.where?.role;
        return role === "neighborhood_manager" ? state.managerAssignment : null;
      },
      findMany: async () => [],
    },
    communityMembership: {
      findFirst: async () => state.membership,
      findMany: async () => state.participants,
      count: async () => state.participants.length,
    },
    adminAccessGrant: { findUnique: async () => state.adminGrant },
    hoaServiceRequest: {
      findUnique: async () => state.request,
      findFirst: async () => state.request,
      findMany: async () => [],
      update: op("hoaServiceRequest", "update"),
      updateMany: op("hoaServiceRequest", "updateMany"),
    },
    hoaRequestParticipation: {
      findFirst: async () => state.participation,
      findMany: async () => state.participants,
      count: async () => state.joinedCount,
      create: op("hoaRequestParticipation", "create"),
      update: op("hoaRequestParticipation", "update"),
      updateMany: op("hoaRequestParticipation", "updateMany"),
    },
    serviceBid: {
      findUnique: async () => state.bid,
      findMany: async () => state.losingBids,
      update: op("serviceBid", "update"),
      updateMany: op("serviceBid", "updateMany"),
    },
    user: {
      findUnique: async (args: { select?: Record<string, unknown> }) => {
        if (args.select?.address) { state.profileReads.push(args); return state.profile; }
        return state.providerUser ?? { id: "actor", email: "actor@example.com", role: state.actorRole };
      },
      findMany: async () => state.users,
    },
    serviceAgreement: { create: op("serviceAgreement", "create"), findUnique: async () => null },
    serviceOccurrence: {
      createMany: op("serviceOccurrence", "createMany"),
      findMany: async () => [],
      count: async () => 0,
    },
    serviceVisit: { createMany: op("serviceVisit", "createMany"), findMany: async () => [] },
    adminAuditLog: { create: op("adminAuditLog", "create") },
    notification: { createMany: op("notification", "createMany") },
    outboxEvent: { createMany: op("outboxEvent", "createMany") },
    hoaProfile: { findUnique: async () => null },
    providerServiceArea: { findMany: async () => [] },
    providerProfile: { findMany: async () => [] },
    homeownerProfile: { findMany: async () => [] },
    $executeRaw: (query: unknown) => op("managerAuthority", "assert")({ query }),
    $transaction: async (ops: Op[]) => {
      state.batches.push(ops);
      return ops;
    },
  },
}));

import { HoaWorkflowError } from "@/lib/server/hoa";
import { awardBid, MissingParticipantAddressError, transitionHoaRequest } from "@/lib/server/hoa-market";
import { requireCommunityManager } from "@/lib/server/market-auth";
import { respondToNeighborhoodRequest } from "@/lib/server/neighborhood-market";
import { homeownerTargets, splitProfileAddress, unitTargets } from "@/lib/server/service-targets";

const NEIGHBOURHOOD = {
  id: "hood-1",
  name: "Oakwood Heights",
  type: "neighborhood",
  status: "active",
};

function activeManager(userId = "manager-1") {
  return { user: { id: userId, email: `${userId}@example.com`, fullName: "Casey Manager" } };
}

function collectingRequest(overrides: Record<string, unknown> = {}) {
  return {
    id: "request-1",
    communityId: "hood-1",
    status: "collecting_interest",
    kind: "optional_group",
    title: "Pressure washing",
    category: "cleaning",
    minHomes: 1,
    maxHomes: null,
    createdByUserId: "resident-a",
    updatedAt: new Date(Date.now() - 1000),
    enrollmentClosesAt: new Date(Date.now() + 86_400_000),
    biddingClosesAt: null,
    participantsLockedAt: null,
    recurrenceIntervalDays: null,
    totalOccurrences: 1,
    startDate: null,
    community: { id: "hood-1", name: "Oakwood Heights", type: "neighborhood" },
    participations: [{ unitId: null, userId: "resident-a", response: "joined" }],
    agreement: null,
    ...overrides,
  };
}

beforeEach(() => {
  state.profile = { address: "1 Oak St", latitude: 30.4, longitude: -97.7 };
  state.profileReads = [];
  state.batches = [];
  state.writes = [];
  state.community = { ...NEIGHBOURHOOD };
  state.request = collectingRequest();
  state.managerAssignment = activeManager();
  state.membership = { id: "membership-1", community: { id: "hood-1", name: "Oakwood Heights" } };
  state.participation = null;
  state.joinedCount = 1;
  state.bid = null;
  state.providerUser = null;
  state.losingBids = [];
  state.participants = [];
  state.users = [];
  state.adminGrant = null;
  state.actorRole = "homeowner";
});

/* ── Authority ───────────────────────────────────────────────────────────── */

describe("neighbourhood manager authority", () => {
  it("grants the assigned, still-resident manager", async () => {
    await expect(requireCommunityManager("manager-1", "hood-1")).resolves.toMatchObject({
      via: "neighborhood_manager",
    });
  });

  it("refuses an ordinary resident", async () => {
    await expect(requireCommunityManager("resident-a", "hood-1")).rejects.toBeInstanceOf(
      HoaWorkflowError,
    );
  });

  it("removes authority the moment the assignment goes", async () => {
    state.managerAssignment = null;
    await expect(requireCommunityManager("manager-1", "hood-1")).rejects.toMatchObject({
      status: 403,
    });
  });

  it("hands authority to a replacement manager without a second grant", async () => {
    state.managerAssignment = activeManager("manager-2");
    await expect(requireCommunityManager("manager-2", "hood-1")).resolves.toMatchObject({
      via: "neighborhood_manager",
    });
    await expect(requireCommunityManager("manager-1", "hood-1")).rejects.toBeInstanceOf(
      HoaWorkflowError,
    );
  });

  it("gives a Bundleen admin an audited recovery path", async () => {
    state.actorRole = "admin";
    state.providerUser = { id: "admin-1", email: "admin@bundleen.test", role: "admin" };
    state.adminGrant = { status: "active" };

    await expect(requireCommunityManager("admin-1", "hood-1")).resolves.toMatchObject({
      via: "admin_recovery",
    });
  });

  it("does not treat a non-admin account with a stale grant as staff", async () => {
    state.providerUser = { id: "resident-a", email: "a@example.com", role: "homeowner" };
    state.adminGrant = { status: "active" };
    await expect(requireCommunityManager("resident-a", "hood-1")).rejects.toBeInstanceOf(
      HoaWorkflowError,
    );
  });
});

/* ── Participation ───────────────────────────────────────────────────────── */

describe("joining and declining", () => {
  it.each([
    { address: null, latitude: null, longitude: null },
    { address: "  ", latitude: 30, longitude: -97 },
    { address: "1 Oak St", latitude: null, longitude: -97 },
    { address: "1 Oak St", latitude: 30, longitude: null },
    { address: "1 Oak St", latitude: 91, longitude: -97 },
    { address: "1 Oak St", latitude: 30, longitude: -181 },
    { address: "1 Oak St", latitude: Number.NaN, longitude: -97 },
    { address: "1 Oak St", latitude: 30, longitude: Infinity },
  ])("blocks joining without a routeable own profile before any write: %j", async (profile) => {
    state.profile = profile;
    await expect(respondToNeighborhoodRequest("resident-b", "request-1", "joined")).rejects.toMatchObject({ status: 409, name: "HomeAddressRequiredError" });
    expect(state.writes).toEqual([]);
    expect(state.batches).toEqual([]);
    expect(state.profileReads).toEqual([{ where: { id: "resident-b" }, select: { address: true, latitude: true, longitude: true } }]);
  });

  it("requires an address even when repeating an already-joined answer", async () => {
    state.profile = { address: null, latitude: null, longitude: null };
    state.participation = { id: "joined", response: "joined" };
    await expect(respondToNeighborhoodRequest("resident-b", "request-1", "joined")).rejects.toMatchObject({ status: 409 });
    expect(state.writes).toEqual([]);
  });

  it("does not query or disclose the profile before membership authorization", async () => {
    state.membership = null;
    state.profile = { address: null, latitude: null, longitude: null };
    await expect(respondToNeighborhoodRequest("outsider", "request-1", "joined")).rejects.toMatchObject({ status: 403 });
    expect(state.profileReads).toEqual([]);
    expect(state.writes).toEqual([]);
  });

  it("allows declining without requiring a profile address", async () => {
    state.profile = { address: null, latitude: null, longitude: null };
    state.participation = { id: "participation-1", response: "joined" };
    await respondToNeighborhoodRequest("resident-b", "request-1", "declined");
    expect(state.profileReads).toEqual([]);
    expect(state.writes.some((write) => write.model === "hoaRequestParticipation")).toBe(true);
  });

  it("accepts zero coordinates as a valid routeable location", async () => {
    state.profile = { address: " Equator Home ", latitude: 0, longitude: 0 };
    await respondToNeighborhoodRequest("resident-b", "request-1", "joined");
    expect(state.writes.some((write) => write.model === "hoaRequestParticipation")).toBe(true);
  });

  it("records a neighbour's join against the homeowner, not a unit", async () => {
    await respondToNeighborhoodRequest("resident-b", "request-1", "joined");

    const created = state.writes.find(
      (write) => write.model === "hoaRequestParticipation" && write.action === "create",
    );
    expect(created).toBeDefined();
    expect((created!.args as { data: Record<string, unknown> }).data).toMatchObject({
      userId: "resident-b",
      unitId: null,
      response: "joined",
    });
  });

  it("is idempotent: the same answer twice writes once", async () => {
    state.participation = { id: "participation-1", response: "joined" };
    await respondToNeighborhoodRequest("resident-b", "request-1", "joined");

    expect(
      state.writes.filter((write) => write.model === "hoaRequestParticipation"),
    ).toHaveLength(0);
  });

  it("lets a neighbour change their mind by updating one row", async () => {
    state.participation = { id: "participation-1", response: "joined" };
    await respondToNeighborhoodRequest("resident-b", "request-1", "declined");

    const updates = state.writes.filter(
      (write) => write.model === "hoaRequestParticipation" && write.action === "update",
    );
    expect(updates).toHaveLength(1);
  });

  it("refuses an outsider without revealing anything about the request", async () => {
    state.membership = null;
    const error = await respondToNeighborhoodRequest("stranger", "request-1", "joined").catch(
      (caught: HoaWorkflowError) => caught,
    );

    expect(error).toBeInstanceOf(HoaWorkflowError);
    expect((error as HoaWorkflowError).status).toBe(403);
    expect((error as Error).message).not.toContain("Pressure washing");
    expect((error as Error).message).not.toContain("Oakwood");
    expect(state.writes).toHaveLength(0);
  });

  it("refuses once enrolment has closed", async () => {
    state.request = collectingRequest({
      enrollmentClosesAt: new Date(Date.now() - 1_000),
    });
    await expect(
      respondToNeighborhoodRequest("resident-b", "request-1", "joined"),
    ).rejects.toBeInstanceOf(HoaWorkflowError);
    expect(state.writes).toHaveLength(0);
  });

  it("refuses once participants are locked", async () => {
    state.request = collectingRequest({ participantsLockedAt: new Date() });
    await expect(
      respondToNeighborhoodRequest("resident-b", "request-1", "joined"),
    ).rejects.toBeInstanceOf(HoaWorkflowError);
  });

  it("will not let the requester decline their own request out of existence", async () => {
    await expect(
      respondToNeighborhoodRequest("resident-a", "request-1", "declined"),
    ).rejects.toBeInstanceOf(HoaWorkflowError);
  });

  it("refuses a request in someone else's kind of community", async () => {
    state.request = collectingRequest({
      community: { id: "hoa-1", name: "Cedar Park HOA", type: "hoa" },
    });
    await expect(
      respondToNeighborhoodRequest("resident-b", "request-1", "joined"),
    ).rejects.toMatchObject({ status: 404 });
  });
});

/* ── Lifecycle ───────────────────────────────────────────────────────────── */

describe("opening and closing bidding", () => {
  it("lets the manager open bidding with a single participating home", async () => {
    await transitionHoaRequest("manager-1", "request-1", {
      action: "open_bidding",
      biddingClosesAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    });

    const update = state.writes.find(
      (write) => write.model === "hoaServiceRequest" && write.action === "update",
    );
    expect((update!.args as { data: Record<string, unknown> }).data).toMatchObject({
      status: "open_for_bids",
    });
    // The participant snapshot is locked in the same commit.
    expect((update!.args as { data: Record<string, unknown> }).data.participantsLockedAt)
      .toBeInstanceOf(Date);
  });

  it("refuses an ordinary resident, and writes nothing", async () => {
    await expect(
      transitionHoaRequest("resident-a", "request-1", {
        action: "open_bidding",
        biddingClosesAt: new Date(Date.now() + 86_400_000).toISOString(),
      }),
    ).rejects.toBeInstanceOf(HoaWorkflowError);
    expect(state.batches).toHaveLength(0);
  });

  it("requires a future bidding deadline", async () => {
    await expect(
      transitionHoaRequest("manager-1", "request-1", {
        action: "open_bidding",
        biddingClosesAt: new Date(Date.now() - 1_000).toISOString(),
      }),
    ).rejects.toBeInstanceOf(HoaWorkflowError);
    expect(state.batches).toHaveLength(0);
  });

  it("honours a higher minHomes when the request sets one", async () => {
    state.request = collectingRequest({ minHomes: 3 });
    await expect(
      transitionHoaRequest("manager-1", "request-1", {
        action: "open_bidding",
        biddingClosesAt: new Date(Date.now() + 86_400_000).toISOString(),
      }),
    ).rejects.toThrow(/3 homes/);
  });

  it("records the context and the authority in the audit trail", async () => {
    await transitionHoaRequest("manager-1", "request-1", {
      action: "open_bidding",
      biddingClosesAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    });

    const audits = state.writes.filter((write) => write.model === "adminAuditLog");
    const serialized = JSON.stringify(audits.map((audit) => audit.args));
    // Both survive redaction, which is what makes an admin recovery action
    // distinguishable from an ordinary manager action after the fact.
    expect(serialized).toContain("neighborhood");
    expect(serialized).toContain("neighborhood_manager");
  });

  it("marks an admin's action as a recovery, not an ordinary transition", async () => {
    state.managerAssignment = null;
    state.actorRole = "admin";
    state.providerUser = { id: "admin-1", email: "admin@bundleen.test", role: "admin" };
    state.adminGrant = { status: "active" };

    await transitionHoaRequest("admin-1", "request-1", {
      action: "open_bidding",
      biddingClosesAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    });

    const audits = state.writes.filter((write) => write.model === "adminAuditLog");
    expect(JSON.stringify(audits.map((audit) => audit.args))).toContain("admin_recovery");
  });

  it("closes bidding on the manager's word", async () => {
    state.request = collectingRequest({
      status: "open_for_bids",
      biddingClosesAt: new Date(Date.now() + 86_400_000),
      participantsLockedAt: new Date(),
    });
    await transitionHoaRequest("manager-1", "request-1", { action: "close_bidding" });

    const update = state.writes.find(
      (write) => write.model === "hoaServiceRequest" && write.action === "update",
    );
    expect((update!.args as { data: Record<string, unknown> }).data).toMatchObject({
      status: "bidding_closed",
    });
  });
});

/* ── Award ───────────────────────────────────────────────────────────────── */

function readyToAward(overrides: Record<string, unknown> = {}) {
  state.request = collectingRequest({
    status: "bidding_closed",
    participantsLockedAt: new Date(),
    participations: [
      { unitId: null, userId: "resident-a", response: "joined" },
      { unitId: null, userId: "resident-b", response: "joined" },
    ],
    ...overrides,
  });
  state.bid = {
    id: "bid-1",
    requestId: "request-1",
    providerUserId: "provider-1",
    status: "submitted",
    amountCents: 40_000,
    currency: "usd",
    pricingBasis: "total",
    perHomeCents: null,
    proposedStartDate: null,
    scope: "Driveways and patios",
    exclusions: null,
    cadenceLabel: null,
    validUntil: null,
    provider: {
      fullName: "Shine Co",
      providerProfile: {
        companyName: "Shine Co LLC",
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
  state.users = [
    {
      id: "resident-a",
      fullName: "Alex Resident",
      address: "11800 Cedar Lane, Austin, TX 78758",
      latitude: 30.4,
      longitude: -97.72,
    },
    {
      id: "resident-b",
      fullName: "Bea Resident",
      address: "11802 Cedar Lane, Austin, TX 78758",
      latitude: 30.401,
      longitude: -97.721,
    },
  ];
}

describe("awarding a neighbourhood request", () => {
  beforeEach(readyToAward);

  it("creates one agreement, one occurrence, and one visit per locked home", async () => {
    const agreementId = await awardBid("manager-1", "request-1", { bidId: "bid-1" });
    expect(agreementId).toBeTruthy();
    expect(state.batches).toHaveLength(1);

    const batch = state.batches[0]!;
    const agreement = batch.find((entry) => entry.model === "serviceAgreement")!;
    expect((agreement.args as { data: Record<string, unknown> }).data).toMatchObject({
      lockedHomeCount: 2,
    });

    const occurrences = batch.find((entry) => entry.model === "serviceOccurrence")!;
    expect((occurrences.args.data as unknown[]).length).toBe(1);

    const visits = batch.find((entry) => entry.model === "serviceVisit")!;
    const visitRows = visits.args.data as Array<Record<string, unknown>>;
    expect(visitRows).toHaveLength(2);
    // Exactly one target per row, and the neighbourhood one carries a snapshot.
    for (const row of visitRows) {
      expect(row.unitId).toBeUndefined();
      expect(row.homeownerUserId).toBeTruthy();
      expect(row.serviceAddressLine1).toBeTruthy();
      expect(typeof row.serviceLatitude).toBe("number");
      expect(typeof row.serviceLongitude).toBe("number");
    }
  });

  it("aborts with an actionable list when a participant has no address", async () => {
    state.users = [
      {
        id: "resident-a",
        fullName: "Alex Resident",
        address: "11800 Cedar Lane, Austin, TX 78758",
        latitude: 30.4,
        longitude: -97.72,
      },
      { id: "resident-b", fullName: "Bea Resident", address: null, latitude: null, longitude: null },
    ];

    const error = await awardBid("manager-1", "request-1", { bidId: "bid-1" }).catch(
      (caught: MissingParticipantAddressError) => caught,
    );

    expect(error).toBeInstanceOf(MissingParticipantAddressError);
    expect((error as MissingParticipantAddressError).missing).toEqual([
      { userId: "resident-b", displayName: "Bea Resident" },
    ]);
    // Nothing partial: no agreement, no occurrence, no visit.
    expect(state.batches).toHaveLength(0);
  });

  it("aborts when a participant has an address but no resolved coordinates", async () => {
    state.users = [
      {
        id: "resident-a",
        fullName: "Alex Resident",
        address: "11800 Cedar Lane",
        latitude: 30.4,
        longitude: -97.72,
      },
      {
        id: "resident-b",
        fullName: "Bea Resident",
        address: "11802 Cedar Lane",
        latitude: null,
        longitude: null,
      },
    ];

    await expect(awardBid("manager-1", "request-1", { bidId: "bid-1" })).rejects.toBeInstanceOf(
      MissingParticipantAddressError,
    );
    expect(state.batches).toHaveLength(0);
  });

  it("refuses an ordinary resident's award attempt", async () => {
    await expect(
      awardBid("resident-b", "request-1", { bidId: "bid-1" }),
    ).rejects.toBeInstanceOf(HoaWorkflowError);
    expect(state.batches).toHaveLength(0);
  });

  it("permits a manager award while bidding is still open", async () => {
    state.request = { ...state.request!, status: "open_for_bids" };
    await expect(awardBid("manager-1", "request-1", { bidId: "bid-1" })).resolves.toBeTypeOf("string");
    expect(state.batches).toHaveLength(1);
    expect(state.batches[0][0]).toMatchObject({ model: "hoaServiceRequest", action: "update", args: { where: { status: "open_for_bids", updatedAt: state.request.updatedAt }, data: { status: "awarded", biddingClosesAt: expect.any(Date) } } });
  });

  it("is idempotent under a double-click", async () => {
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

  it("refuses a second award for a different bid", async () => {
    state.request = {
      ...state.request!,
      status: "awarded",
      agreement: { id: "agreement-1", bidId: "bid-1" },
    };
    await expect(awardBid("manager-1", "request-1", { bidId: "bid-2" })).rejects.toThrow(
      /different bid/,
    );
  });

  it("notifies only the neighbours who joined", async () => {
    state.participants = [
      { user: { id: "resident-b", email: "b@example.com" } },
    ];
    await awardBid("manager-1", "request-1", { bidId: "bid-1" });

    const notifications = state.batches[0]!.find(
      (entry) => entry.model === "notification" && entry.action === "createMany",
    )!;
    const rows = notifications.args.data as Array<{ userId: string }>;
    const recipients = rows.map((row) => row.userId);
    expect(recipients).toContain("provider-1");
    expect(recipients).toContain("resident-b");
    // A neighbour who never joined is not on the list.
    expect(recipients).not.toContain("resident-c");
  });

  it("does not leak the accepted amount into notification text", async () => {
    state.participants = [{ user: { id: "resident-b", email: "b@example.com" } }];
    await awardBid("manager-1", "request-1", { bidId: "bid-1" });

    const notifications = state.batches[0]!.find(
      (entry) => entry.model === "notification" && entry.action === "createMany",
    )!;
    expect(JSON.stringify(notifications.args.data)).not.toContain("40000");
  });
});

/* ── Target resolution ───────────────────────────────────────────────────── */

describe("service targets", () => {
  it("keeps HOA participations pointed at units, de-duplicated", () => {
    expect(
      unitTargets([
        { unitId: "unit-1", userId: "a" },
        { unitId: "unit-1", userId: "a" },
        { unitId: "unit-2", userId: null },
        { unitId: null, userId: "c" },
      ]),
    ).toEqual([
      { kind: "unit", unitId: "unit-1", userId: "a" },
      { kind: "unit", unitId: "unit-2", userId: null },
    ]);
  });

  it("snapshots a homeowner's address rather than referencing their profile", async () => {
    state.users = [
      {
        id: "resident-a",
        fullName: "Alex Resident",
        address: "11800 Cedar Lane, Austin, TX 78758",
        latitude: 30.4,
        longitude: -97.72,
      },
    ];
    const resolution = await homeownerTargets([{ userId: "resident-a" }]);

    expect(resolution.ok).toBe(true);
    if (resolution.ok) {
      expect(resolution.targets[0]).toMatchObject({
        kind: "homeowner",
        userId: "resident-a",
        addressLine1: "11800 Cedar Lane",
        locality: "Austin",
        region: "TX",
        postalCode: "78758",
        latitude: 30.4,
        longitude: -97.72,
      });
    }
  });

  it("splits a single-line profile address into routeable parts", () => {
    expect(splitProfileAddress("11800 Cedar Lane, Austin, TX 78758")).toEqual({
      addressLine1: "11800 Cedar Lane",
      locality: "Austin",
      region: "TX",
      postalCode: "78758",
    });
    // Anything it cannot parse stays whole rather than being mangled.
    expect(splitProfileAddress("Rose Cottage")).toEqual({
      addressLine1: "Rose Cottage",
      locality: null,
      region: null,
      postalCode: null,
    });
  });
});
