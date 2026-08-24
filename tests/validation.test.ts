import { describe, expect, it } from "vitest";

import { DASHBOARD_BY_ROLE, isAppRole, normalizeEmail } from "@/lib/validation/auth";
import { fieldErrors, onboardingProfileSchema } from "@/lib/validation/profile";

describe("onboardingProfileSchema", () => {
  it("accepts a homeowner with a confirmed address", () => {
    expect(
      onboardingProfileSchema.safeParse({ role: "homeowner", address: "742 Evergreen Terrace" })
        .success,
    ).toBe(true);
  });

  const PROVIDER_COVERAGE = {
    label: "North Austin",
    centerLatitude: 30.4021,
    centerLongitude: -97.7266,
    radiusMiles: 15,
  };

  it("accepts a provider with the required business fields and a coverage circle", () => {
    expect(
      onboardingProfileSchema.safeParse({
        role: "provider",
        address: "1 Main Street",
        neighborhood: "Austin",
        providerBusiness: { companyName: "ProFix", trades: ["Plumbing"] },
        providerCoverage: PROVIDER_COVERAGE,
      }).success,
    ).toBe(true);
  });

  it("rejects provider onboarding that never set a coverage area", () => {
    const result = onboardingProfileSchema.safeParse({
      role: "provider",
      address: "1 Main Street",
      neighborhood: "Austin",
      providerBusiness: { companyName: "ProFix", trades: ["Plumbing"] },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(fieldErrors(result.error).providerCoverage).toBe(
        "Set the area you cover before finishing setup.",
      );
    }
  });

  it("rejects a coverage radius outside the product range", () => {
    for (const radiusMiles of [0, 0.5, 101, 250]) {
      expect(
        onboardingProfileSchema.safeParse({
          role: "provider",
          address: "1 Main Street",
          neighborhood: "Austin",
          providerBusiness: { companyName: "ProFix", trades: ["Plumbing"] },
          providerCoverage: { ...PROVIDER_COVERAGE, radiusMiles },
        }).success,
      ).toBe(false);
    }
  });

  it("refuses a coverage circle on a homeowner body", () => {
    expect(
      onboardingProfileSchema.safeParse({
        role: "homeowner",
        address: "742 Evergreen Terrace",
        providerCoverage: PROVIDER_COVERAGE,
      }).success,
    ).toBe(false);
  });

  it("normalizes optional profile fields", () => {
    const result = onboardingProfileSchema.safeParse({
      role: "homeowner",
      address: "742 Evergreen Terrace",
      fullName: "  Ada Lovelace  ",
      phone: "",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.fullName).toBe("Ada Lovelace");
      expect(result.data.phone).toBeUndefined();
    }
  });

  it.each(["admin", "wizard", ""])("rejects non-public role %s", (role) => {
    expect(onboardingProfileSchema.safeParse({ role }).success).toBe(false);
  });

  it("rejects malformed phone numbers", () => {
    expect(onboardingProfileSchema.safeParse({ role: "provider", phone: "call-me" }).success).toBe(
      false,
    );
  });

  it("does not add browser-supplied identity fields to parsed data", () => {
    const result = onboardingProfileSchema.safeParse({
      role: "homeowner",
      address: "742 Evergreen Terrace",
      email: "forged@example.com",
      clerkUserId: "forged",
      password: "secret",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ role: "homeowner", address: "742 Evergreen Terrace" });
    }
  });
});

describe("identity and role helpers", () => {
  it("normalizes email case and surrounding whitespace", () => {
    expect(normalizeEmail("  Ada@Example.COM ")).toBe("ada@example.com");
  });

  it.each(["homeowner", "provider", "admin"])("recognizes application role %s", (role) => {
    expect(isAppRole(role)).toBe(true);
  });

  it.each(["wizard", "", null, 1])("rejects invalid role %s", (role) => {
    expect(isAppRole(role)).toBe(false);
  });

  it("maps every application role to its own dashboard", () => {
    expect(DASHBOARD_BY_ROLE).toEqual({
      homeowner: "/app/homeowner/dashboard",
      provider: "/app/provider/dashboard",
      admin: "/app/admin/dashboard",
    });
  });
});
