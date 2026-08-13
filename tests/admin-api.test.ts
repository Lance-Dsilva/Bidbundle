import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CommunityRuleError } from "@/lib/community-rules";

/**
 * The gate every `/api/admin/**` handler opens with, and the exit every one of
 * them closes with.
 *
 * These are the checks that hold whatever the individual endpoints do: an
 * anonymous or wrong-role caller never reaches a service, and no Prisma detail
 * reaches a response body.
 */

const state = vi.hoisted(() => ({
  clerkUserId: null as string | null,
  role: "admin" as "homeowner" | "provider" | "admin",
  hasProfile: true,
  guardFailure: null as { kind: "rate-limited"; retryAfterSeconds: number } | { kind: "unavailable" } | null,
  guardCalls: 0,
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: state.clerkUserId }),
}));

vi.mock("@/lib/server/db", () => ({
  db: {
    user: {
      findUnique: async () =>
        state.hasProfile
          ? {
              id: "admin-db-1",
              clerkUserId: state.clerkUserId,
              email: "ops@bundleen.test",
              fullName: "Ops Staff",
              role: state.role,
              isVerified: true,
            }
          : null,
    },
  },
}));

vi.mock("@/lib/server/auth-guard", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/auth-guard")>();
  return {
    ...actual,
    guardAdminMutation: async () => {
      state.guardCalls += 1;
      return state.guardFailure;
    },
  };
});

const { adminErrorResponse, requireAdmin, requireAdminMutation } = await import(
  "@/lib/server/admin-api"
);

beforeEach(() => {
  state.clerkUserId = "clerk_admin";
  state.role = "admin";
  state.hasProfile = true;
  state.guardFailure = null;
  state.guardCalls = 0;
});

afterEach(() => vi.clearAllMocks());

describe("requireAdmin", () => {
  it("admits a Bundleen admin", async () => {
    const gate = await requireAdmin();
    expect(gate.ok).toBe(true);
    expect(gate.ok && gate.user.id).toBe("admin-db-1");
  });

  it("answers 401 with no session", async () => {
    state.clerkUserId = null;
    const gate = await requireAdmin();
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.response.status).toBe(401);
  });

  it.each(["homeowner", "provider"] as const)("answers 403 for a %s", async (role) => {
    state.role = role;
    const gate = await requireAdmin();
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.response.status).toBe(403);
  });

  it("answers 409 when the signed-in identity has no Bundleen profile", async () => {
    state.hasProfile = false;
    const gate = await requireAdmin();
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.response.status).toBe(409);
  });

  it("does not consume the write limiter for a read", async () => {
    await requireAdmin();
    expect(state.guardCalls).toBe(0);
  });
});

describe("requireAdminMutation", () => {
  it("applies the per-admin write limiter after authorizing", async () => {
    const gate = await requireAdminMutation();
    expect(gate.ok).toBe(true);
    expect(state.guardCalls).toBe(1);
  });

  it("does not reach the limiter for a caller it already rejected", async () => {
    state.role = "homeowner";
    const gate = await requireAdminMutation();
    expect(gate.ok).toBe(false);
    expect(state.guardCalls).toBe(0);
  });

  it("answers 429 with a Retry-After header when limited", async () => {
    state.guardFailure = { kind: "rate-limited", retryAfterSeconds: 42 };
    const gate = await requireAdminMutation();

    expect(gate.ok).toBe(false);
    if (!gate.ok) {
      expect(gate.response.status).toBe(429);
      expect(gate.response.headers.get("Retry-After")).toBe("42");
    }
  });

  it("answers 503 when the limiter itself is unavailable", async () => {
    state.guardFailure = { kind: "unavailable" };
    const gate = await requireAdminMutation();
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.response.status).toBe(503);
  });
});

describe("adminErrorResponse", () => {
  it("passes a rule violation through with its own status and message", async () => {
    const response = adminErrorResponse(
      "staff assign",
      new CommunityRuleError(
        "member_not_resident",
        "A neighborhood manager must already be an active member of that neighborhood.",
      ),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "A neighborhood manager must already be an active member of that neighborhood.",
    });
  });

  it.each([
    ["P2002", { code: "P2002" }],
    ["23505", { code: "23505" }],
    ["a driver-reported 23505", { code: "unknown", meta: { code: "23505" } }],
  ])("turns %s into a 409 conflict", async (_label, error) => {
    const response = adminErrorResponse("staff assign", error);
    expect(response.status).toBe(409);

    const body = (await response.json()) as { error: string };
    expect(body.error).toMatch(/at the same time/);
  });

  it("turns a stale optimistic update into a safe 409", async () => {
    const response = adminErrorResponse("provider update", { code: "P2025" });
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringMatching(/changed/) });
  });

  it("turns a database invariant rejection into a safe 409", async () => {
    const response = adminErrorResponse("membership update", {
      code: "P2010",
      meta: { code: "23514" },
    });
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringMatching(/conflicts/) });
  });

  it("hides everything about an unexpected failure", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = adminErrorResponse(
      "community detail",
      new Error('Invalid `db.community.findUnique()` invocation: column "address" ...'),
    );

    expect(response.status).toBe(500);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("Something went wrong on our end. Please try again.");
    expect(body.error).not.toMatch(/address|db\.|invocation/);

    // Only the error class reaches the log — never the statement it quoted.
    expect(spy).toHaveBeenCalledWith("[admin] community detail failed", { name: "Error" });
    spy.mockRestore();
  });
});
