import { describe, expect, it } from "vitest";

import {
  assertCanAssignStaffRole,
  assertCanBeMember,
  assertCanRevokeStaffRole,
  assertStaffRoleMatchesCommunity,
  CommunityRuleError,
  primaryStaffRole,
  staffRolesInvalidatedByMembershipLoss,
  viewerRoleLabel,
  type AssigneeFacts,
  type CommunityFacts,
} from "@/lib/community-rules";

const neighborhood: CommunityFacts = { id: "c1", type: "neighborhood", status: "active" };
const hoa: CommunityFacts = { id: "c2", type: "hoa", status: "active" };

const ADMIN = "admin-1";

function assignee(overrides: Partial<AssigneeFacts> = {}): AssigneeFacts {
  return { id: "user-1", role: "homeowner", membershipStatus: "active", ...overrides };
}

function expectRule(code: string, run: () => void) {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(CommunityRuleError);
    expect((error as CommunityRuleError).code).toBe(code);
    return;
  }
  throw new Error(`Expected rule "${code}" to be violated, but nothing was thrown.`);
}

describe("assertStaffRoleMatchesCommunity", () => {
  it("permits neighborhood_manager only in a neighborhood", () => {
    expect(() => assertStaffRoleMatchesCommunity("neighborhood_manager", neighborhood)).not.toThrow();
    expectRule("invalid_role_for_community_type", () =>
      assertStaffRoleMatchesCommunity("neighborhood_manager", hoa),
    );
  });

  it.each(["hoa_manager", "hoa_team"] as const)("permits %s only in an HOA", (role) => {
    expect(() => assertStaffRoleMatchesCommunity(role, hoa)).not.toThrow();
    expectRule("invalid_role_for_community_type", () =>
      assertStaffRoleMatchesCommunity(role, neighborhood),
    );
  });
});

describe("assertCanAssignStaffRole", () => {
  it("assigns a neighborhood manager who is an active member", () => {
    expect(() =>
      assertCanAssignStaffRole({
        actorUserId: ADMIN,
        role: "neighborhood_manager",
        community: neighborhood,
        assignee: assignee(),
      }),
    ).not.toThrow();
  });

  it.each(["pending", "removed", null] as const)(
    "refuses a neighborhood manager whose membership is %s",
    (membershipStatus) => {
      expectRule("member_not_resident", () =>
        assertCanAssignStaffRole({
          actorUserId: ADMIN,
          role: "neighborhood_manager",
          community: neighborhood,
          assignee: assignee({ membershipStatus }),
        }),
      );
    },
  );

  it("assigns HOA staff who are not residents of that HOA", () => {
    for (const role of ["hoa_manager", "hoa_team"] as const) {
      expect(() =>
        assertCanAssignStaffRole({
          actorUserId: ADMIN,
          role,
          community: hoa,
          assignee: assignee({ membershipStatus: null }),
        }),
      ).not.toThrow();
    }
  });

  it("refuses a provider or admin account", () => {
    for (const role of ["provider", "admin"] as const) {
      expectRule("not_a_homeowner", () =>
        assertCanAssignStaffRole({
          actorUserId: ADMIN,
          role: "hoa_manager",
          community: hoa,
          assignee: assignee({ role, membershipStatus: null }),
        }),
      );
    }
  });

  it("refuses self-assignment even for an admin", () => {
    expectRule("self_assignment", () =>
      assertCanAssignStaffRole({
        actorUserId: ADMIN,
        role: "hoa_manager",
        community: hoa,
        assignee: assignee({ id: ADMIN }),
      }),
    );
  });

  it("refuses any assignment in an archived community", () => {
    expectRule("community_archived", () =>
      assertCanAssignStaffRole({
        actorUserId: ADMIN,
        role: "hoa_manager",
        community: { ...hoa, status: "archived" },
        assignee: assignee(),
      }),
    );
  });

  it("checks self-assignment before the community type", () => {
    // An admin naming themselves should be told that, not sent to fix a role
    // they were never allowed to grant themselves anyway.
    expectRule("self_assignment", () =>
      assertCanAssignStaffRole({
        actorUserId: ADMIN,
        role: "neighborhood_manager",
        community: hoa,
        assignee: assignee({ id: ADMIN }),
      }),
    );
  });
});

describe("assertCanRevokeStaffRole", () => {
  it("permits revoking someone else's role", () => {
    expect(() =>
      assertCanRevokeStaffRole({ actorUserId: ADMIN, assigneeUserId: "user-1" }),
    ).not.toThrow();
  });

  it("refuses revoking one's own role", () => {
    expectRule("self_assignment", () =>
      assertCanRevokeStaffRole({ actorUserId: ADMIN, assigneeUserId: ADMIN }),
    );
  });
});

describe("assertCanBeMember", () => {
  it("accepts homeowners and rejects every other global role", () => {
    expect(() => assertCanBeMember("homeowner")).not.toThrow();
    expectRule("not_a_homeowner", () => assertCanBeMember("provider"));
    expectRule("not_a_homeowner", () => assertCanBeMember("admin"));
  });
});

describe("staffRolesInvalidatedByMembershipLoss", () => {
  it("invalidates only the residency-based role", () => {
    expect(
      staffRolesInvalidatedByMembershipLoss([
        "neighborhood_manager",
        "hoa_manager",
        "hoa_team",
      ]),
    ).toEqual(["neighborhood_manager"]);
  });

  it("leaves HOA assignments alone", () => {
    expect(staffRolesInvalidatedByMembershipLoss(["hoa_manager", "hoa_team"])).toEqual([]);
  });
});

describe("primaryStaffRole", () => {
  it("prefers hoa_manager, then neighborhood_manager, then hoa_team", () => {
    expect(primaryStaffRole(["hoa_team", "neighborhood_manager", "hoa_manager"])).toBe(
      "hoa_manager",
    );
    expect(primaryStaffRole(["hoa_team", "neighborhood_manager"])).toBe("neighborhood_manager");
    expect(primaryStaffRole(["hoa_team"])).toBe("hoa_team");
    expect(primaryStaffRole([])).toBeNull();
  });
});

describe("viewerRoleLabel", () => {
  it("labels a plain homeowner", () => {
    expect(viewerRoleLabel("homeowner", [])).toBe("Homeowner");
  });

  it("labels each scoped role", () => {
    expect(viewerRoleLabel("homeowner", ["neighborhood_manager"])).toBe("Neighborhood manager");
    expect(viewerRoleLabel("homeowner", ["hoa_manager"])).toBe("HOA manager");
    expect(viewerRoleLabel("homeowner", ["hoa_team"])).toBe("HOA team");
  });

  it("ignores scoped roles for providers and admins", () => {
    expect(viewerRoleLabel("provider", ["hoa_manager"])).toBe("Service provider");
    expect(viewerRoleLabel("admin", ["hoa_manager"])).toBe("Bundleen admin");
  });
});
