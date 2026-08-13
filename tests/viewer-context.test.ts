import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The identity area's data source.
 *
 * Every assertion here is really the same one: the label comes from live
 * database rows, so an assignment made by Bundleen staff is reflected on the
 * customer's next request without a new sign-in, and nothing a client stores
 * can produce a label the database does not back.
 */

const state = vi.hoisted(() => ({
  user: null as Record<string, unknown> | null,
  assignments: [] as Array<Record<string, unknown>>,
  memberships: [] as Array<Record<string, unknown>>,
  assignmentWhere: null as Record<string, unknown> | null,
}));

vi.mock("@/lib/server/db", () => ({
  db: {
    user: { findUnique: async () => state.user },
    communityStaffAssignment: {
      findMany: async ({ where }: { where: Record<string, unknown> }) => {
        state.assignmentWhere = where;
        return state.assignments;
      },
    },
    communityMembership: { findMany: async () => state.memberships },
  },
}));

const { resolveViewerContext } = await import("@/lib/server/communities");

const HOMEOWNER = {
  id: "u1",
  email: "resident@example.com",
  name: "Ada Lovelace",
  role: "homeowner" as const,
};

function community(id: string, name: string, type: "hoa" | "neighborhood" = "neighborhood") {
  return { id, name, type };
}

beforeEach(() => {
  state.user = { avatarUrl: null, providerProfile: null };
  state.assignments = [];
  state.memberships = [];
  state.assignmentWhere = null;
});

describe("resolveViewerContext", () => {
  it("labels a resident with no scoped role as a homeowner", async () => {
    const context = await resolveViewerContext(HOMEOWNER);

    expect(context.roleLabel).toBe("Homeowner");
    expect(context.canManageCommunity).toBe(false);
    expect(context.initials).toBe("AL");
    expect(context.providerStatus).toBeNull();
  });

  it("labels a neighborhood manager from their live assignment", async () => {
    state.assignments = [
      { role: "neighborhood_manager", community: community("c1", "Maple Street") },
    ];

    const context = await resolveViewerContext(HOMEOWNER);

    expect(context.roleLabel).toBe("Neighborhood manager");
    expect(context.canManageCommunity).toBe(true);
    expect(context.assignments).toEqual([
      {
        communityId: "c1",
        communityName: "Maple Street",
        communityType: "neighborhood",
        role: "neighborhood_manager",
        roleLabel: "Neighborhood manager",
      },
    ]);
  });

  it("shows the most privileged label when several roles are held", async () => {
    state.assignments = [
      { role: "hoa_team", community: community("c2", "Oakwood", "hoa") },
      { role: "hoa_manager", community: community("c3", "Cedar", "hoa") },
    ];

    expect((await resolveViewerContext(HOMEOWNER)).roleLabel).toBe("HOA manager");
  });

  it("only counts active assignments in active communities", async () => {
    await resolveViewerContext(HOMEOWNER);

    expect(state.assignmentWhere).toEqual({
      userId: "u1",
      status: "active",
      community: { status: "active" },
    });
  });

  it("reports a provider's account status and ignores any scoped role", async () => {
    state.user = { avatarUrl: null, providerProfile: { accountStatus: "suspended" } };
    state.assignments = [{ role: "hoa_manager", community: community("c1", "Oakwood", "hoa") }];

    const context = await resolveViewerContext({ ...HOMEOWNER, role: "provider" });

    expect(context.roleLabel).toBe("Service provider");
    expect(context.providerStatus).toBe("suspended");
    expect(context.canManageCommunity).toBe(false);
  });

  it("defaults a provider with no profile row to pending, never to active", async () => {
    state.user = { avatarUrl: null, providerProfile: null };
    const context = await resolveViewerContext({ ...HOMEOWNER, role: "provider" });
    expect(context.providerStatus).toBe("pending");
  });

  it("never grants management to a Bundleen admin through this path", async () => {
    state.assignments = [{ role: "hoa_manager", community: community("c1", "Oakwood", "hoa") }];

    const context = await resolveViewerContext({ ...HOMEOWNER, role: "admin" });

    expect(context.roleLabel).toBe("Bundleen admin");
    expect(context.canManageCommunity).toBe(false);
  });

  it("lists the viewer's own memberships", async () => {
    state.memberships = [
      { status: "active", isPrimary: true, community: community("c1", "Maple Street") },
      { status: "pending", isPrimary: false, community: community("c4", "Elm Court") },
    ];

    const context = await resolveViewerContext(HOMEOWNER);

    expect(context.communities).toEqual([
      {
        communityId: "c1",
        communityName: "Maple Street",
        communityType: "neighborhood",
        status: "active",
        isPrimary: true,
      },
      {
        communityId: "c4",
        communityName: "Elm Court",
        communityType: "neighborhood",
        status: "pending",
        isPrimary: false,
      },
    ]);
  });
});
