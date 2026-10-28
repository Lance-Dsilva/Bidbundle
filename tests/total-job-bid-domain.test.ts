import { beforeEach, describe, expect, it, vi } from "vitest";
import { bidSubmitSchema, MAX_BID_AMOUNT_CENTS, type BidSubmitInput } from "@/lib/validation/hoa";
type Row = Record<string, unknown>;
const state = vi.hoisted(() => ({ provider: null as Row | null, request: null as Row | null, areas: [] as Row[], existing: null as Row | null, written: [] as Row[], batches: 0 }));
function op(action: string, args: Row) { return { action, args }; }
vi.mock("@/lib/server/db", () => ({ db: {
  user: { findUnique: async () => state.provider },
  hoaServiceRequest: { findUnique: async () => state.request },
  community: { findUnique: async () => ({ type: "neighborhood", centerLatitude: 30.4, centerLongitude: -97.7 }) },
  providerServiceArea: { findMany: async () => state.areas },
  communityStaffAssignment: { findFirst: async () => null, findMany: async () => [] },
  hoaRequestParticipation: { findMany: async () => [] },
  serviceBid: {
    findUnique: async () => state.existing,
    create: (args: Row) => op("create", args), update: (args: Row) => op("update", args),
    findUniqueOrThrow: async () => ({ id: "bid-1", requestId: "request-1", providerUserId: "provider-1", ...state.written[0], version: 1, submittedAt: new Date(), provider: { fullName: "Provider", providerProfile: { companyName: "Company", licenseVerifiedAt: new Date(), insuranceVerifiedAt: new Date() } }, currency: "usd", request: { totalOccurrences: state.request!.totalOccurrences, _count: { participations: (state.request!.participations as unknown[]).length } } }),
  },
  $transaction: async (ops: { args: Row }[]) => { state.batches++; state.written.push(...ops.map((entry) => entry.args.data as Row)); return []; },
} }));
vi.mock("@/lib/server/notifications", () => ({ buildPreferenceAwareNotificationOps: async () => [] }));
import { submitBid } from "@/lib/server/hoa-market";
const input = { amountCents: 10001, pricingBasis: "total", perHomeCents: null, scope: "Complete the whole job", proposedStartDate: null, estimatedDurationLabel: null, exclusions: null, cadenceLabel: null, validUntil: null } satisfies BidSubmitInput;
beforeEach(() => {
  state.provider = { role: "provider", providerProfile: { trades: ["cleaning"], accountStatus: "active", licenseVerifiedAt: new Date(), insuranceVerifiedAt: new Date() } };
  state.request = { id: "request-1", communityId: "hood-1", title: "Cleaning", category: "cleaning", status: "open_for_bids", biddingClosesAt: new Date(Date.now() + 86400000), totalOccurrences: 4, participations: [{ id: "p1" }, { id: "p2" }, { id: "p3" }], community: { type: "neighborhood", status: "active", name: "Oakwood" } };
  state.areas = [{ centerLatitude: 30.4, centerLongitude: -97.7, radiusMiles: 10, postalCodes: [] }]; state.existing = null; state.written = []; state.batches = 0;
});

describe("new bid input contract", () => {
  it.each([0, 10001, MAX_BID_AMOUNT_CENTS])("accepts whole total cents %s", (amountCents) => { expect(bidSubmitSchema.safeParse({ ...input, amountCents }).success).toBe(true); });
  it.each(["per_home", "per_visit"])("rejects unit pricing %s at validation", (pricingBasis) => { expect(bidSubmitSchema.safeParse({ ...input, pricingBasis }).success).toBe(false); });
  it.each([-1, 1.5, Number.NaN, Infinity, MAX_BID_AMOUNT_CENTS + 1])("rejects invalid total %s", (amountCents) => { expect(bidSubmitSchema.safeParse({ ...input, amountCents }).success).toBe(false); });
  it("rejects client-authored per-home amounts", () => { expect(bidSubmitSchema.safeParse({ ...input, perHomeCents: 1 }).success).toBe(false); });
});

describe("provider bid domain contract", () => {
  it("revises an existing legacy quote only from a newly supplied total and increments its version", async () => {
    state.existing = { id: "legacy-bid", status: "submitted", version: 3, pricingBasis: "per_home", amountCents: 20 };
    await submitBid("provider-1", "request-1", input);
    expect(state.written[0]).toMatchObject({ amountCents: 10001, pricingBasis: "total", perHomeCents: null, version: { increment: 1 } });
  });
  it("does not reopen closed bidding to revise a legacy quote", async () => {
    state.existing = { id: "legacy-bid", status: "submitted", version: 3, pricingBasis: "per_visit", amountCents: 20 };
    state.request!.status = "bidding_closed";
    await expect(submitBid("provider-1", "request-1", input)).rejects.toThrow(/not open/);
    expect(state.written).toEqual([]);
  });
  it("persists canonical total/null and serializes actual joined homes and visit rounds", async () => {
    const result = await submitBid("provider-1", "request-1", input);
    expect(state.written[0]).toMatchObject({ amountCents: 10001, pricingBasis: "total", perHomeCents: null });
    expect(result).toMatchObject({ amountCents: 10001, pricingBasis: "total", homeCount: 3, totalOccurrences: 4 });
    expect(state.batches).toBe(1);
  });
  it.each(["per_home", "per_visit"])("rejects bypassed schema unit input %s before writes", async (pricingBasis) => {
    await expect(submitBid("provider-1", "request-1", { ...input, pricingBasis } as BidSubmitInput)).rejects.toMatchObject({ status: 400 }); expect(state.written).toEqual([]);
  });
  it("rejects a bypassed per-home amount", async () => { await expect(submitBid("provider-1", "request-1", { ...input, perHomeCents: 20 } as unknown as BidSubmitInput)).rejects.toMatchObject({ status: 400 }); expect(state.written).toEqual([]); });
  it.each(["wrong-role", "unlicensed", "uninsured", "suspended", "trade", "coverage", "deadline", "closed", "validity"])("preserves %s guard with canonical input", async (condition) => {
    const profile = state.provider!.providerProfile as Row;
    if (condition === "wrong-role") state.provider!.role = "homeowner";
    if (condition === "unlicensed") profile.licenseVerifiedAt = null;
    if (condition === "uninsured") profile.insuranceVerifiedAt = null;
    if (condition === "suspended") profile.accountStatus = "suspended";
    if (condition === "trade") profile.trades = ["plumbing"];
    if (condition === "coverage") state.areas = [];
    if (condition === "deadline") state.request!.biddingClosesAt = new Date(Date.now() - 1);
    if (condition === "closed") state.request!.status = "bidding_closed";
    await expect(submitBid("provider-1", "request-1", { ...input, validUntil: condition === "validity" ? new Date(Date.now() - 1).toISOString() : null })).rejects.toBeDefined();
    expect(state.written).toEqual([]);
  });
});
