import { describe, expect, it } from "vitest";

import {
  communityCreateSchema,
  communityListQuerySchema,
  communityUpdateSchema,
  membershipCreateSchema,
  membershipUpdateSchema,
  providerAdminUpdateSchema,
  searchParamsToObject,
  staffAssignSchema,
} from "@/lib/validation/community";
import { COMMUNITY_RADIUS_MI } from "@/lib/validation/profile";

describe("communityCreateSchema", () => {
  it("creates an HOA from a name alone", () => {
    const parsed = communityCreateSchema.parse({ name: "  Oakwood Heights  ", type: "hoa" });
    expect(parsed.name).toBe("Oakwood Heights");
    expect(parsed.radiusMiles).toBeNull();
    expect(parsed.centerLatitude).toBeNull();
  });

  it("defaults a neighborhood to the standard community radius", () => {
    const parsed = communityCreateSchema.parse({
      name: "Maple Street",
      type: "neighborhood",
      centerLatitude: 37.77,
      centerLongitude: -122.42,
    });
    expect(parsed.radiusMiles).toBe(COMMUNITY_RADIUS_MI);
  });

  it("requires a centre point for a neighborhood", () => {
    const result = communityCreateSchema.safeParse({ name: "Maple", type: "neighborhood" });
    expect(result.success).toBe(false);
  });

  it("rejects out-of-range coordinates and radii", () => {
    expect(
      communityCreateSchema.safeParse({
        name: "Bad",
        type: "neighborhood",
        centerLatitude: 91,
        centerLongitude: 0,
      }).success,
    ).toBe(false);

    expect(
      communityCreateSchema.safeParse({
        name: "Bad",
        type: "neighborhood",
        centerLatitude: 37,
        centerLongitude: -122,
        radiusMiles: 0,
      }).success,
    ).toBe(false);
  });

  it("rejects unknown fields rather than ignoring them", () => {
    expect(
      communityCreateSchema.safeParse({ name: "X", type: "hoa", status: "archived" }).success,
    ).toBe(false);
  });
});

describe("communityUpdateSchema", () => {
  it("refuses an empty patch", () => {
    expect(communityUpdateSchema.safeParse({}).success).toBe(false);
  });

  it("refuses to change the community type", () => {
    expect(communityUpdateSchema.safeParse({ type: "hoa" }).success).toBe(false);
  });

  it("requires latitude and longitude together", () => {
    expect(communityUpdateSchema.safeParse({ centerLatitude: 37 }).success).toBe(false);
    expect(
      communityUpdateSchema.safeParse({ centerLatitude: 37, centerLongitude: -122 }).success,
    ).toBe(true);
    expect(
      communityUpdateSchema.safeParse({ centerLatitude: null, centerLongitude: null }).success,
    ).toBe(true);
    expect(
      communityUpdateSchema.safeParse({ centerLatitude: 37, centerLongitude: null }).success,
    ).toBe(false);
  });
});

describe("membership schemas", () => {
  it("will not create a membership already marked removed", () => {
    expect(
      membershipCreateSchema.safeParse({ userId: "u1", status: "removed" }).success,
    ).toBe(false);
  });

  it("accepts removal on update", () => {
    expect(membershipUpdateSchema.safeParse({ status: "removed" }).success).toBe(true);
  });

  it("refuses a client-supplied join date", () => {
    expect(
      membershipCreateSchema.safeParse({
        userId: "u1",
        status: "active",
        joinedAt: "2020-01-01T00:00:00.000Z",
      }).success,
    ).toBe(false);
  });
});

describe("staffAssignSchema", () => {
  it("accepts a person and a role", () => {
    expect(staffAssignSchema.safeParse({ userId: "u1", role: "hoa_team" }).success).toBe(true);
  });

  it("rejects an unknown role", () => {
    expect(staffAssignSchema.safeParse({ userId: "u1", role: "admin" }).success).toBe(false);
  });

  it("refuses a request that names its own assigner or timestamp", () => {
    for (const extra of [
      { assignedByUserId: "someone-else" },
      { assignedAt: "2020-01-01T00:00:00.000Z" },
      { status: "active" },
    ]) {
      expect(
        staffAssignSchema.safeParse({ userId: "u1", role: "hoa_team", ...extra }).success,
      ).toBe(false);
    }
  });
});

describe("providerAdminUpdateSchema", () => {
  it("accepts status and verification intents", () => {
    expect(
      providerAdminUpdateSchema.safeParse({ accountStatus: "suspended", license: "verify" })
        .success,
    ).toBe(false);
    expect(
      providerAdminUpdateSchema.safeParse({
        accountStatus: "suspended",
        license: "verify",
        expectedUpdatedAt: "2026-08-12T12:00:00.000Z",
      }).success,
    ).toBe(true);
  });

  it("refuses a client-supplied verification timestamp", () => {
    for (const extra of [
      { licenseVerifiedAt: "2020-01-01T00:00:00.000Z" },
      { insuranceVerifiedAt: "2020-01-01T00:00:00.000Z" },
      { accountStatusUpdatedByUserId: "someone-else" },
    ]) {
      expect(providerAdminUpdateSchema.safeParse(extra).success).toBe(false);
    }
  });

  it("refuses an empty patch and an unknown status", () => {
    expect(providerAdminUpdateSchema.safeParse({}).success).toBe(false);
    expect(providerAdminUpdateSchema.safeParse({ accountStatus: "deleted" }).success).toBe(false);
  });
});

describe("list queries", () => {
  it("falls back to defaults for a malformed query string rather than failing", () => {
    const params = new URLSearchParams("type=wizard&status=&page=0&pageSize=9999");
    const query = communityListQuerySchema.parse(searchParamsToObject(params));

    expect(query.type).toBeNull();
    expect(query.status).toBeNull();
    expect(query.page).toBe(1);
    expect(query.pageSize).toBe(25);
  });

  it("keeps valid filters", () => {
    const params = new URLSearchParams("type=hoa&managerState=unassigned&search=oak&page=3");
    const query = communityListQuerySchema.parse(searchParamsToObject(params));

    expect(query).toMatchObject({
      type: "hoa",
      managerState: "unassigned",
      search: "oak",
      page: 3,
    });
  });
});
