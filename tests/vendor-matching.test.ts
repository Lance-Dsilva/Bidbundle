import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/server/db", () => ({ db: {} }));
import type { VendorLead } from "@/generated/prisma/client";
import { publicVendorRequest, vendorLeadMatch, type VendorRequest } from "@/lib/server/vendor-core";

const now = new Date("2026-11-10T12:00:00.000Z");
const lead = {
  id: "synthetic-lead", businessName: "Fictional Pool Care", categories: ["pool_care"], licenseClasses: ["D-35"],
  licenseNumber: "990099", licenseStatus: "active", licenseJurisdiction: "CA", licenseExpiresAt: new Date("2099-12-31"),
  status: "new", latitude: 34.05, longitude: -118.25, email: "pool@example.invalid", emailDigest: "a".repeat(64), contactConfirmed: true,
} as VendorLead;
const request = {
  id: "synthetic-request", category: "pool_care", biddingClosesAt: new Date("2099-01-01"), requiresAfterPhoto: true, poolTemplate: null,
  title: "PRIVATE_COMMUNITY_TITLE", description: "PRIVATE_ACCESS_NOTES", participations: [{ poolTier: "standard" }, { poolTier: "large" }],
  community: { name: "PRIVATE_COMMUNITY_NAME", type: "hoa", hoaProfile: { addressVerificationStatus: "verified", latitude: 34.05, longitude: -118.25,
    postalCode: "90001", locality: "Synthetic City", region: "CA", addressLine1: "PRIVATE_STREET_ADDRESS" } },
} as unknown as VendorRequest;
afterEach(() => vi.unstubAllEnvs());

describe("licensed vendor matching uses current server-owned geography and contact approval", () => {
  it("matches a licensed nearby manually confirmed contact without retaining precise public location", () => {
    expect(vendorLeadMatch(lead, request, now)).toEqual({ distanceMi: 0, reason: null });
    const publicData = publicVendorRequest(request);
    expect(publicData).toMatchObject({ category: "pool_care", areaLabel: "Synthetic City, CA", homeCount: 2, requiresAfterPhoto: true });
    expect(JSON.stringify(publicData)).not.toMatch(/PRIVATE_|address|latitude|longitude|resident|email|phone/i);
  });
  it.each([
    { status: "unsubscribed" }, { status: "bounced" }, { status: "declined" }, { status: "signed_up" },
    { licenseStatus: "unknown" }, { licenseStatus: "inactive" }, { licenseNumber: null }, { licenseExpiresAt: null },
    { licenseExpiresAt: new Date("2020-01-01") }, { licenseJurisdiction: "TX" },
    { categories: ["landscaping"] }, { latitude: null, longitude: null }, { latitude: 40, longitude: -74 },
    { email: null }, { contactConfirmed: false },
  ])("excludes an unsafe or ineligible lead %j", changes => {
    expect(vendorLeadMatch({ ...lead, ...changes } as VendorLead, request, now).reason).not.toBeNull();
  });
  it("does not treat an unrelated license class as authorization for pool work", () => {
    expect(vendorLeadMatch({ ...lead, licenseClasses: ["C-27"] }, request, now).reason).not.toBeNull();
  });
  it("refuses radius matching when the HOA address has not been verified", () => {
    const unknown = { ...request, community: { ...request.community, hoaProfile: { ...request.community.hoaProfile!, addressVerificationStatus: "unverified" } } };
    expect(vendorLeadMatch(lead, unknown as VendorRequest, now).reason).not.toBeNull();
  });
  it("does not allow configured distance to grow beyond the bounded service radius", () => {
    vi.stubEnv("VENDOR_MATCH_RADIUS_MILES", "1000000");
    expect(vendorLeadMatch({ ...lead, latitude: 40, longitude: -74 }, request, now).reason).not.toBeNull();
  });
});
