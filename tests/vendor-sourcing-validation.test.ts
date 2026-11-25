import { describe, expect, it } from "vitest";
import {
  MAX_VENDOR_INVITE_BATCH, vendorImportSchema, vendorInviteBatchSchema,
  vendorLeadSchema, vendorReferralSchema,
} from "@/lib/validation/vendor-sourcing";

const lead = { businessName: "  Synthetic Pool Care  ", categories: ["pool_care"], email: "Owner@EXAMPLE.INVALID" };

describe("manually confirmed vendor intake", () => {
  it("normalizes manual contact data without inventing eligibility", () => {
    expect(vendorLeadSchema.parse(lead)).toMatchObject({ businessName: "Synthetic Pool Care", email: "owner@example.invalid", contactConfirmed: false, licenseStatus: "unknown", source: "admin" });
  });
  it.each(["id", "convertedProviderUserId", "lastInvitedAt", "suppressionRemoved", "isVerified"])("rejects client-owned %s", (key) => {
    expect(vendorLeadSchema.safeParse({ ...lead, [key]: "forged" }).success).toBe(false);
  });
  it.each([
    { latitude: 91, longitude: 0 }, { latitude: 0, longitude: 181 },
    { latitude: -91, longitude: 0 }, { latitude: 0, longitude: -181 },
    { latitude: 1 }, { longitude: 1 }, { latitude: NaN, longitude: 0 },
  ])("rejects invalid or partial matching coordinates %j", (coordinates) => {
    expect(vendorLeadSchema.safeParse({ ...lead, ...coordinates }).success).toBe(false);
  });
  it("allows a location-free manually entered lead without fabricating a match radius", () => {
    expect(vendorLeadSchema.safeParse({ ...lead, latitude: null, longitude: null }).success).toBe(true);
  });
  it.each(["javascript:alert(1)", "data:text/html,<script>alert(1)</script>", "file:///etc/passwd"])("rejects a non-web vendor website %s", (website) => {
    expect(vendorLeadSchema.safeParse({ ...lead, website }).success).toBe(false);
  });
  it("bounds user-authored notes and rejects unknown service categories", () => {
    expect(vendorLeadSchema.safeParse({ ...lead, notes: "x".repeat(2001) }).success).toBe(false);
    expect(vendorLeadSchema.safeParse({ ...lead, categories: ["invented"] }).success).toBe(false);
  });
});

describe("referrals are suggestions rather than verified or send-approved leads", () => {
  it.each([{ email: "referral@example.invalid" }, { phone: "+1 (555) 010-0001" }])("accepts one usable contact channel %j", (contact) => {
    expect(vendorReferralSchema.safeParse({ businessName: "Our pool tech", ...contact }).success).toBe(true);
  });
  it("requires a contact and rejects caller-assigned license, status, confirmation and source", () => {
    expect(vendorReferralSchema.safeParse({ businessName: "Uncontactable" }).success).toBe(false);
    for (const extra of [{ source: "admin" }, { licenseStatus: "active" }, { contactConfirmed: true }, { convertedProviderUserId: "other-provider" }]) {
      expect(vendorReferralSchema.safeParse({ businessName: "Referral", email: "referral@example.invalid", ...extra }).success).toBe(false);
    }
  });
});

describe("bounded review-first CSLB import and invitation commands", () => {
  const csv = 'License Number,Business Name,License Status,Classification,County\n100001,Synthetic Pool,Active,D-35,Los Angeles';
  it("defaults an import to dry-run with the supported pool license classes", () => {
    expect(vendorImportSchema.parse({ csv, targetCounties: ["Los Angeles"] })).toMatchObject({ dryRun: true, licenseClasses: ["D-35", "C-53"] });
  });
  it("rejects unbounded CSV data and missing county review scope", () => {
    expect(vendorImportSchema.safeParse({ csv: "x".repeat(500001), targetCounties: ["Los Angeles"] }).success).toBe(false);
    expect(vendorImportSchema.safeParse({ csv, targetCounties: [] }).success).toBe(false);
    expect(vendorImportSchema.safeParse({ csv, targetCounties: Array.from({ length: 11 }, (_, i) => `County${i}`) }).success).toBe(false);
  });
  it("bounds the combined registered-provider and lead selection", () => {
    const ids = Array.from({ length: MAX_VENDOR_INVITE_BATCH }, (_, index) => `lead-${index}`);
    expect(vendorInviteBatchSchema.safeParse({ leadIds: ids }).success).toBe(true);
    expect(vendorInviteBatchSchema.safeParse({ leadIds: ids, providerUserIds: ["one-more"] }).success).toBe(false);
    expect(vendorInviteBatchSchema.safeParse({ leadIds: [] }).success).toBe(false);
  });
  it("rejects caller-owned sender, recipient, request identity and invitation secrets", () => {
    for (const extra of [{ requestId: "foreign-request" }, { to: "external@example.invalid" }, { from: "spoof@example.invalid" }, { token: "forged" }, { dailyLimit: 100000 }]) {
      expect(vendorInviteBatchSchema.safeParse({ leadIds: ["reviewed-lead"], ...extra }).success).toBe(false);
    }
  });
});
