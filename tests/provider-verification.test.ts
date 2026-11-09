import { describe, expect, it } from "vitest";

import {
  credentialClaimSnapshot,
  credentialIsCurrent,
  credentialSnapshotMatches,
  providerVerificationState,
  type CredentialDocumentFacts,
  type VerificationProfile,
} from "@/lib/provider-verification";

const NOW = new Date("2026-11-08T23:59:59.999Z");
const EXPIRES = new Date("2026-11-08T00:00:00.000Z");

function verifiedProfile(): VerificationProfile {
  return {
    id: "profile-1",
    licenseNumber: "LIC-1",
    licenseState: "TX",
    insuranceProvider: "Example Mutual",
    insurancePolicyNumber: "POL-1",
    licenseVerifiedAt: new Date("2026-10-01T12:00:00Z"),
    insuranceVerifiedAt: new Date("2026-10-01T12:00:00Z"),
    licenseExpiresAt: EXPIRES,
    insuranceExpiresAt: EXPIRES,
    insuranceCoverageCents: 100_000_000,
    insuranceAdditionalInsured: true,
    licenseDocumentId: "license-1",
    insuranceDocumentId: "insurance-1",
    licenseVerifiedDocumentChecksum: "license-checksum",
    insuranceVerifiedDocumentChecksum: "insurance-checksum",
    licenseDocument: {
      id: "license-1", checksum: "license-checksum", status: "active",
      providerProfileId: "profile-1", purpose: "provider_license",
      credentialSnapshot: { licenseNumber: "LIC-1", licenseState: "TX" },
      credentialReviewStatus: "approved", credentialExpiresAt: EXPIRES,
      credentialCoverageCents: null, credentialAdditionalInsured: null,
    },
    insuranceDocument: {
      id: "insurance-1", checksum: "insurance-checksum", status: "active",
      providerProfileId: "profile-1", purpose: "provider_insurance",
      credentialSnapshot: { insuranceProvider: "Example Mutual", insurancePolicyNumber: "POL-1" },
      credentialReviewStatus: "approved", credentialExpiresAt: EXPIRES,
      credentialCoverageCents: 100_000_000, credentialAdditionalInsured: true,
    },
  };
}

describe("credential expiration calendar dates", () => {
  it("keeps a credential valid through its entire UTC expiration day", () => {
    expect(credentialIsCurrent(EXPIRES, NOW)).toBe(true);
    expect(credentialIsCurrent(EXPIRES, new Date("2026-11-09T00:00:00Z"))).toBe(false);
  });

  it("uses the UTC date even when the caller's calendar date differs", () => {
    expect(credentialIsCurrent(EXPIRES, new Date("2026-11-08T18:00:00-06:00"))).toBe(false);
    expect(credentialIsCurrent(EXPIRES, new Date("2026-11-09T00:30:00+02:00"))).toBe(true);
  });

  it.each([
    ["missing", undefined, false],
    ["null", null, false],
    ["invalid", new Date("invalid"), false],
    ["expired", new Date("2026-11-07T00:00:00Z"), false],
    ["future", new Date("2026-11-09T00:00:00Z"), true],
  ] as const)("fails closed for %s dates and permits a future date", (_label, expiresAt, expected) => {
    expect(credentialIsCurrent(expiresAt, NOW)).toBe(expected);
  });
});

describe("claim and document binding", () => {
  it("snapshots only the selected credential claim", () => {
    const profile = verifiedProfile();
    expect(credentialClaimSnapshot(profile, "license")).toEqual({ licenseNumber: "LIC-1", licenseState: "TX" });
    expect(credentialClaimSnapshot(profile, "insurance")).toEqual({ insuranceProvider: "Example Mutual", insurancePolicyNumber: "POL-1" });
    expect(credentialClaimSnapshot({}, "license")).toEqual({ licenseNumber: null, licenseState: null });
  });

  it.each([
    null, [], "LIC-1", {},
    { licenseNumber: "LIC-1" },
    { licenseNumber: "LIC-1", licenseState: "CA" },
    { licenseNumber: "LIC-1", licenseState: "TX", verified: true },
  ])("rejects a malformed, changed or augmented license snapshot: %j", (snapshot) => {
    expect(credentialSnapshotMatches(snapshot, verifiedProfile(), "license")).toBe(false);
  });

  it("accepts the same claim regardless of JSON key order, but not another policy", () => {
    const profile = verifiedProfile();
    expect(credentialSnapshotMatches({ licenseState: "TX", licenseNumber: "LIC-1" }, profile, "license")).toBe(true);
    expect(credentialSnapshotMatches({ insurancePolicyNumber: "POL-1", insuranceProvider: "Example Mutual" }, profile, "insurance")).toBe(true);
    expect(credentialSnapshotMatches({ insurancePolicyNumber: "POL-2", insuranceProvider: "Example Mutual" }, profile, "insurance")).toBe(false);
  });
});

describe("current provider verification", () => {
  it("requires both independently approved current credentials", () => {
    expect(providerVerificationState(verifiedProfile(), NOW)).toEqual({ license: true, insurance: true, verified: true });
  });

  it.each([null, undefined, {}])("does not verify an absent profile: %j", (profile) => {
    expect(providerVerificationState(profile, NOW)).toEqual({ license: false, insurance: false, verified: false });
  });

  it("does not grandfather historical timestamps without reviewed documents or expiration dates", () => {
    expect(providerVerificationState({
      id: "profile-1", licenseNumber: "LIC-1", insuranceProvider: "Example Mutual",
      licenseVerifiedAt: new Date("2026-01-01"), insuranceVerifiedAt: new Date("2026-01-01"),
    }, NOW)).toEqual({ license: false, insurance: false, verified: false });
  });

  describe.each(["license", "insurance"] as const)("%s approval", (kind) => {
    it.each([
      ["missing document", null],
      ["replaced document", { id: "replacement-2" }],
      ["different bytes", { checksum: "replacement-checksum" }],
      ["another provider's document", { providerProfileId: "profile-other" }],
      ["unrelated media purpose", { purpose: "amenity_gallery" }],
      ["removed document", { status: "removed" }],
      ["pending review", { credentialReviewStatus: "pending" }],
      ["rejected review", { credentialReviewStatus: "rejected" }],
      ["different reviewed expiration", { credentialExpiresAt: new Date("2026-11-09") }],
    ] as Array<[string, Partial<CredentialDocumentFacts> | null]>)("refuses %s without revoking the other credential", (_label, change) => {
      const profile = verifiedProfile();
      const key = kind === "license" ? "licenseDocument" : "insuranceDocument";
      profile[key] = change === null ? null : { ...profile[key]!, ...change };
      expect(providerVerificationState(profile, NOW)).toEqual({
        license: kind !== "license", insurance: kind !== "insurance", verified: false,
      });
    });

    it("invalidates a newly edited claim even if the old stamp and document remain", () => {
      const profile = verifiedProfile();
      if (kind === "license") profile.licenseNumber = "LIC-2";
      else profile.insurancePolicyNumber = "POL-2";
      expect(providerVerificationState(profile, NOW)[kind]).toBe(false);
    });

    it("requires a staff approval stamp and current expiry in addition to document approval", () => {
      const profile = verifiedProfile();
      if (kind === "license") profile.licenseVerifiedAt = null;
      else profile.insuranceVerifiedAt = null;
      expect(providerVerificationState(profile, NOW)[kind]).toBe(false);
      const expired = verifiedProfile();
      expect(providerVerificationState(expired, new Date("2026-11-09T00:00:00Z"))[kind]).toBe(false);
    });
  });

  it.each([
    ["missing amount", null], ["negative amount", -1], ["fractional cents", 1.5],
    ["unsafe amount", Number.MAX_SAFE_INTEGER + 1],
  ])("refuses insurance with %s", (_label, amount) => {
    const profile = verifiedProfile();
    profile.insuranceCoverageCents = amount as number | null;
    profile.insuranceDocument!.credentialCoverageCents = amount as number | null;
    expect(providerVerificationState(profile, NOW)).toEqual({ license: true, insurance: false, verified: false });
  });

  it.each([
    { credentialCoverageCents: 200_000_000 },
    { credentialAdditionalInsured: false },
  ])("does not accept coverage or additional-insured terms different from the reviewed document: %j", (change) => {
    const profile = verifiedProfile();
    Object.assign(profile.insuranceDocument!, change);
    expect(providerVerificationState(profile, NOW).insurance).toBe(false);
  });
});
