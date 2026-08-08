import { describe, expect, it } from "vitest";

import { DASHBOARD_BY_ROLE, isAppRole, normalizeEmail } from "@/lib/validation/auth";
import { onboardingProfileSchema } from "@/lib/validation/profile";

describe("onboardingProfileSchema", () => {
  it("accepts a homeowner with a confirmed address", () => {
    expect(
      onboardingProfileSchema.safeParse({ role: "homeowner", address: "742 Evergreen Terrace" })
        .success,
    ).toBe(true);
  });

  it("accepts a provider with the required business fields", () => {
    expect(
      onboardingProfileSchema.safeParse({
        role: "provider",
        address: "1 Main Street",
        neighborhood: "Austin",
        providerBusiness: { companyName: "ProFix", trades: ["Plumbing"] },
      }).success,
    ).toBe(true);
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
