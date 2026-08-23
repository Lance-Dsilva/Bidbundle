import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tool-level coverage: input validation, empty-data handling, redaction, and
 * role isolation for the AI assistant's predefined business-query tools.
 */

type Bid = {
  id: string;
  requestId: string;
  providerUserId: string;
  providerName: string;
  status: string;
  amountCents: number;
  currency: string;
  pricingBasis: string;
  submittedAt: Date;
};

const state = vi.hoisted(() => ({
  communities: {} as Record<string, { id: string; name: string }>,
  staffAssignments: [] as Array<{ userId: string; communityId: string; role: string; status: string }>,
  memberships: [] as Array<{ userId: string; communityId: string; status: string; unitId: string | null }>,
  units: [] as Array<{ id: string; communityId: string }>,
  requests: [] as Array<{ id: string; communityId: string; title: string; category: string; kind: string; status: string; biddingClosesAt: Date | null; startDate: Date | null; createdAt: Date }>,
  bids: [] as Bid[],
}));

vi.mock("@/lib/server/db", () => ({
  db: {
    community: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        state.communities[where.id] ? { id: where.id, name: state.communities[where.id].name } : null,
    },
    communityStaffAssignment: {
      findFirst: async ({
        where,
      }: {
        where: { userId: string; communityId: string; role: string; status: string };
      }) => {
        const match = state.staffAssignments.find(
          (a) =>
            a.userId === where.userId &&
            a.communityId === where.communityId &&
            a.role === where.role &&
            a.status === where.status,
        );
        return match
          ? { id: "assignment-1", community: { id: where.communityId, name: state.communities[where.communityId]?.name ?? "" } }
          : null;
      },
    },
    communityMembership: {
      findFirst: async ({
        where,
      }: {
        where: { userId: string; communityId: string; status: string };
      }) => {
        const match = state.memberships.find(
          (m) => m.userId === where.userId && m.communityId === where.communityId && m.status === where.status,
        );
        return match ? { id: "membership-1", unitId: match.unitId } : null;
      },
      findMany: async ({ where }: { where: { userId: string; communityId: string; status: string } }) =>
        state.memberships
          .filter((m) => m.userId === where.userId && m.communityId === where.communityId && m.status === "active")
          .map((m) => ({ unitId: m.unitId })),
      count: async ({ where }: { where: { communityId: string; status: string } }) =>
        state.memberships.filter((m) => m.communityId === where.communityId && m.status === where.status).length,
    },
    communityUnit: {
      count: async ({ where }: { where: { communityId: string } }) =>
        state.units.filter((u) => u.communityId === where.communityId).length,
    },
    hoaServiceRequest: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        const request = state.requests.find((r) => r.id === where.id);
        return request ? { id: request.id, title: request.title, communityId: request.communityId } : null;
      },
      findMany: async ({
        where,
        take,
      }: {
        where: { communityId: string; status?: string };
        take: number;
      }) =>
        state.requests
          .filter((r) => r.communityId === where.communityId && (!where.status || r.status === where.status))
          .slice(0, take),
      groupBy: async ({ where }: { where: { communityId: string } }) => {
        const counts = new Map<string, number>();
        for (const r of state.requests.filter((req) => req.communityId === where.communityId)) {
          counts.set(r.status, (counts.get(r.status) ?? 0) + 1);
        }
        return Array.from(counts, ([status, count]) => ({ status, _count: { _all: count } }));
      },
    },
    serviceBid: {
      findUnique: async ({
        where,
      }: {
        where: { requestId_providerUserId: { requestId: string; providerUserId: string } };
      }) => {
        const key = where.requestId_providerUserId;
        return (
          state.bids.find((b) => b.requestId === key.requestId && b.providerUserId === key.providerUserId) ?? null
        );
      },
      findMany: async ({ where }: { where: { requestId: string; status: { in: string[] } } }) =>
        state.bids
          .filter((b) => b.requestId === where.requestId && where.status.in.includes(b.status))
          .map((b) => ({ ...b, provider: { fullName: b.providerName } })),
    },
  },
}));

const { runTool } = await import("@/lib/server/ai/tools");
const { AiToolError } = await import("@/lib/server/ai/errors");

const admin = { userId: "admin-1", role: "admin" as const, isAdmin: true };
const homeowner = { userId: "res-1", role: "homeowner" as const, isAdmin: false };
const provider = { userId: "prov-1", role: "provider" as const, isAdmin: false };

beforeEach(() => {
  state.communities = { "community-1": { id: "community-1", name: "Maple Ridge HOA" } };
  state.staffAssignments = [];
  state.memberships = [{ userId: "res-1", communityId: "community-1", status: "active", unitId: "unit-1" }];
  state.units = [{ id: "unit-1", communityId: "community-1" }];
  state.requests = [];
  state.bids = [];
});

afterEach(() => vi.clearAllMocks());

describe("runTool input validation", () => {
  it("rejects an unknown tool name before touching any data", async () => {
    await expect(runTool("delete_everything", admin, "{}")).rejects.toThrow(AiToolError);
  });

  it("rejects malformed JSON arguments", async () => {
    await expect(runTool("get_hoa_overview", admin, "{not json")).rejects.toThrow(AiToolError);
  });

  it("rejects a call missing a required field", async () => {
    await expect(runTool("get_hoa_overview", admin, "{}")).rejects.toThrow(AiToolError);
  });

  it("rejects an out-of-range limit for get_service_requests", async () => {
    await expect(
      runTool("get_service_requests", admin, JSON.stringify({ communityId: "community-1", limit: 999 })),
    ).rejects.toThrow(AiToolError);
  });
});

describe("get_hoa_overview", () => {
  it("returns zeroed counts, not an error, for a community with no requests", async () => {
    const result = await runTool("get_hoa_overview", admin, JSON.stringify({ communityId: "community-1" }));
    const data = result.data as { unitCount: number; activeMemberCount: number; requestsByStatus: Record<string, number> };
    expect(data.unitCount).toBe(1);
    expect(data.activeMemberCount).toBe(1);
    expect(data.requestsByStatus).toEqual({});
  });

  it("never includes address, access-note, or Clerk-id fields", async () => {
    const result = await runTool("get_hoa_overview", admin, JSON.stringify({ communityId: "community-1" }));
    const serialized = JSON.stringify(result.data);
    for (const forbidden of ["addressLine1", "accessNotes", "clerkUserId", "latitude", "longitude"]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("gives an HOA manager (a homeowner-role account with an active hoa_manager assignment) a grounded answer for the community they manage", async () => {
    state.memberships = [];
    state.staffAssignments = [{ userId: "mgr-1", communityId: "community-1", role: "hoa_manager", status: "active" }];
    state.requests = [
      {
        id: "req-1",
        communityId: "community-1",
        title: "Lawn care",
        category: "landscaping",
        kind: "compulsory_recurring",
        status: "open_for_bids",
        biddingClosesAt: null,
        startDate: null,
        createdAt: new Date(),
      },
    ];
    const manager = { userId: "mgr-1", role: "homeowner" as const, isAdmin: false };
    const result = await runTool("get_hoa_overview", manager, JSON.stringify({ communityId: "community-1" }));
    const data = result.data as { name: string; requestsByStatus: Record<string, number> };
    expect(data.name).toBe("Maple Ridge HOA");
    expect(data.requestsByStatus.open_for_bids).toBe(1);
  });

  it("blocks a homeowner who is not a member of the community", async () => {
    state.memberships = [];
    await expect(
      runTool("get_hoa_overview", homeowner, JSON.stringify({ communityId: "community-1" })),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("blocks a provider outright", async () => {
    await expect(
      runTool("get_hoa_overview", provider, JSON.stringify({ communityId: "community-1" })),
    ).rejects.toMatchObject({ status: 403 });
  });
});

describe("get_request_bids — role isolation", () => {
  beforeEach(() => {
    state.requests = [
      {
        id: "req-1",
        communityId: "community-1",
        title: "Lawn care",
        category: "landscaping",
        kind: "compulsory_recurring",
        status: "open_for_bids",
        biddingClosesAt: null,
        startDate: null,
        createdAt: new Date(),
      },
    ];
    state.bids = [
      {
        id: "bid-1",
        requestId: "req-1",
        providerUserId: "prov-1",
        providerName: "Acme Lawn",
        status: "submitted",
        amountCents: 10_000,
        currency: "usd",
        pricingBasis: "total",
        submittedAt: new Date(),
      },
      {
        id: "bid-2",
        requestId: "req-1",
        providerUserId: "prov-2",
        providerName: "Rival Lawn Co",
        status: "submitted",
        amountCents: 8_000,
        currency: "usd",
        pricingBasis: "total",
        submittedAt: new Date(),
      },
    ];
  });

  it("shows the resident the full bid list", async () => {
    const result = await runTool("get_request_bids", homeowner, JSON.stringify({ requestId: "req-1" }));
    const data = result.data as { bids: Array<{ providerName: string }> };
    expect(data.bids).toHaveLength(2);
  });

  it("shows a provider only their own bid, never a competitor's amount", async () => {
    const result = await runTool("get_request_bids", provider, JSON.stringify({ requestId: "req-1" }));
    const data = result.data as { bids: Array<{ amountCents: number; mine: boolean }> };
    expect(data.bids).toHaveLength(1);
    expect(data.bids[0].amountCents).toBe(10_000);
    const serialized = JSON.stringify(result.data);
    expect(serialized).not.toContain("Rival Lawn Co");
    expect(serialized).not.toContain("8000");
  });

  it("403s a provider with no bid on the request rather than leaking any bid data", async () => {
    await expect(
      runTool("get_request_bids", { userId: "prov-3", role: "provider", isAdmin: false }, JSON.stringify({ requestId: "req-1" })),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("404s for a request that does not exist", async () => {
    await expect(
      runTool("get_request_bids", admin, JSON.stringify({ requestId: "missing" })),
    ).rejects.toMatchObject({ status: 404 });
  });
});
