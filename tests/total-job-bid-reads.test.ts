import { beforeEach, describe, expect, it, vi } from "vitest";
type Row = Record<string, unknown>;
const state = vi.hoisted(() => ({ rows: [] as Row[], queries: [] as Row[], managed: true }));
vi.mock("@/lib/server/db", () => ({ db: {
  communityStaffAssignment: { findMany: async () => state.managed ? [{ communityId: "hood" }] : [], findFirst: async () => null },
  hoaRequestParticipation: { findFirst: async () => null },
  hoaServiceRequest: { findUnique: async () => ({ id: "request", communityId: "hood", createdByUserId: "owner", community: { type: "neighborhood" } }) },
  serviceBid: { findMany: async (args: Row) => { state.queries.push(args); return state.rows; } },
} }));
import { listHomeownerBids } from "@/lib/server/marketplace-reads";
import { listRequestBids } from "@/lib/server/hoa-market";
function row(id: string, amountCents: number, pricingBasis = "total", currency = "usd"): Row {
  return { id, requestId: "request", providerUserId: "provider", status: "submitted", amountCents, currency, pricingBasis, perHomeCents: null, proposedStartDate: null, estimatedDurationLabel: null, scope: "Scope", exclusions: null, cadenceLabel: null, validUntil: null, version: 1, submittedAt: new Date(), provider: { fullName: "Provider", providerProfile: null }, request: { title: "Cleaning", status: "bidding_closed", category: "cleaning", communityId: "hood", totalOccurrences: 4, _count: { participations: 3 }, community: { name: "Oakwood" } } };
}
beforeEach(() => { state.rows = [row("legacy", 1, "per_visit"), row("high", 20000), row("low", 10001)]; state.queries = []; state.managed = true; });

describe("authorized actual quote serializers", () => {
  it("homeowner reads carry joined-home/round counts, sort totals first and never mark legacy awardable", async () => {
    const bids = await listHomeownerBids("owner");
    expect(bids.map((bid) => bid.id)).toEqual(["low", "high", "legacy"]);
    expect(bids[0]).toMatchObject({ homeCount: 3, totalOccurrences: 4, canAward: true, amountCents: 10001 });
    expect(bids[2]).toMatchObject({ amountCents: 1, pricingBasis: "per_visit", canAward: false });
    expect(state.queries[0]).toMatchObject({ where: { request: { community: { type: "neighborhood" }, OR: [{ createdByUserId: "owner" }, { participations: { some: { userId: "owner", response: "joined" } } }] } }, include: { request: { select: { _count: { select: { participations: { where: { response: "joined" } } } }, totalOccurrences: true } } } });
    expect(JSON.stringify(bids)).not.toContain("latitude"); expect(JSON.stringify(bids)).not.toContain("address");
  });
  it("ordinary participants cannot gain award authority from a total quote", async () => {
    state.managed = false;
    expect((await listHomeownerBids("participant")).every((bid) => !bid.canAward)).toBe(true);
  });
  it("request comparison reads serialize counts and rank totals without changing historical unit data", async () => {
    const bids = await listRequestBids("owner", "request");
    expect(bids.map((bid) => bid.id)).toEqual(["low", "high", "legacy"]);
    expect(bids[0]).toMatchObject({ homeCount: 3, totalOccurrences: 4 });
    expect(bids[2]).toMatchObject({ amountCents: 1, pricingBasis: "per_visit" });
    expect(state.queries[0]).toMatchObject({ where: { requestId: "request" }, include: { request: { select: { totalOccurrences: true, _count: { select: { participations: { where: { response: "joined" } } } } } } } });
  });
  it("retains request authorization before exposing quotes", async () => {
    await expect(listRequestBids("outsider", "request")).rejects.toMatchObject({ status: 403 }); expect(state.queries).toEqual([]);
  });
});
