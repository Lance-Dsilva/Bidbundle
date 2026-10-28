import { beforeEach, describe, expect, it, vi } from "vitest";
import { awardSchema, type BidSubmitInput } from "@/lib/validation/hoa";
import { neighborhoodAwardSchema } from "@/lib/validation/neighborhood";
type Row = Record<string, unknown>;
type Op = { model: string; args: Row; then: PromiseLike<unknown>["then"] };
const state = vi.hoisted(() => ({ bid: {} as Row, request: {} as Row, agreement: null as Row | null, effects: [] as string[], claims: [] as Row[], beforeWrite: null as (() => void) | null, failure: null as Row | null, failModel: null as string | null }));
function matches(actual: unknown, expected: unknown): boolean {
  if (expected instanceof Date) return actual instanceof Date && +actual === +expected;
  if (expected === null || typeof expected !== "object") return actual === expected;
  return Object.entries(expected as Row).every(([key, value]) => {
    if (key === "OR") return (value as unknown[]).some((part) => matches(actual, part));
    if (key === "gt") return Number(actual) > Number(value);
    if (key === "not") return !matches(actual, value);
    return matches((actual as Row | null)?.[key], value);
  });
}
function execute(model: string, args: Row) {
  const before = state.beforeWrite; state.beforeWrite = null; before?.();
  if (state.failure && (!state.failModel || state.failModel === model)) { const error = state.failure; state.failure = null; state.failModel = null; throw error; }
  if (model === "bid") {
    const actual = { ...state.bid, request: state.request };
    if (!matches(actual, args.where)) throw { code: "P2025" };
    const data = args.data as Row;
    Object.assign(state.bid, data, typeof data.version === "object" ? { version: Number(state.bid.version) + Number((data.version as Row).increment) } : {});
  } else if (model === "request") Object.assign(state.request, args.data);
  else if (model === "agreement") { state.agreement = args.data as Row; state.request.agreement = { id: state.agreement.id, bidId: state.agreement.bidId }; }
  state.effects.push(model);
  return state.bid;
}
function plan(model: string, args: Row): Op {
  if (model === "bid") state.claims.push(args);
  return { model, args, then(resolve, reject) { return Promise.resolve().then(() => execute(model, args)).then(resolve, reject); } };
}
vi.mock("@/lib/server/db", () => ({ db: {
  hoaServiceRequest: { findUnique: async () => structuredClone(state.request), update: (args: Row) => plan("request", args) },
  community: { findUnique: async () => ({ type: state.request.community && (state.request.community as Row).type, status: "active", centerLatitude: 30.4, centerLongitude: -97.7 }) },
  communityMembership: { findMany: async () => [] },
  hoaRequestParticipation: { findMany: async () => [] },
  communityStaffAssignment: { findMany: async () => [], findFirst: async () => null },
  providerServiceArea: { findMany: async () => [{ centerLatitude: 30.4, centerLongitude: -97.7, radiusMiles: 5, postalCodes: [] }] },
  user: { findUnique: async () => ({ id: "provider", email: "provider@example.test", role: "provider", providerProfile: { trades: ["cleaning"], accountStatus: "active", licenseVerifiedAt: new Date(), insuranceVerifiedAt: new Date() } }) },
  serviceBid: {
    findUnique: async () => structuredClone({ ...state.bid, request: state.request }), findUniqueOrThrow: async () => structuredClone({ ...state.bid, request: { totalOccurrences: 2, _count: { participations: 1 } } }), findMany: async () => [],
    update: (args: Row) => plan("bid", args), updateMany: (args: Row) => plan("otherBids", args),
  },
  serviceAgreement: { findUnique: async () => state.agreement, create: (args: Row) => plan("agreement", args) },
  serviceOccurrence: { createMany: (args: Row) => plan("occurrences", args) },
  serviceVisit: { createMany: (args: Row) => plan("visits", args) },
  adminAuditLog: { create: (args: Row) => plan("audit", args) },
  $transaction: async (ops: Op[]) => {
    // Snapshot after any independently committed competing action, before this
    // batch executes. A losing claim rolls back only this batch's effects.
    const before = state.beforeWrite; state.beforeWrite = null; before?.();
    const saved = structuredClone({ bid: state.bid, request: state.request, agreement: state.agreement, effects: state.effects });
    try { return ops.map((op) => execute(op.model, op.args)); }
    catch (error) { Object.assign(state, saved); throw error; }
  },
} }));
vi.mock("@/lib/server/market-auth", () => ({ requireCommunityManager: async () => ({ via: "hoa_manager", communityName: "Oakwood" }), findNeighborhoodManager: async () => null }));
vi.mock("@/lib/server/notifications", () => ({ buildPreferenceAwareNotificationOps: async (intents: unknown[]) => intents.length ? [plan("notification", { data: {} })] : [] }));
import { awardBid, submitBid, withdrawBid } from "@/lib/server/hoa-market";
const input = { amountCents: 20000, pricingBasis: "total", perHomeCents: null, scope: "Updated whole job", exclusions: null, cadenceLabel: null, proposedStartDate: null, estimatedDurationLabel: null, validUntil: null } satisfies BidSubmitInput;
beforeEach(() => {
  state.bid = { id: "bid", requestId: "request", providerUserId: "provider", status: "submitted", version: 3, amountCents: 12345, pricingBasis: "total", perHomeCents: null, currency: "eur", proposedStartDate: null, validUntil: null, scope: "All homes", cadenceLabel: null, exclusions: null, estimatedDurationLabel: null, submittedAt: new Date(), provider: { fullName: "Provider", providerProfile: { companyName: "Company" } } };
  state.request = { id: "request", communityId: "community", title: "Cleaning", category: "cleaning", status: "bidding_closed", totalOccurrences: 2, recurrenceIntervalDays: null, startDate: null, biddingClosesAt: new Date(Date.now() + 86400000), community: { id: "community", type: "hoa", status: "active", name: "Oakwood" }, participations: [{ unitId: "unit", userId: null }], agreement: null };
  state.agreement = null; state.effects = []; state.claims = []; state.beforeWrite = null; state.failure = null; state.failModel = null;
});

describe("confirmed quote version validation", () => {
  it.each([awardSchema, neighborhoodAwardSchema])("accepts a positive version and retains omitted-version compatibility", (schema) => {
    expect(schema.parse({ bidId: "bid", expectedBidVersion: 3 })).toEqual({ bidId: "bid", expectedBidVersion: 3 });
    expect(schema.parse({ bidId: "bid" })).toEqual({ bidId: "bid" });
    for (const version of [0, -1, 1.5, "3", null]) expect(schema.safeParse({ bidId: "bid", expectedBidVersion: version }).success).toBe(false);
  });
  it("rejects a stale displayed version before any effect", async () => {
    await expect(awardBid("manager", "request", { bidId: "bid", expectedBidVersion: 2 })).rejects.toMatchObject({ status: 409 });
    expect(state.effects).toEqual([]); expect(state.claims).toEqual([]);
  });
  it("preserves same accepted-agreement idempotence even for a stale confirmation", async () => {
    state.request.agreement = { id: "accepted", bidId: "bid" }; state.request.status = "awarded";
    await expect(awardBid("manager", "request", { bidId: "bid", expectedBidVersion: 1 })).resolves.toBe("accepted"); expect(state.effects).toEqual([]);
  });
  it.each(["revision", "withdrawal"])("loses the award atomically if %s wins after the read", async (change) => {
    state.beforeWrite = () => { if (change === "revision") { state.bid.version = 4; state.bid.amountCents = 99999; } else state.bid.status = "withdrawn"; };
    await expect(awardBid("manager", "request", { bidId: "bid", expectedBidVersion: 3 })).rejects.toMatchObject({ status: 409 });
    expect(state.effects).toEqual([]); expect(state.agreement).toBeNull();
    expect(state.claims[0].where).toMatchObject({ id: "bid", version: 3, status: "submitted" });
  });
  it("returns an independently committed same-bid agreement after losing the claim", async () => {
    state.beforeWrite = () => { state.bid.status = "accepted"; state.agreement = { id: "racing-agreement", bidId: "bid" }; };
    await expect(awardBid("manager", "request", { bidId: "bid", expectedBidVersion: 3 })).resolves.toBe("racing-agreement"); expect(state.effects).toEqual([]);
  });
  it("does not mistake another bid's independently committed agreement for this confirmation", async () => {
    state.beforeWrite = () => { state.bid.status = "rejected"; state.agreement = { id: "other-agreement", bidId: "other-bid" }; };
    await expect(awardBid("manager", "request", { bidId: "bid", expectedBidVersion: 3 })).rejects.toMatchObject({ status: 409 }); expect(state.effects).toEqual([]);
  });
  it("rolls back a successful claim if creating the agreement fails", async () => {
    const failure = { code: "P2002", message: "Agreement conflict" }; state.failure = failure; state.failModel = "agreement";
    await expect(awardBid("manager", "request", { bidId: "bid", expectedBidVersion: 3 })).rejects.toMatchObject({ status: 409 });
    expect(state.bid.status).toBe("submitted"); expect(state.agreement).toBeNull(); expect(state.effects).toEqual([]);
  });
  it("claims the exact quote before creating its agreement, visits, audit or notifications", async () => {
    await awardBid("manager", "request", { bidId: "bid", expectedBidVersion: 3 });
    expect(state.effects[0]).toBe("bid"); expect(state.effects).toEqual(expect.arrayContaining(["agreement", "visits", "audit", "notification"]));
    expect(state.agreement).toMatchObject({ amountCents: 12345, currency: "eur", bidId: "bid" });
  });
});

describe("revision and withdrawal cannot overwrite a winning award", () => {
  function biddingOpen() { state.request.status = "open_for_bids"; (state.request.community as Row).type = "neighborhood"; }
  it.each(["revision", "withdrawal"])("a stale %s cannot overwrite accepted state", async (action) => {
    biddingOpen(); state.beforeWrite = () => { state.bid.status = "accepted"; state.request.status = "awarded"; };
    const operation = action === "revision" ? submitBid("provider", "request", input) : withdrawBid("provider", "request");
    await expect(operation).rejects.toMatchObject({ status: 409 }); expect(state.bid.status).toBe("accepted"); expect(state.effects).toEqual([]);
    expect(state.claims[0].where).toMatchObject({ id: "bid", version: 3, status: "submitted", request: { status: "open_for_bids" } });
  });
  it.each(["revision", "withdrawal"])("rechecks the deadline atomically for %s", async (action) => {
    biddingOpen(); state.beforeWrite = () => { state.request.biddingClosesAt = new Date(Date.now() - 1000); };
    await expect(action === "revision" ? submitBid("provider", "request", input) : withdrawBid("provider", "request")).rejects.toMatchObject({ status: 409 }); expect(state.effects).toEqual([]);
  });
  it.each(["award", "revision", "withdrawal"])("preserves unexpected database errors from %s", async (action) => {
    const failure = { code: "P1001", message: "Database unavailable" }; state.failure = failure;
    if (action !== "award") biddingOpen();
    await expect(action === "award" ? awardBid("manager", "request", { bidId: "bid", expectedBidVersion: 3 }) : action === "revision" ? submitBid("provider", "request", input) : withdrawBid("provider", "request")).rejects.toBe(failure);
    expect(state.effects).toEqual([]);
  });
});
