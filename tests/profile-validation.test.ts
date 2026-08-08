import { describe, expect, it } from "vitest";

import {
  COMMUNITY_RADIUS_MI,
  MAX_BIO_LENGTH,
  commonProfileUpdateSchema,
  fieldErrors,
  homeownerProfileUpdateSchema,
  onboardingProfileSchema,
  providerProfileUpdateSchema,
} from "@/lib/validation/profile";

describe("commonProfileUpdateSchema", () => {
  it("accepts a partial update of a single field", () => {
    const result = commonProfileUpdateSchema.safeParse({ fullName: "Ada Lovelace" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual({ fullName: "Ada Lovelace" });
  });

  it("rejects an empty body so a no-op cannot masquerade as a save", () => {
    expect(commonProfileUpdateSchema.safeParse({}).success).toBe(false);
  });

  it("turns a blank optional field into null rather than an empty string", () => {
    const result = commonProfileUpdateSchema.safeParse({ phone: "   ", address: "" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual({ phone: null, address: null });
  });

  it.each(["email", "role", "isVerified", "id", "clerkUserId", "avatarUrl", "createdAt"])(
    "refuses to accept the server-owned field %s",
    (field) => {
      const result = commonProfileUpdateSchema.safeParse({ fullName: "Ada", [field]: "forged" });
      expect(result.success).toBe(false);
    },
  );

  it("rejects a name longer than the column allows", () => {
    expect(commonProfileUpdateSchema.safeParse({ fullName: "a".repeat(121) }).success).toBe(false);
  });

  it("rejects an over-long address", () => {
    expect(commonProfileUpdateSchema.safeParse({ address: "a".repeat(201) }).success).toBe(false);
  });

  it.each([
    ["latitude", 91],
    ["latitude", -91],
    ["longitude", 181],
    ["longitude", -181],
  ])("rejects out-of-range %s %s", (field, value) => {
    const other = field === "latitude" ? { longitude: 0 } : { latitude: 0 };
    expect(commonProfileUpdateSchema.safeParse({ [field]: value, ...other }).success).toBe(false);
  });

  it("accepts a valid coordinate pair", () => {
    const result = commonProfileUpdateSchema.safeParse({ latitude: 34.05, longitude: -118.24 });
    expect(result.success).toBe(true);
  });

  it("rejects a lone coordinate, which is not a position", () => {
    expect(commonProfileUpdateSchema.safeParse({ latitude: 34.05 }).success).toBe(false);
  });

  it("rejects clearing only half of a coordinate pair", () => {
    expect(
      commonProfileUpdateSchema.safeParse({ latitude: null, longitude: -118.24 }).success,
    ).toBe(false);
  });

  it("rejects a malformed phone number", () => {
    expect(commonProfileUpdateSchema.safeParse({ phone: "call me maybe" }).success).toBe(false);
  });
});

describe("homeownerProfileUpdateSchema", () => {
  it("accepts a single notification toggle", () => {
    const result = homeownerProfileUpdateSchema.safeParse({ notifyBids: false });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual({ notifyBids: false });
  });

  it("rejects a non-boolean toggle", () => {
    expect(homeownerProfileUpdateSchema.safeParse({ notifyBids: "yes" }).success).toBe(false);
  });

  it("has no service radius field — the community radius is not a user setting", () => {
    expect(
      homeownerProfileUpdateSchema.safeParse({ notifyBids: true, serviceRadiusMi: 25 }).success,
    ).toBe(false);
    expect(COMMUNITY_RADIUS_MI).toBe(4);
  });
});

describe("providerProfileUpdateSchema", () => {
  it("accepts business details a provider owns", () => {
    const result = providerProfileUpdateSchema.safeParse({
      companyName: "  ProFix Plumbing  ",
      bio: "Residential plumbing.",
      trades: ["Plumbing", "  HVAC  "],
      workingDays: ["fri", "mon"],
      workingHoursStart: "08:00",
      workingHoursEnd: "17:30",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.companyName).toBe("ProFix Plumbing");
      expect(result.data.trades).toEqual(["Plumbing", "HVAC"]);
      // Normalised to week order so the stored array is stable.
      expect(result.data.workingDays).toEqual(["mon", "fri"]);
    }
  });

  it("de-duplicates trades case-insensitively", () => {
    const result = providerProfileUpdateSchema.safeParse({ trades: ["Plumbing", "plumbing"] });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.trades).toEqual(["Plumbing"]);
  });

  it("accepts license and insurance details as claims", () => {
    const result = providerProfileUpdateSchema.safeParse({
      licenseNumber: "LIC-20491",
      insuranceProvider: "Statewide Mutual",
    });
    expect(result.success).toBe(true);
  });

  it.each([
    "isLicenseVerified",
    "licenseVerifiedAt",
    "isInsuranceVerified",
    "insuranceVerifiedAt",
    "payoutStatus",
    "payoutLast4",
    "serviceRadiusMi",
  ])("refuses to accept the server-controlled field %s", (field) => {
    const result = providerProfileUpdateSchema.safeParse({
      companyName: "ProFix",
      [field]: field === "serviceRadiusMi" ? 25 : "active",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a bio longer than the limit", () => {
    expect(
      providerProfileUpdateSchema.safeParse({ bio: "a".repeat(MAX_BIO_LENGTH + 1) }).success,
    ).toBe(false);
  });

  it("rejects more trades than a real business lists", () => {
    const trades = Array.from({ length: 13 }, (_, index) => `Trade ${index}`);
    expect(providerProfileUpdateSchema.safeParse({ trades }).success).toBe(false);
  });

  it.each(["8:00", "24:00", "08:60", "morning"])("rejects the invalid time %s", (time) => {
    expect(providerProfileUpdateSchema.safeParse({ workingHoursStart: time }).success).toBe(false);
  });

  it("rejects a closing time at or before the opening time", () => {
    const result = providerProfileUpdateSchema.safeParse({
      workingHoursStart: "17:00",
      workingHoursEnd: "09:00",
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(fieldErrors(result.error)).toHaveProperty("workingHoursEnd");
  });

  it("rejects updating only one working-hour boundary", () => {
    expect(providerProfileUpdateSchema.safeParse({ workingHoursStart: "08:00" }).success).toBe(
      false,
    );
  });

  it("rejects an unknown weekday", () => {
    expect(providerProfileUpdateSchema.safeParse({ workingDays: ["funday"] }).success).toBe(false);
  });
});

describe("onboardingProfileSchema", () => {
  it("carries address and coordinates through to the handler", () => {
    const result = onboardingProfileSchema.safeParse({
      role: "homeowner",
      address: "  742 Evergreen Terrace  ",
      neighborhood: "Springfield",
      latitude: 34.05,
      longitude: -118.24,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.address).toBe("742 Evergreen Terrace");
      expect(result.data.latitude).toBe(34.05);
    }
  });

  it("accepts provider claims but has no verification flags to set", () => {
    const result = onboardingProfileSchema.safeParse({
      role: "provider",
      address: "1 Main Street",
      neighborhood: "Austin",
      providerBusiness: {
        companyName: "ProFix",
        trades: ["Plumbing"],
        licenseNumber: "LIC-1",
        isLicensed: true,
      },
    });
    expect(result.success).toBe(false);
  });

  it("requires an address for every onboarding role", () => {
    expect(onboardingProfileSchema.safeParse({ role: "homeowner" }).success).toBe(false);
  });

  it("requires provider business identity, service area, and at least one trade", () => {
    expect(
      onboardingProfileSchema.safeParse({ role: "provider", address: "1 Main Street" }).success,
    ).toBe(false);
  });

  it("rejects a partial coordinate pair", () => {
    expect(
      onboardingProfileSchema.safeParse({
        role: "homeowner",
        address: "742 Evergreen Terrace",
        latitude: 34.05,
      }).success,
    ).toBe(false);
  });

  it("rejects an out-of-range onboarding coordinate", () => {
    expect(
      onboardingProfileSchema.safeParse({ role: "homeowner", latitude: 900, longitude: 0 }).success,
    ).toBe(false);
  });
});

describe("fieldErrors", () => {
  it("keeps only the first message per field", () => {
    const result = commonProfileUpdateSchema.safeParse({ fullName: "", phone: "nope" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const errors = fieldErrors(result.error);
      expect(Object.keys(errors).sort()).toEqual(["fullName", "phone"]);
      expect(typeof errors.fullName).toBe("string");
    }
  });
});
