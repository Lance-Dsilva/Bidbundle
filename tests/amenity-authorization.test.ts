import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tenant scoping for the amenity feature, against a scripted database.
 *
 * The property under test is not "a filter is present" but "a caller who is
 * not entitled gets nothing" — so every case below drives the real guard and
 * inspects the `where` clause it actually issued. A guard that forgot
 * `communityId`, or that accepted a `neighborhood` community, fails here.
 */

type Query = { model: string; args: Record<string, unknown> };

const state = vi.hoisted(() => ({
  membership: null as Record<string, unknown> | null,
  staffAssignment: null as Record<string, unknown> | null,
  community: null as Record<string, unknown> | null,
  amenity: null as Record<string, unknown> | null,
  queries: [] as Query[],
}));

function record(model: string, args: unknown): void {
  state.queries.push({ model, args: (args ?? {}) as Record<string, unknown> });
}

vi.mock("@/lib/server/db", () => ({
  db: {
    communityMembership: {
      findFirst: async (args: unknown) => {
        record("communityMembership.findFirst", args);
        // The guard's own filter is what decides; the script only answers with
        // the row the fixture set up.
        const where = (args as { where?: Record<string, unknown> })?.where ?? {};
        const community = where.community as { type?: string } | undefined;
        if (community?.type === "hoa" && state.community?.type !== "hoa") return null;
        return state.membership;
      },
      findMany: async (args: unknown) => {
        record("communityMembership.findMany", args);
        return state.membership ? [state.membership] : [];
      },
    },
    communityStaffAssignment: {
      findFirst: async (args: unknown) => {
        record("communityStaffAssignment.findFirst", args);
        return state.staffAssignment;
      },
      findMany: async (args: unknown) => {
        record("communityStaffAssignment.findMany", args);
        return state.staffAssignment ? [state.staffAssignment] : [];
      },
    },
    community: {
      findFirst: async (args: unknown) => {
        record("community.findFirst", args);
        return state.community?.type === "hoa" ? state.community : null;
      },
    },
    amenity: {
      findUnique: async (args: unknown) => {
        record("amenity.findUnique", args);
        return state.amenity;
      },
    },
  },
}));

const {
  listManagedHoaCommunities,
  listResidentHoaCommunities,
  requireAmenityManager,
  requireAmenityResident,
  requireAmenityViewer,
  scopeForAmenity,
  visibleStatusesFor,
} = await import("@/lib/server/amenity-auth");
const { HoaWorkflowError } = await import("@/lib/server/hoa");

const HOA = {
  id: "hoa-1",
  name: "Cedar Ridge",
  type: "hoa",
  hoaProfile: { timezone: "America/Chicago" },
};

const RESIDENT = {
  id: "user-resident",
  clerkUserId: "clerk-r",
  email: "r@example.com",
  name: "Rae",
  role: "homeowner" as const,
  isVerified: true,
  adminAccessLevel: null,
  adminIsStaffAccount: false,
  adminPermissions: [],
};

const ADMIN = { ...RESIDENT, id: "user-admin", role: "admin" as const, adminAccessLevel: "owner" as const };

beforeEach(() => {
  state.membership = null;
  state.staffAssignment = null;
  state.community = HOA;
  state.amenity = null;
  state.queries = [];
});

describe("requireAmenityResident", () => {
  it("returns a resident scope for an active HOA membership", async () => {
    state.membership = {
      id: "m-1",
      unitId: "unit-9",
      unit: { label: "Home 9" },
      community: HOA,
    };

    const scope = await requireAmenityResident(RESIDENT.id, HOA.id);

    expect(scope).toMatchObject({
      communityId: "hoa-1",
      role: "resident",
      membershipId: "m-1",
      unitId: "unit-9",
      unitLabel: "Home 9",
      canManage: false,
      timezone: "America/Chicago",
    });
  });

  it("scopes its query to an active membership of an active HOA", async () => {
    state.membership = { id: "m-1", unitId: null, unit: null, community: HOA };
    await requireAmenityResident(RESIDENT.id, HOA.id);

    const query = state.queries.find(
      (entry) => entry.model === "communityMembership.findFirst",
    );
    expect(query?.args.where).toMatchObject({
      userId: RESIDENT.id,
      communityId: HOA.id,
      status: "active",
      community: { type: "hoa", status: "active" },
    });
  });

  it("refuses a caller with no membership, without confirming the HOA exists", async () => {
    state.membership = null;
    await expect(requireAmenityResident(RESIDENT.id, HOA.id)).rejects.toMatchObject({
      status: 403,
      message: "You do not have access to this community.",
    });
  });

  it("refuses a member of a location-based neighbourhood", async () => {
    // The community filter is `type: "hoa"`, so a neighbourhood membership can
    // never satisfy it. This is what keeps amenities out of the non-HOA product.
    state.community = { ...HOA, type: "neighborhood" };
    state.membership = { id: "m-2", unitId: null, unit: null, community: state.community };

    await expect(requireAmenityResident(RESIDENT.id, HOA.id)).rejects.toBeInstanceOf(
      HoaWorkflowError,
    );
  });
});

describe("requireAmenityManager", () => {
  it("accepts an active hoa_manager assignment", async () => {
    state.staffAssignment = { id: "s-1" };
    const scope = await requireAmenityManager(RESIDENT, HOA.id);
    expect(scope).toMatchObject({ role: "manager", canManage: true });

    const query = state.queries.find(
      (entry) => entry.model === "communityStaffAssignment.findFirst",
    );
    expect(query?.args.where).toMatchObject({
      userId: RESIDENT.id,
      communityId: HOA.id,
      status: "active",
      role: { in: ["hoa_manager", "hoa_team"] },
    });
  });

  it("refuses a resident who holds no staff assignment", async () => {
    state.staffAssignment = null;
    await expect(requireAmenityManager(RESIDENT, HOA.id)).rejects.toMatchObject({
      status: 403,
      message: "You do not manage this HOA.",
    });
  });

  it("grants a Bundleen admin the audited recovery scope, marked as admin", async () => {
    state.staffAssignment = null;
    const scope = await requireAmenityManager(ADMIN, HOA.id);
    // `role: "admin"` is what the audit metadata records as `via`, so a
    // recovery action stays distinguishable from a manager's own work.
    expect(scope).toMatchObject({ role: "admin", canManage: true });
  });

  it("refuses any caller for a neighbourhood community", async () => {
    state.community = { ...HOA, type: "neighborhood" };
    state.staffAssignment = { id: "s-1" };
    await expect(requireAmenityManager(ADMIN, HOA.id)).rejects.toMatchObject({
      status: 403,
    });
  });
});

describe("requireAmenityViewer", () => {
  it("prefers the manager scope but keeps a manager's own unit context", async () => {
    state.staffAssignment = { id: "s-1" };
    state.membership = { id: "m-3", unitId: "unit-2", unit: { label: "Home 2" } };

    const scope = await requireAmenityViewer(RESIDENT, HOA.id);
    expect(scope).toMatchObject({
      role: "manager",
      canManage: true,
      membershipId: "m-3",
      unitLabel: "Home 2",
    });
  });

  it("falls back to the resident scope when there is no assignment", async () => {
    state.staffAssignment = null;
    state.membership = { id: "m-4", unitId: null, unit: null, community: HOA };

    const scope = await requireAmenityViewer(RESIDENT, HOA.id);
    expect(scope).toMatchObject({ role: "resident", canManage: false });
  });

  it("refuses a caller who is neither", async () => {
    state.staffAssignment = null;
    state.membership = null;
    await expect(requireAmenityViewer(RESIDENT, HOA.id)).rejects.toMatchObject({
      status: 403,
    });
  });
});

describe("scopeForAmenity", () => {
  it("derives the community from the amenity row, not the request", async () => {
    state.amenity = { id: "amenity-1", communityId: "hoa-1" };
    state.membership = { id: "m-5", unitId: null, unit: null, community: HOA };
    state.staffAssignment = null;

    const { scope } = await scopeForAmenity(RESIDENT, "amenity-1");
    expect(scope.communityId).toBe("hoa-1");
  });

  it("refuses when the caller has no standing in the owning community", async () => {
    // The amenity exists and belongs to an HOA this person is not part of.
    state.amenity = { id: "amenity-x", communityId: "hoa-other" };
    state.membership = null;
    state.staffAssignment = null;

    await expect(scopeForAmenity(RESIDENT, "amenity-x")).rejects.toMatchObject({
      status: 403,
    });
  });

  it("reports a missing amenity as 404", async () => {
    state.amenity = null;
    await expect(scopeForAmenity(RESIDENT, "nope")).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe("visibleStatusesFor", () => {
  it("shows residents only published amenities", () => {
    expect(
      visibleStatusesFor({ canManage: false } as never),
    ).toEqual(["published"]);
  });

  it("shows staff drafts and archived amenities too", () => {
    expect(visibleStatusesFor({ canManage: true } as never)).toEqual([
      "draft",
      "published",
      "archived",
    ]);
  });
});

describe("community listings", () => {
  it("lists only official HOAs a person actively lives in", async () => {
    state.membership = { unit: { label: "Home 1" }, community: HOA };
    const communities = await listResidentHoaCommunities(RESIDENT.id);

    expect(communities).toEqual([
      { id: "hoa-1", name: "Cedar Ridge", timezone: "America/Chicago", unitLabel: "Home 1" },
    ]);
    const query = state.queries.find(
      (entry) => entry.model === "communityMembership.findMany",
    );
    expect(query?.args.where).toMatchObject({
      status: "active",
      community: { type: "hoa", status: "active" },
    });
  });

  it("lists only official HOAs a person actively staffs", async () => {
    state.staffAssignment = { community: HOA };
    const communities = await listManagedHoaCommunities(RESIDENT.id);
    expect(communities).toEqual([
      { id: "hoa-1", name: "Cedar Ridge", timezone: "America/Chicago" },
    ]);

    const query = state.queries.find(
      (entry) => entry.model === "communityStaffAssignment.findMany",
    );
    expect(query?.args.where).toMatchObject({
      status: "active",
      role: { in: ["hoa_manager", "hoa_team"] },
      community: { type: "hoa", status: "active" },
    });
  });
});
