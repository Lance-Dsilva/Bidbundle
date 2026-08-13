import { describe, expect, it } from "vitest";

import { auditActionSummary, buildAuditEntry, redactAuditMetadata } from "@/lib/server/audit";

describe("redactAuditMetadata", () => {
  it("returns null for absent metadata", () => {
    expect(redactAuditMetadata(null)).toBeNull();
    expect(redactAuditMetadata(undefined)).toBeNull();
  });

  it("drops location and credential fields", () => {
    const safe = redactAuditMetadata({
      memberUserId: "u1",
      address: "12 Maple St",
      latitude: 37.77,
      longitude: -122.42,
      centerLatitude: 37.77,
      licenseNumber: "ABC-123",
      insurancePolicyNumber: "POL-9",
      phone: "+1 555 0100",
    });

    expect(safe).toEqual({ memberUserId: "u1" });
  });

  it("matches forbidden keys regardless of case or separators", () => {
    const safe = redactAuditMetadata({
      Center_Latitude: 1,
      "api-key": "x",
      CLERKUSERID: "y",
      role: "hoa_team",
    });

    expect(safe).toEqual({ role: "hoa_team" });
  });

  it("keeps the distance and eligibility verdict, which carry no address", () => {
    const safe = redactAuditMetadata({ distanceMi: 1.4, isWithinRadius: false });
    expect(safe).toEqual({ distanceMi: 1.4, isWithinRadius: false });
  });

  it("preserves nulls for reviewed structured fields and drops free-form notes", () => {
    expect(redactAuditMetadata({ replacedAssignmentId: null })).toEqual({
      replacedAssignmentId: null,
    });
    expect(redactAuditMetadata({ note: null })).toEqual({});
    expect(redactAuditMetadata({ note: undefined })).toEqual({});
  });

  it("truncates approved strings and flattens approved string arrays", () => {
    const safe = redactAuditMetadata({
      reason: "x".repeat(500),
      changedFields: ["name", "radiusMiles"],
    });

    expect((safe?.reason as string).length).toBe(200);
    expect(safe?.changedFields).toBe("name, radiusMiles");
  });

  it("drops nested objects and non-finite numbers rather than storing junk", () => {
    const safe = redactAuditMetadata({
      reason: { a: 1 },
      distanceMi: Number.NaN,
      radiusMiles: 2,
    });
    expect(safe).toEqual({ distanceMi: null, radiusMiles: 2 });
  });

  it("drops unknown keys instead of retaining arbitrary text", () => {
    const wide = Object.fromEntries(
      Array.from({ length: 50 }, (_, index) => [`key${index}`, index]),
    );
    expect(redactAuditMetadata(wide)).toEqual({});
  });
});

describe("buildAuditEntry", () => {
  it("connects the actor and community instead of accepting raw ids", () => {
    const entry = buildAuditEntry({
      actorUserId: "admin-1",
      action: "staff_assigned",
      targetType: "staff_assignment",
      targetId: "assignment-1",
      communityId: "community-1",
      metadata: { role: "hoa_team", address: "12 Maple St" },
    });

    expect(entry.actor).toEqual({ connect: { id: "admin-1" } });
    expect(entry.community).toEqual({ connect: { id: "community-1" } });
    expect(entry.metadata).toEqual({ role: "hoa_team" });
  });

  it("omits the community link when the action has none", () => {
    const entry = buildAuditEntry({
      actorUserId: "admin-1",
      action: "provider_status_changed",
      targetType: "provider",
      targetId: "provider-1",
      providerUserId: "provider-1",
    });

    expect(entry.community).toBeUndefined();
    expect(entry.providerUserId).toBe("provider-1");
    expect(entry.metadata).toBeUndefined();
  });

  it("supports a server-generated safety event without impersonating a user", () => {
    const entry = buildAuditEntry({
      actorUserId: null,
      action: "provider_license_revoked",
      targetType: "provider",
      targetId: "provider-1",
      providerUserId: "provider-1",
      metadata: { reason: "The provider changed the underlying licence claim." },
    });

    expect(entry.actor).toBeUndefined();
    expect(entry.metadata).toEqual({
      reason: "The provider changed the underlying licence claim.",
    });
  });
});

describe("auditActionSummary", () => {
  it("describes every action in plain words", () => {
    expect(auditActionSummary("community_archived")).toBe("archived the community");
    expect(auditActionSummary("provider_license_verified")).toBe("verified a provider licence");
    expect(auditActionSummary("admin_access_granted")).toBe("granted admin portal access");
    expect(auditActionSummary("admin_access_revoked")).toBe("revoked admin portal access");
  });
});
