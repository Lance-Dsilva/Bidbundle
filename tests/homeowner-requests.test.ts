import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createHomeownerRequestSchema,
  MAX_BUDGET_CENTS,
} from "@/lib/validation/homeowner-requests";

/**
 * Behavioural tests for individual (non-HOA) homeowner requests.
 *
 * The product rule under test: an HOA resident's services are procured by their
 * HOA manager, so an individual request is only ever opened by a homeowner in a
 * `neighborhood` community. Every other combination has to come back as a clear
 * 4xx product state — never a 404, never a generic 500, and never a form that
 * can only fail.
 */

type Op = { model: string; action: string; args: unknown };

const state = vi.hoisted(() => ({
  built: [] as Op[],
  batches: [] as Op[][],
  memberships: [] as {
    status: string;
    community: { id: string; name: string; type: string; status: string };
  }[],
  profile: { address: null as string | null, latitude: null as number | null, longitude: null as number | null },
  duplicate: null as { id: string } | null,
  /** Active neighbours who should be told a new request opened. */
  neighbours: [] as { user: { id: string; email: string } }[],
}));

const createdRow = {
  id: "request-1",
  title: "Pressure washing",
  category: "cleaning",
  description: "Driveway and back patio.",
  budgetMinCents: 10_000,
  budgetMaxCents: 30_000,
  status: "collecting_interest",
  enrollmentClosesAt: new Date("2026-08-30T00:00:00.000Z"),
  createdAt: new Date("2026-08-27T00:00:00.000Z"),
  updatedAt: new Date("2026-08-27T00:00:00.000Z"),
  community: { id: "community-1", name: "Oakwood Heights", type: "neighborhood" },
  _count: { bids: 0 },
  bids: [] as { amountCents: number }[],
};

const db = vi.hoisted(() => ({
  communityMembership: {
    // Two callers, two shapes: eligibility reads memberships-with-community,
    // the neighbour notification pass reads memberships-with-user. The mock
    // answers whichever one the caller asked for.
    findMany: async (args?: { select?: Record<string, unknown> }) =>
      args?.select && "user" in args.select ? state.neighbours : state.memberships,
  },
  hoaRequestParticipation: {
    create: (args: unknown) => {
      const entry = { model: "hoaRequestParticipation", action: "create", args };
      state.built.push(entry);
      return entry;
    },
  },
  adminAuditLog: {
    create: (args: unknown) => {
      const entry = { model: "adminAuditLog", action: "create", args };
      state.built.push(entry);
      return entry;
    },
  },
  homeownerProfile: { findMany: async () => [] },
  notification: {
    count: async () => 2,
    createMany: (args: unknown) => {
      const entry = { model: "notification", action: "createMany", args };
      state.built.push(entry);
      return entry;
    },
  },
  outboxEvent: {
    createMany: (args: unknown) => {
      const entry = { model: "outboxEvent", action: "createMany", args };
      state.built.push(entry);
      return entry;
    },
  },
  user: {
    findUnique: async () => state.profile,
  },
  hoaServiceRequest: {
    findFirst: async (args: { where: Record<string, unknown> }) => {
      // The duplicate probe filters on `createdAt`; the read-back does not.
      if (args.where.createdAt) return state.duplicate;
      return createdRow;
    },
    findMany: async () => [createdRow],
    create: (args: unknown) => {
      const record = { model: "hoaServiceRequest", action: "create", args };
      state.built.push(record);
      return record;
    },
    count: async () => 1,
  },
  serviceBid: { count: async () => 0 },
  $transaction: async (ops: Op[]) => {
    state.batches.push(ops);
    return ops.map(() => ({ count: 1 }));
  },
}));

vi.mock("@/lib/server/db", () => ({ db }));

const homeowner = { id: "user-1", role: "homeowner" };

function neighborhoodMember(status = "active") {
  return {
    status,
    community: {
      id: "community-1",
      name: "Oakwood Heights",
      type: "neighborhood",
      status: "active",
    },
  };
}

function hoaMember(status = "active") {
  return {
    status,
    community: { id: "hoa-1", name: "Cedar Bend HOA", type: "hoa", status: "active" },
  };
}

const validInput = {
  title: "Pressure washing",
  category: "cleaning" as const,
  description: "Driveway and back patio.",
  budgetMinCents: 10_000,
  budgetMaxCents: 30_000,
};

beforeEach(() => {
  state.built = [];
  state.batches = [];
  state.memberships = [neighborhoodMember()];
  state.profile = { address: null, latitude: null, longitude: null };
  state.duplicate = null;
  state.neighbours = [];
});

describe("eligibility", () => {
  it("allows a homeowner with an active neighbourhood membership", async () => {
    const { getRequestEligibility } = await import("@/lib/server/homeowner-requests");
    const eligibility = await getRequestEligibility(homeowner);

    expect(eligibility).toMatchObject({
      canCreate: true,
      communityId: "community-1",
      communityName: "Oakwood Heights",
    });
  });

  it("sends an HOA resident to their manager rather than to a form", async () => {
    state.memberships = [hoaMember()];
    const { getRequestEligibility } = await import("@/lib/server/homeowner-requests");
    const eligibility = await getRequestEligibility(homeowner);

    expect(eligibility.canCreate).toBe(false);
    if (eligibility.canCreate) return;
    expect(eligibility.reason).toBe("hoa_resident");
    expect(eligibility.actionPath).toBe("/app/homeowner/community");
    expect(eligibility.message).toMatch(/HOA manager/i);
  });

  it("treats HOA residency as decisive even alongside a neighbourhood row", async () => {
    state.memberships = [neighborhoodMember(), hoaMember()];
    const { getRequestEligibility } = await import("@/lib/server/homeowner-requests");
    const eligibility = await getRequestEligibility(homeowner);

    expect(eligibility).toMatchObject({ canCreate: false, reason: "hoa_resident" });
  });

  it("explains a pending neighbourhood membership", async () => {
    state.memberships = [neighborhoodMember("pending")];
    const { getRequestEligibility } = await import("@/lib/server/homeowner-requests");
    const eligibility = await getRequestEligibility(homeowner);

    expect(eligibility).toMatchObject({ canCreate: false, reason: "membership_pending" });
  });

  it("asks for an address when the profile has no location", async () => {
    state.memberships = [];
    const { getRequestEligibility } = await import("@/lib/server/homeowner-requests");
    const eligibility = await getRequestEligibility(homeowner);

    expect(eligibility.canCreate).toBe(false);
    if (eligibility.canCreate) return;
    expect(eligibility.reason).toBe("no_profile_location");
    expect(eligibility.actionPath).toBe("/app/homeowner/profile");
  });

  it("distinguishes 'no neighbourhood yet' from 'no address'", async () => {
    state.memberships = [];
    state.profile = { address: "1 Oak St", latitude: 30.1, longitude: -97.8 };
    const { getRequestEligibility } = await import("@/lib/server/homeowner-requests");
    const eligibility = await getRequestEligibility(homeowner);

    expect(eligibility).toMatchObject({ canCreate: false, reason: "no_community" });
  });

  it("refuses a provider account", async () => {
    const { getRequestEligibility } = await import("@/lib/server/homeowner-requests");
    const eligibility = await getRequestEligibility({ id: "p-1", role: "provider" });

    expect(eligibility).toMatchObject({ canCreate: false, reason: "wrong_role" });
  });

  it("ignores memberships of archived communities", async () => {
    state.memberships = [
      {
        status: "active",
        community: {
          id: "community-1",
          name: "Oakwood Heights",
          type: "neighborhood",
          status: "archived",
        },
      },
    ];
    const { getRequestEligibility } = await import("@/lib/server/homeowner-requests");
    const eligibility = await getRequestEligibility(homeowner);

    expect(eligibility.canCreate).toBe(false);
  });
});

describe("createHomeownerRequest", () => {
  it("persists a normalized non-HOA request owned by the session user", async () => {
    const { createHomeownerRequest } = await import("@/lib/server/homeowner-requests");
    const created = await createHomeownerRequest(homeowner, validInput);

    expect(state.batches).toHaveLength(1);
    const data = (state.batches[0]![0]!.args as { data: Record<string, unknown> }).data;

    expect(data.createdByUserId).toBe("user-1");
    expect(data.communityId).toBe("community-1");
    expect(data.title).toBe("Pressure washing");
    expect(data.category).toBe("cleaning");
    expect(data.budgetMinCents).toBe(10_000);
    expect(data.budgetMaxCents).toBe(30_000);
    // Product rule in code: an individual request is never compulsory
    // recurring, and never a client-chosen status.
    expect(data.kind).toBe("optional_group");
    expect(data.status).toBe("collecting_interest");
    expect(data.recurrenceIntervalDays).toBeNull();
    expect(data.totalOccurrences).toBe(1);

    expect(created.context).toBe("neighborhood");
    expect(created.communityName).toBe("Oakwood Heights");
  });

  it("joins the requester automatically, in the same commit as the request", async () => {
    const { createHomeownerRequest } = await import("@/lib/server/homeowner-requests");
    await createHomeownerRequest(homeowner, validInput);

    const batch = state.batches[0]!;
    const participation = batch.find(
      (entry) => entry.model === "hoaRequestParticipation" && entry.action === "create",
    );
    expect(participation).toBeDefined();

    const data = (participation!.args as { data: Record<string, unknown> }).data;
    expect(data.userId).toBe("user-1");
    // A neighbourhood participation targets the homeowner, never an HOA unit.
    expect(data.unitId).toBeNull();
    expect(data.response).toBe("joined");
  });

  it("permits a single home: the default floor is one, not two", async () => {
    const { createHomeownerRequest } = await import("@/lib/server/homeowner-requests");
    await createHomeownerRequest(homeowner, validInput);

    const data = (state.batches[0]![0]!.args as { data: Record<string, unknown> }).data;
    expect(data.minHomes).toBe(1);
  });

  it("tells the neighbours without naming the requester's address", async () => {
    state.neighbours = [
      { user: { id: "neighbour-1", email: "one@example.com" } },
      { user: { id: "neighbour-2", email: "two@example.com" } },
    ];
    const { createHomeownerRequest } = await import("@/lib/server/homeowner-requests");
    await createHomeownerRequest(homeowner, validInput);

    const notifications = state.batches[0]!.find(
      (entry) => entry.model === "notification" && entry.action === "createMany",
    );
    expect(notifications).toBeDefined();

    const rows = (notifications!.args as { data: Array<Record<string, string>> }).data;
    expect(rows.map((row) => row.userId).sort()).toEqual(["neighbour-1", "neighbour-2"]);
    // The requester's street address must not travel with the invitation.
    const text = JSON.stringify(rows);
    expect(text).not.toContain("Cedar");
    expect(text).not.toContain("Lane");
  });

  it("refuses an HOA resident with a 409 product state and writes nothing", async () => {
    state.memberships = [hoaMember()];
    const { createHomeownerRequest, HomeownerRequestError } = await import(
      "@/lib/server/homeowner-requests"
    );

    await expect(createHomeownerRequest(homeowner, validInput)).rejects.toBeInstanceOf(
      HomeownerRequestError,
    );
    await expect(createHomeownerRequest(homeowner, validInput)).rejects.toMatchObject({
      status: 409,
      reason: "hoa_resident",
    });
    expect(state.batches).toHaveLength(0);
  });

  it("refuses a provider with a 403 and writes nothing", async () => {
    const { createHomeownerRequest } = await import("@/lib/server/homeowner-requests");

    await expect(
      createHomeownerRequest({ id: "p-1", role: "provider" }, validInput),
    ).rejects.toMatchObject({ status: 403, reason: "wrong_role" });
    expect(state.batches).toHaveLength(0);
  });

  it("refuses a pending membership with a 409 and writes nothing", async () => {
    state.memberships = [neighborhoodMember("pending")];
    const { createHomeownerRequest } = await import("@/lib/server/homeowner-requests");

    await expect(createHomeownerRequest(homeowner, validInput)).rejects.toMatchObject({
      status: 409,
      reason: "membership_pending",
    });
    expect(state.batches).toHaveLength(0);
  });

  it("returns the original request for a rapid duplicate submission", async () => {
    state.duplicate = { id: "request-1" };
    const { createHomeownerRequest } = await import("@/lib/server/homeowner-requests");

    const created = await createHomeownerRequest(homeowner, validInput);

    expect(created.id).toBe("request-1");
    expect(state.batches).toHaveLength(0);
  });
});

describe("my requests", () => {
  it("returns the created request scoped to its owner", async () => {
    const { listHomeownerRequests } = await import("@/lib/server/homeowner-requests");
    const requests = await listHomeownerRequests("user-1");

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      id: "request-1",
      title: "Pressure washing",
      categoryLabel: "Cleaning",
      context: "neighborhood",
      budgetMinCents: 10_000,
      budgetMaxCents: 30_000,
    });
  });
});

describe("dashboard counters", () => {
  it("reports real aggregates rather than placeholders", async () => {
    const { getHomeownerDashboard } = await import("@/lib/server/homeowner-requests");
    const summary = await getHomeownerDashboard("user-1");

    expect(summary.cold_start).toBe(false);
    expect(summary.active_requests).toBe(1);
    expect(summary.unread_messages).toBe(2);
    expect(summary.total_saved_cents).toBe(0);
  });
});

describe("request validation", () => {
  it("accepts a well-formed submission", () => {
    expect(createHomeownerRequestSchema.safeParse(validInput).success).toBe(true);
  });

  it("rejects an empty title and an empty description", () => {
    const parsed = createHomeownerRequestSchema.safeParse({
      ...validInput,
      title: "   ",
      description: "\n\n",
    });
    expect(parsed.success).toBe(false);
    const paths = parsed.success ? [] : parsed.error.issues.map((issue) => issue.path[0]);
    expect(paths).toContain("title");
    expect(paths).toContain("description");
  });

  it("rejects an unsupported category", () => {
    expect(
      createHomeownerRequestSchema.safeParse({ ...validInput, category: "rocketry" })
        .success,
    ).toBe(false);
  });

  it("rejects a maximum below the minimum", () => {
    const parsed = createHomeownerRequestSchema.safeParse({
      ...validInput,
      budgetMinCents: 30_000,
      budgetMaxCents: 10_000,
    });
    expect(parsed.success).toBe(false);
    expect(parsed.success ? "" : parsed.error.issues[0]!.path[0]).toBe("budgetMaxCents");
  });

  it.each([
    ["negative", -1],
    ["fractional", 100.5],
    ["not a number", Number.NaN],
    ["infinite", Number.POSITIVE_INFINITY],
    ["beyond the ceiling", MAX_BUDGET_CENTS + 1],
  ])("rejects a %s budget", (_label, budgetMinCents) => {
    expect(
      createHomeownerRequestSchema.safeParse({ ...validInput, budgetMinCents }).success,
    ).toBe(false);
  });

  it("refuses a client-supplied owner, community, or status", () => {
    for (const extra of [
      { createdByUserId: "someone-else" },
      { communityId: "another-community" },
      { status: "draft" },
      { kind: "compulsory_recurring" },
    ]) {
      expect(
        createHomeownerRequestSchema.safeParse({ ...validInput, ...extra }).success,
      ).toBe(false);
    }
  });
});
