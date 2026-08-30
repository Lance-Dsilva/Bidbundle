import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Cross-community and cross-role isolation.
 *
 * Both workflows now share one request table, one bid table, one agreement,
 * and one visit. That is the whole point of the design — and also the whole
 * risk. These tests hold the line: an id from one community must not widen
 * access into another, and a role that can act in one workflow must not
 * inherit authority in the other.
 */

type Row = Record<string, unknown>;

const state = vi.hoisted(() => ({
  community: null as Row | null,
  request: null as Row | null,
  hoaManagerAssignment: null as Row | null,
  neighborhoodManagerAssignment: null as Row | null,
  membership: null as Row | null,
  participation: null as Row | null,
  bids: [] as Row[],
  actor: null as Row | null,
  adminGrant: null as Row | null,
  writes: [] as Row[],
}));

vi.mock("@/lib/server/db", () => ({
  db: {
    community: { findUnique: async () => state.community },
    communityStaffAssignment: {
      findFirst: async (args: { where?: { role?: unknown } }) => {
        const role = args?.where?.role;
        if (role === "hoa_manager") return state.hoaManagerAssignment;
        if (role === "neighborhood_manager") return state.neighborhoodManagerAssignment;
        return null;
      },
      findMany: async () => [],
    },
    communityMembership: { findFirst: async () => state.membership, findMany: async () => [] },
    adminAccessGrant: { findUnique: async () => state.adminGrant },
    user: { findUnique: async () => state.actor, findMany: async () => [] },
    hoaServiceRequest: {
      findUnique: async () => state.request,
      findFirst: async () => state.request,
      update: (args: Row) => {
        state.writes.push(args);
        return args;
      },
      updateMany: (args: Row) => {
        state.writes.push(args);
        return args;
      },
    },
    hoaRequestParticipation: {
      findFirst: async () => state.participation,
      findMany: async () => [],
      count: async () => 0,
      create: (args: Row) => {
        state.writes.push(args);
        return args;
      },
      update: (args: Row) => {
        state.writes.push(args);
        return args;
      },
    },
    serviceBid: { findMany: async () => state.bids, findUnique: async () => null },
    adminAuditLog: { create: (args: Row) => args },
    notification: { createMany: (args: Row) => args },
    outboxEvent: { createMany: (args: Row) => args },
    serviceAgreement: { findUnique: async () => null },
    serviceOccurrence: { count: async () => 0, findMany: async () => [] },
    serviceVisit: { findMany: async () => [] },
    hoaProfile: { findUnique: async () => null },
    providerProfile: { findMany: async () => [] },
    providerServiceArea: { findMany: async () => [] },
    homeownerProfile: { findMany: async () => [] },
    $transaction: async (ops: unknown[]) => ops,
  },
}));

import { HoaWorkflowError } from "@/lib/server/hoa";
import { listRequestBids } from "@/lib/server/hoa-market";
import {
  requireActiveNeighborhoodMember,
  requireCommunityManager,
} from "@/lib/server/market-auth";
import { respondToNeighborhoodRequest } from "@/lib/server/neighborhood-market";

const HOA = { id: "hoa-1", name: "Cedar Park HOA", type: "hoa", status: "active" };
const HOOD = { id: "hood-1", name: "Oakwood Heights", type: "neighborhood", status: "active" };

beforeEach(() => {
  state.community = { ...HOOD };
  state.request = null;
  state.hoaManagerAssignment = null;
  state.neighborhoodManagerAssignment = null;
  state.membership = null;
  state.participation = null;
  state.bids = [];
  state.actor = { id: "actor", email: "actor@example.com", role: "homeowner" };
  state.adminGrant = null;
  state.writes = [];
});

describe("HOA and neighbourhood authority do not cross", () => {
  it("an HOA manager cannot drive a neighbourhood request", async () => {
    state.community = { ...HOOD };
    // They genuinely manage an HOA — just not this community.
    state.hoaManagerAssignment = { id: "assignment-hoa" };
    state.neighborhoodManagerAssignment = null;

    await expect(requireCommunityManager("hoa-manager", "hood-1")).rejects.toBeInstanceOf(
      HoaWorkflowError,
    );
  });

  it("a neighbourhood manager cannot drive an HOA request", async () => {
    state.community = { ...HOA };
    state.neighborhoodManagerAssignment = {
      user: { id: "hood-manager", email: "m@example.com", fullName: "Casey" },
    };
    state.hoaManagerAssignment = null;

    await expect(requireCommunityManager("hood-manager", "hoa-1")).rejects.toMatchObject({
      status: 403,
    });
  });

  it("names the right authority in each refusal without naming the other", async () => {
    state.community = { ...HOA };
    await expect(requireCommunityManager("nobody", "hoa-1")).rejects.toThrow(/HOA/);

    state.community = { ...HOOD };
    await expect(requireCommunityManager("nobody", "hood-1")).rejects.toThrow(
      /neighbourhood/i,
    );
  });

  it("an archived community grants nobody manager authority", async () => {
    state.community = { ...HOOD, status: "archived" };
    state.neighborhoodManagerAssignment = {
      user: { id: "hood-manager", email: "m@example.com", fullName: "Casey" },
    };

    await expect(requireCommunityManager("hood-manager", "hood-1")).rejects.toBeInstanceOf(
      HoaWorkflowError,
    );
  });
});

describe("a request id from another community widens nothing", () => {
  it("refuses participation in a neighbourhood the caller does not live in", async () => {
    state.request = {
      id: "request-1",
      communityId: "hood-2",
      status: "collecting_interest",
      kind: "optional_group",
      maxHomes: null,
      createdByUserId: "someone",
      enrollmentClosesAt: new Date(Date.now() + 86_400_000),
      participantsLockedAt: null,
      community: { type: "neighborhood" },
      participations: [],
    };
    // No membership in hood-2.
    state.membership = null;

    await expect(
      respondToNeighborhoodRequest("outsider", "request-1", "joined"),
    ).rejects.toMatchObject({ status: 403 });
    expect(state.writes).toHaveLength(0);
  });

  it("refuses a homeowner participation route pointed at an HOA request", async () => {
    state.request = {
      id: "request-1",
      communityId: "hoa-1",
      status: "collecting_interest",
      kind: "optional_group",
      maxHomes: null,
      createdByUserId: "someone",
      enrollmentClosesAt: new Date(Date.now() + 86_400_000),
      participantsLockedAt: null,
      community: { type: "hoa" },
      participations: [],
    };

    await expect(
      respondToNeighborhoodRequest("resident", "request-1", "joined"),
    ).rejects.toMatchObject({ status: 404 });
    expect(state.writes).toHaveLength(0);
  });

  it("refuses neighbourhood membership checks against an HOA community", async () => {
    // `requireActiveNeighborhoodMember` filters on the community type itself,
    // so an HOA membership row cannot satisfy it.
    state.membership = null;
    await expect(
      requireActiveNeighborhoodMember("resident", "hoa-1"),
    ).rejects.toMatchObject({ status: 403 });
  });
});

describe("bid visibility", () => {
  const neighbourhoodRequest = {
    id: "request-1",
    communityId: "hood-1",
    createdByUserId: "resident-a",
    community: { type: "neighborhood" },
  };

  beforeEach(() => {
    state.request = { ...neighbourhoodRequest };
    state.bids = [];
  });

  it("shows quotes to the neighbour who joined", async () => {
    state.participation = { id: "participation-1" };
    await expect(listRequestBids("resident-b", "request-1")).resolves.toEqual([]);
  });

  it("shows quotes to the requester", async () => {
    state.participation = null;
    await expect(listRequestBids("resident-a", "request-1")).resolves.toEqual([]);
  });

  it("shows quotes to the assigned manager", async () => {
    state.participation = null;
    state.neighborhoodManagerAssignment = {
      user: { id: "hood-manager", email: "m@example.com", fullName: "Casey" },
    };
    await expect(listRequestBids("hood-manager", "request-1")).resolves.toEqual([]);
  });

  it("refuses a neighbour who declined or never answered", async () => {
    state.participation = null;
    await expect(listRequestBids("resident-c", "request-1")).rejects.toMatchObject({
      status: 403,
    });
  });

  it("refuses an outsider without confirming the request exists", async () => {
    state.participation = null;
    let message = "";
    try {
      await listRequestBids("stranger", "request-1");
    } catch (caught) {
      message = caught instanceof Error ? caught.message : String(caught);
    }
    expect(message).toBeTruthy();
    expect(message).not.toContain("Oakwood");
    expect(message).not.toContain("resident-a");
  });

  it("keeps the existing HOA rule: any active resident of that HOA may look", async () => {
    state.request = {
      id: "request-2",
      communityId: "hoa-1",
      createdByUserId: "manager",
      community: { type: "hoa" },
    };
    state.membership = { id: "membership-1" };

    await expect(listRequestBids("hoa-resident", "request-2")).resolves.toEqual([]);
  });

  it("refuses a non-resident on an HOA request", async () => {
    state.request = {
      id: "request-2",
      communityId: "hoa-1",
      createdByUserId: "manager",
      community: { type: "hoa" },
    };
    state.membership = null;
    state.hoaManagerAssignment = null;

    await expect(listRequestBids("stranger", "request-2")).rejects.toMatchObject({
      status: 403,
    });
  });
});
