import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Role/tenant isolation for the AI assistant's authorization primitives.
 * These back every tool in `lib/server/ai/tools/*` — a bug here is a bug in
 * all seven.
 */

const state = vi.hoisted(() => ({
  communities: {} as Record<string, { id: string; name: string }>,
  staffAssignments: [] as Array<{ userId: string; communityId: string; role: string; status: string }>,
  memberships: [] as Array<{ userId: string; communityId: string; status: string; unitId: string | null }>,
}));

vi.mock("@/lib/server/db", () => ({
  db: {
    community: {
      findUnique: async ({ where }: { where: { id: string } }) => state.communities[where.id] ?? null,
    },
    communityStaffAssignment: {
      findFirst: async ({
        where,
      }: {
        where: { userId: string; communityId: string; role: string | { in: string[] }; status: string };
      }) => {
        const match = state.staffAssignments.find(
          (a) =>
            a.userId === where.userId &&
            a.communityId === where.communityId &&
            (typeof where.role === "string" ? a.role === where.role : where.role.in.includes(a.role)) &&
            a.status === where.status,
        );
        if (!match) return null;
        return {
          id: "assignment-1",
          community: { id: where.communityId, name: state.communities[where.communityId]?.name ?? "" },
        };
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
        if (!match) return null;
        return { id: "membership-1", unitId: match.unitId };
      },
      findMany: async ({
        where,
      }: {
        where: { userId: string; communityId: string; status: string };
      }) =>
        state.memberships
          .filter((m) => m.userId === where.userId && m.communityId === where.communityId && m.status === "active")
          .map((m) => ({ unitId: m.unitId })),
    },
  },
}));

const { resolveCommunityAccess, residentUnitIds, communityHref, requireAdmin, requireProvider, rejectProvider } =
  await import("@/lib/server/ai/scope");
const { AiToolError } = await import("@/lib/server/ai/errors");

beforeEach(() => {
  state.communities = { "community-1": { id: "community-1", name: "Maple Ridge HOA" } };
  state.staffAssignments = [];
  state.memberships = [];
});

afterEach(() => vi.clearAllMocks());

describe("resolveCommunityAccess", () => {
  it("lets an admin access any existing community", async () => {
    const access = await resolveCommunityAccess(
      { userId: "admin-1", role: "admin", isAdmin: true },
      "community-1",
    );
    expect(access).toEqual({ communityId: "community-1", name: "Maple Ridge HOA", isManagerOrAdmin: true });
  });

  it("404s an admin for a community that does not exist", async () => {
    await expect(
      resolveCommunityAccess({ userId: "admin-1", role: "admin", isAdmin: true }, "missing"),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("always rejects a provider, regardless of any assignment/membership row", async () => {
    state.staffAssignments.push({ userId: "prov-1", communityId: "community-1", role: "hoa_manager", status: "active" });
    await expect(
      resolveCommunityAccess({ userId: "prov-1", role: "provider", isAdmin: false }, "community-1"),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("grants manager access to an active hoa_manager assignment", async () => {
    state.staffAssignments.push({ userId: "mgr-1", communityId: "community-1", role: "hoa_manager", status: "active" });
    const access = await resolveCommunityAccess(
      { userId: "mgr-1", role: "hoa_staff", isAdmin: false },
      "community-1",
    );
    expect(access.isManagerOrAdmin).toBe(true);
  });

  it("grants resident (non-manager) access to an active member", async () => {
    state.memberships.push({ userId: "res-1", communityId: "community-1", status: "active", unitId: "unit-1" });
    const access = await resolveCommunityAccess(
      { userId: "res-1", role: "homeowner", isAdmin: false },
      "community-1",
    );
    expect(access.isManagerOrAdmin).toBe(false);
  });

  it("rejects a homeowner with no assignment and no membership in that community", async () => {
    await expect(
      resolveCommunityAccess({ userId: "stranger-1", role: "homeowner", isAdmin: false }, "community-1"),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("does not leak one homeowner's community access to a different community", async () => {
    state.communities["community-2"] = { id: "community-2", name: "Other HOA" };
    state.memberships.push({ userId: "res-1", communityId: "community-1", status: "active", unitId: "unit-1" });
    await expect(
      resolveCommunityAccess({ userId: "res-1", role: "homeowner", isAdmin: false }, "community-2"),
    ).rejects.toMatchObject({ status: 403 });
  });
});

describe("residentUnitIds", () => {
  it("returns only this resident's active unit ids, dropping nulls", async () => {
    state.memberships.push(
      { userId: "res-1", communityId: "community-1", status: "active", unitId: "unit-1" },
      { userId: "res-1", communityId: "community-1", status: "active", unitId: null },
      { userId: "res-2", communityId: "community-1", status: "active", unitId: "unit-2" },
    );
    await expect(residentUnitIds("res-1", "community-1")).resolves.toEqual(["unit-1"]);
  });
});

describe("role gates", () => {
  it("requireAdmin throws for a non-admin scope", () => {
    expect(() => requireAdmin({ userId: "u1", role: "homeowner", isAdmin: false }, "a tool")).toThrow(AiToolError);
    expect(() => requireAdmin({ userId: "u1", role: "admin", isAdmin: true }, "a tool")).not.toThrow();
  });

  it("requireProvider throws for a non-provider scope", () => {
    expect(() => requireProvider({ userId: "u1", role: "homeowner", isAdmin: false }, "a tool")).toThrow(AiToolError);
    expect(() => requireProvider({ userId: "u1", role: "provider", isAdmin: false }, "a tool")).not.toThrow();
  });

  it("rejectProvider throws only for a provider scope", () => {
    expect(() => rejectProvider({ userId: "u1", role: "provider", isAdmin: false }, "a tool")).toThrow(AiToolError);
    expect(() => rejectProvider({ userId: "u1", role: "homeowner", isAdmin: false }, "a tool")).not.toThrow();
  });
});

describe("communityHref", () => {
  it("always points admins at the admin community detail page", () => {
    expect(communityHref("admin", true, "c1")).toBe("/app/admin/communities/c1");
    expect(communityHref("admin", false, "c1", "requests")).toBe("/app/admin/communities/c1");
  });

  it("points managers and residents at their own surfaces", () => {
    expect(communityHref("homeowner", true, "c1")).toBe("/app/hoa/dashboard");
    expect(communityHref("homeowner", true, "c1", "requests")).toBe("/app/hoa/dashboard#requests");
    expect(communityHref("homeowner", false, "c1")).toBe("/app/homeowner/community");
    expect(communityHref("homeowner", false, "c1", "requests")).toBe("/app/homeowner/bids");
  });
});
