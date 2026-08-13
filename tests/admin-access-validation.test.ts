import { describe, expect, it } from "vitest";

import { PRIMARY_ADMIN_EMAIL, isPrimaryAdminEmail } from "@/lib/admin-access";
import { adminAccessGrantSchema } from "@/lib/validation/admin-access";

describe("admin access validation", () => {
  it("normalizes an approved email", () => {
    expect(adminAccessGrantSchema.parse({ email: "  STAFF@Example.com " })).toEqual({
      email: "staff@example.com",
    });
  });

  it("rejects extra privilege fields supplied by the browser", () => {
    expect(
      adminAccessGrantSchema.safeParse({
        email: "staff@example.com",
        level: "owner",
        status: "active",
      }).success,
    ).toBe(false);
  });

  it("recognizes only the configured primary owner email", () => {
    expect(PRIMARY_ADMIN_EMAIL).toBe("lancedsilva2000@gmail.com");
    expect(isPrimaryAdminEmail(" LanceDSilva2000@gmail.com ")).toBe(true);
    expect(isPrimaryAdminEmail("someone@example.com")).toBe(false);
  });
});

