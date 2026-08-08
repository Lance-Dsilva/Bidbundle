import { describe, expect, it } from "vitest";

import {
  DASHBOARD_BY_ROLE,
  isAppRole,
  normalizeEmail,
  profileSetupSchema,
} from "@/lib/validation/auth";

describe("profileSetupSchema", () => {
  it.each(["homeowner", "provider"] as const)("accepts the public role %s", (role) => {
    expect(profileSetupSchema.safeParse({ role }).success).toBe(true);
  });

  it("normalizes optional profile fields", () => {
    const result = profileSetupSchema.safeParse({
      role: "homeowner",
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
    expect(profileSetupSchema.safeParse({ role }).success).toBe(false);
  });

  it("rejects malformed phone numbers", () => {
    expect(profileSetupSchema.safeParse({ role: "provider", phone: "call-me" }).success).toBe(
      false,
    );
  });

  it("does not add browser-supplied identity fields to parsed data", () => {
    const result = profileSetupSchema.safeParse({
      role: "homeowner",
      email: "forged@example.com",
      clerkUserId: "forged",
      password: "secret",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual({ role: "homeowner" });
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
