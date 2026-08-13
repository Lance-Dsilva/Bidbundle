import { beforeEach, describe, expect, it, vi } from "vitest";

import { CommunityRuleError } from "@/lib/community-rules";

/**
 * Service-layer tests with a scripted database.
 *
 * These assert the two behaviours that cannot be read off the pure rule
 * functions: what is written, and that it goes out as *one* transaction.
 * `$transaction` records the batch it was handed, so a test can check that a
 * revoke, a create, and both audit entries travelled together rather than as
 * separate calls that could half-apply.
 */

type Op = { model: string; action: string; args: Record<string, unknown> };

const state = vi.hoisted(() => ({
  community: null as Record<string, unknown> | null,
  user: null as Record<string, unknown> | null,
  membership: null as Record<string, unknown> | null,
  activeAssignmentForUser: null as Record<string, unknown> | null,
  incumbentManager: null as Record<string, unknown> | null,
  assignmentById: null as Record<string, unknown> | null,
  memberAssignments: [] as Array<Record<string, unknown>>,
  neighborhoodCandidates: [] as Array<Record<string, unknown>>,
  created: [] as Array<Record<string, unknown>>,
  batches: [] as Op[][],
}));

function op(model: string, action: string) {
  return (args: Record<string, unknown>): Op => ({ model, action, args });
}

vi.mock("@/lib/server/db", () => ({
  db: {
    community: {
      findUnique: async () => state.community,
      findMany: async () => state.neighborhoodCandidates,
      update: op("community", "update"),
      create: op("community", "create"),
    },
    user: {
      findUnique: async () => state.user,
    },
    communityMembership: {
      findUnique: async () => state.membership,
      findFirst: async () => state.membership,
      update: op("communityMembership", "update"),
      create: (args: { data: Record<string, unknown> }) => {
        state.created.push(args.data);
        return op("communityMembership", "create")(args);
      },
    },
    communityStaffAssignment: {
      // Three different lookups share this method, distinguished by their
      // `where`: one assignment by id, whether this person already holds the
      // role, and whether somebody else is the sitting manager.
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        if ("id" in where) return state.assignmentById;
        if ("userId" in where) return state.activeAssignmentForUser;
        return state.incumbentManager;
      },
      findMany: async () => state.memberAssignments,
      update: op("communityStaffAssignment", "update"),
      create: op("communityStaffAssignment", "create"),
    },
    adminAuditLog: {
      create: op("adminAuditLog", "create"),
    },
    $transaction: async (ops: Op[]) => {
      state.batches.push(ops);
      return ops;
    },
  },
}));

const {
  addMember,
  assignStaffRole,
  revokeStaffAssignment,
  syncNeighborhoodMembership,
  updateMembership,
} = await import("@/lib/server/communities");

const ADMIN = { id: "admin-1" };

beforeEach(() => {
  state.community = {
    id: "c1",
    name: "Maple Street",
    type: "neighborhood",
    status: "active",
    centerLatitude: 37.77,
    centerLongitude: -122.42,
    radiusMiles: 4,
  };
  state.user = {
    id: "u1",
    role: "homeowner",
    latitude: 37.77,
    longitude: -122.42,
    communityMemberships: [{ status: "active" }],
  };
  state.membership = null;
  state.activeAssignmentForUser = null;
  state.incumbentManager = null;
  state.assignmentById = null;
  state.memberAssignments = [];
  state.neighborhoodCandidates = [];
  state.created = [];
  state.batches = [];
});

function lastBatch(): Op[] {
  const batch = state.batches.at(-1);
  if (!batch) throw new Error("No transaction was issued.");
  return batch;
}

function opsOf(model: string, action: string): Op[] {
  return lastBatch().filter((entry) => entry.model === model && entry.action === action);
}

describe("assignStaffRole", () => {
  it("creates the assignment and its audit entry in one transaction", async () => {
    const result = await assignStaffRole(ADMIN, "c1", {
      userId: "u1",
      role: "neighborhood_manager",
    });

    expect(state.batches).toHaveLength(1);
    expect(result.replacedAssignmentId).toBeNull();

    const [created] = opsOf("communityStaffAssignment", "create");
    expect(created.args.data).toMatchObject({
      communityId: "c1",
      userId: "u1",
      role: "neighborhood_manager",
      // The acting admin comes from the session, not the request body.
      assignedByUserId: "admin-1",
    });

    expect(opsOf("adminAuditLog", "create")).toHaveLength(1);
  });

  it("refuses to replace a sitting manager without an explicit confirmation", async () => {
    state.incumbentManager = { id: "old-assignment", userId: "u9" };

    await expect(
      assignStaffRole(ADMIN, "c1", { userId: "u1", role: "neighborhood_manager" }),
    ).rejects.toMatchObject({ code: "manager_already_assigned", status: 409 });

    expect(state.batches).toHaveLength(0);
  });

  it("revokes the incumbent and appoints the successor atomically", async () => {
    state.incumbentManager = { id: "old-assignment", userId: "u9" };

    const result = await assignStaffRole(ADMIN, "c1", {
      userId: "u1",
      role: "neighborhood_manager",
      replaceExistingManager: true,
    });

    expect(result.replacedAssignmentId).toBe("old-assignment");
    expect(state.batches).toHaveLength(1);

    const batch = lastBatch();
    // Revoke must precede the create: the partial unique index permits only
    // one active manager, so the reverse order would be rejected.
    expect(batch[0]).toMatchObject({
      model: "communityStaffAssignment",
      action: "update",
      args: { where: { id: "old-assignment" } },
    });
    expect(batch[0].args.data).toMatchObject({ status: "revoked", revokedByUserId: "admin-1" });

    const created = opsOf("communityStaffAssignment", "create");
    expect(created).toHaveLength(1);
    expect(batch.indexOf(created[0])).toBeGreaterThan(0);

    // Both halves of the swap are logged.
    expect(opsOf("adminAuditLog", "create")).toHaveLength(2);
  });

  it("is idempotent when the person already holds the role", async () => {
    state.activeAssignmentForUser = { id: "existing" };

    const result = await assignStaffRole(ADMIN, "c1", {
      userId: "u1",
      role: "neighborhood_manager",
    });

    expect(result).toEqual({ assignmentId: "existing", replacedAssignmentId: null });
    // No second row, and no second audit entry claiming a fresh assignment.
    expect(state.batches).toHaveLength(0);
  });

  it("rejects a neighborhood manager who is not an active resident", async () => {
    state.user = { id: "u1", role: "homeowner", communityMemberships: [{ status: "pending" }] };

    await expect(
      assignStaffRole(ADMIN, "c1", { userId: "u1", role: "neighborhood_manager" }),
    ).rejects.toMatchObject({ code: "member_not_resident" });
    expect(state.batches).toHaveLength(0);
  });

  it("assigns HOA staff who hold no membership at all", async () => {
    state.community = { ...state.community!, type: "hoa", radiusMiles: null };
    state.user = { id: "u1", role: "homeowner", communityMemberships: [] };

    await assignStaffRole(ADMIN, "c1", { userId: "u1", role: "hoa_manager" });
    expect(opsOf("communityStaffAssignment", "create")).toHaveLength(1);
  });

  it("requires confirmation and atomically replaces an existing HOA manager", async () => {
    state.community = { ...state.community!, type: "hoa", radiusMiles: null };
    state.user = { id: "u1", role: "homeowner", communityMemberships: [] };
    state.incumbentManager = { id: "hoa-old", userId: "u9" };

    await expect(
      assignStaffRole(ADMIN, "c1", { userId: "u1", role: "hoa_manager" }),
    ).rejects.toMatchObject({ code: "manager_already_assigned" });

    await assignStaffRole(ADMIN, "c1", {
      userId: "u1",
      role: "hoa_manager",
      replaceExistingManager: true,
    });
    expect(lastBatch()[0]).toMatchObject({
      model: "communityStaffAssignment",
      action: "update",
      args: { where: { id: "hoa-old" } },
    });
  });

  it("reports a missing community without touching the database", async () => {
    state.community = null;

    await expect(
      assignStaffRole(ADMIN, "c1", { userId: "u1", role: "neighborhood_manager" }),
    ).rejects.toBeInstanceOf(CommunityRuleError);
    expect(state.batches).toHaveLength(0);
  });
});

describe("updateMembership", () => {
  beforeEach(() => {
    state.membership = {
      id: "m1",
      status: "active",
      userId: "u1",
      joinedAt: new Date(),
      isPrimary: false,
      isAdminOverride: false,
      user: { latitude: 37.77, longitude: -122.42 },
    };
  });

  it("revokes a neighborhood manager role in the same transaction as the removal", async () => {
    state.memberAssignments = [{ id: "a1", role: "neighborhood_manager" }];

    const result = await updateMembership(ADMIN, "c1", "m1", { status: "removed" });

    expect(result.revokedStaffRoles).toEqual(["neighborhood_manager"]);
    expect(state.batches).toHaveLength(1);

    const batch = lastBatch();
    expect(batch.filter((entry) => entry.model === "communityMembership")).toHaveLength(1);
    expect(
      batch.some(
        (entry) =>
          entry.model === "communityStaffAssignment" &&
          entry.action === "update" &&
          (entry.args.data as Record<string, unknown>).status === "revoked",
      ),
    ).toBe(true);
    expect(
      batch.findIndex((entry) => entry.model === "communityStaffAssignment"),
    ).toBeLessThan(batch.findIndex((entry) => entry.model === "communityMembership"));
  });

  it("leaves HOA assignments alone when a membership ends", async () => {
    state.memberAssignments = [{ id: "a2", role: "hoa_team" }];

    const result = await updateMembership(ADMIN, "c1", "m1", { status: "removed" });

    expect(result.revokedStaffRoles).toEqual([]);
    expect(opsOf("communityStaffAssignment", "update")).toHaveLength(0);
  });

  it("does not revoke anything when the member stays active", async () => {
    state.memberAssignments = [{ id: "a1", role: "neighborhood_manager" }];

    const result = await updateMembership(ADMIN, "c1", "m1", { isPrimary: true });

    expect(result.revokedStaffRoles).toEqual([]);
    expect(opsOf("communityStaffAssignment", "update")).toHaveLength(0);
  });

  it("does not write or audit an unchanged membership", async () => {
    const result = await updateMembership(ADMIN, "c1", "m1", { isPrimary: false });
    expect(result).toEqual({ revokedStaffRoles: [] });
    expect(state.batches).toHaveLength(0);
  });

  it("reports a missing membership", async () => {
    state.membership = null;
    await expect(
      updateMembership(ADMIN, "c1", "m1", { status: "removed" }),
    ).rejects.toMatchObject({ code: "not_found", status: 404 });
  });
});

describe("addMember", () => {
  it("is a true no-op when the homeowner is already a current member", async () => {
    state.membership = { id: "m1", status: "active", joinedAt: new Date() };

    await expect(
      addMember(ADMIN, "c1", { userId: "u1", status: "pending" }),
    ).resolves.toEqual({ membershipId: "m1", alreadyMember: true });
    expect(state.batches).toHaveLength(0);
  });

  it("requires an explicit override outside a neighborhood radius", async () => {
    state.user = {
      id: "u1",
      role: "homeowner",
      latitude: 0,
      longitude: 0,
      communityMemberships: [],
    };

    await expect(
      addMember(ADMIN, "c1", { userId: "u1", status: "active" }),
    ).rejects.toMatchObject({ code: "manual_override_required", status: 409 });
    expect(state.batches).toHaveLength(0);
  });

  it("records a deliberate outside-radius placement as an override", async () => {
    state.user = {
      id: "u1",
      role: "homeowner",
      latitude: 0,
      longitude: 0,
      communityMemberships: [],
    };

    await addMember(ADMIN, "c1", {
      userId: "u1",
      status: "active",
      isAdminOverride: true,
    });
    expect(opsOf("communityMembership", "create")[0].args.data).toMatchObject({
      isAdminOverride: true,
    });
  });
});

describe("revokeStaffAssignment", () => {
  it("revokes and audits in one transaction", async () => {
    state.assignmentById = { id: "a1", userId: "u1", role: "hoa_team", status: "active" };

    await revokeStaffAssignment(ADMIN, "c1", "a1", "Stepped down");

    expect(state.batches).toHaveLength(1);
    expect(opsOf("communityStaffAssignment", "update")[0].args.data).toMatchObject({
      status: "revoked",
      revokedByUserId: "admin-1",
    });
    expect(opsOf("adminAuditLog", "create")).toHaveLength(1);
  });

  it("refuses to let an admin revoke their own role", async () => {
    state.assignmentById = { id: "a1", userId: ADMIN.id, role: "hoa_team", status: "active" };

    await expect(revokeStaffAssignment(ADMIN, "c1", "a1", null)).rejects.toMatchObject({
      code: "self_assignment",
      status: 403,
    });
    expect(state.batches).toHaveLength(0);
  });

  it("is a no-op when the assignment is already revoked", async () => {
    state.assignmentById = { id: "a1", userId: "u1", role: "hoa_team", status: "revoked" };

    await revokeStaffAssignment(ADMIN, "c1", "a1", null);
    expect(state.batches).toHaveLength(0);
  });

  it("reports a missing assignment", async () => {
    state.assignmentById = null;
    await expect(revokeStaffAssignment(ADMIN, "c1", "a1", null)).rejects.toMatchObject({
      code: "not_found",
      status: 404,
    });
  });
});

describe("syncNeighborhoodMembership", () => {
  it("does nothing when the homeowner already belongs somewhere", async () => {
    // An HOA resident in particular is never pulled into a radius group.
    state.membership = { communityId: "hoa-1" };

    await expect(syncNeighborhoodMembership("u1")).resolves.toBeNull();
    expect(state.created).toHaveLength(0);
  });

  it("does nothing when no neighborhood contains the homeowner", async () => {
    state.membership = null;
    state.user = { role: "homeowner", latitude: 0, longitude: 0 };
    state.neighborhoodCandidates = [
      { id: "c1", centerLatitude: 37.77, centerLongitude: -122.42, radiusMiles: 4 },
    ];

    await expect(syncNeighborhoodMembership("u1")).resolves.toBeNull();
    expect(state.created).toHaveLength(0);
  });

  it("does nothing for a homeowner with no stored coordinates", async () => {
    state.membership = null;
    state.user = { role: "homeowner", latitude: null, longitude: null };
    state.neighborhoodCandidates = [
      { id: "c1", centerLatitude: 37.77, centerLongitude: -122.42, radiusMiles: 4 },
    ];

    await expect(syncNeighborhoodMembership("u1")).resolves.toBeNull();
  });

  it("never places a provider account", async () => {
    state.membership = null;
    state.user = { role: "provider", latitude: 37.7749, longitude: -122.4194 };
    state.neighborhoodCandidates = [
      { id: "c1", centerLatitude: 37.77, centerLongitude: -122.42, radiusMiles: 4 },
    ];

    await expect(syncNeighborhoodMembership("u1")).resolves.toBeNull();
  });

  it("creates a pending, non-override membership in the matching neighborhood", async () => {
    state.membership = null;
    state.user = { role: "homeowner", latitude: 37.7749, longitude: -122.4194 };
    state.neighborhoodCandidates = [
      { id: "far", centerLatitude: 37.8, centerLongitude: -122.44, radiusMiles: 10 },
      { id: "near", centerLatitude: 37.775, centerLongitude: -122.4195, radiusMiles: 4 },
    ];

    await expect(syncNeighborhoodMembership("u1")).resolves.toBe("near");
    expect(state.created).toEqual([
      // Pending, so a human confirms a location the browser merely reported.
      { communityId: "near", userId: "u1", status: "pending" },
    ]);
  });
});
