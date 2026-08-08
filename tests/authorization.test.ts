import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppRole } from "@/lib/validation/auth";

const state = vi.hoisted(() => ({
  clerkUserId: null as string | null,
  databaseUser: null as null | {
    id: string;
    clerkUserId: string;
    email: string;
    fullName: string;
    role: "homeowner" | "provider" | "admin";
    isVerified: boolean;
  },
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: state.clerkUserId }),
}));

vi.mock("@/lib/server/db", () => ({
  db: { user: { findUnique: async () => state.databaseUser } },
}));

class RedirectError extends Error {
  constructor(public target: string) {
    super(`REDIRECT:${target}`);
  }
}

vi.mock("next/navigation", () => ({
  redirect: (target: string) => {
    throw new RedirectError(target);
  },
}));

const { authorizeRequest, getSessionUser, requireRole, requireUser } = await import(
  "@/lib/server/auth"
);

function signedInAs(role: AppRole) {
  state.clerkUserId = "user_clerk_123";
  state.databaseUser = {
    id: "user_db_123",
    clerkUserId: "user_clerk_123",
    email: "ada@example.com",
    fullName: "Ada Lovelace",
    role,
    isVerified: true,
  };
}

beforeEach(() => {
  state.clerkUserId = null;
  state.databaseUser = null;
});

afterEach(() => vi.clearAllMocks());

describe("getSessionUser", () => {
  it("maps a verified Clerk identity to the live Bundleen profile", async () => {
    signedInAs("homeowner");
    await expect(getSessionUser()).resolves.toEqual({
      id: "user_db_123",
      clerkUserId: "user_clerk_123",
      email: "ada@example.com",
      name: "Ada Lovelace",
      role: "homeowner",
      isVerified: true,
    });
  });

  it("returns null without a Clerk session", async () => {
    await expect(getSessionUser()).resolves.toBeNull();
  });

  it("returns null when the Clerk identity has no Bundleen profile", async () => {
    state.clerkUserId = "user_clerk_123";
    await expect(getSessionUser()).resolves.toBeNull();
  });

  it("rejects an unknown database role", async () => {
    signedInAs("homeowner");
    state.databaseUser = { ...state.databaseUser!, role: "wizard" as AppRole };
    await expect(getSessionUser()).resolves.toBeNull();
  });
});

describe("requireUser", () => {
  it("returns the Bundleen profile when signed in", async () => {
    signedInAs("provider");
    await expect(requireUser()).resolves.toMatchObject({ role: "provider" });
  });

  it("redirects anonymous users to Clerk sign-in", async () => {
    await expect(requireUser()).rejects.toThrow("REDIRECT:/sign-in");
  });

  it("preserves an encoded destination", async () => {
    await expect(requireUser("/app/homeowner/dashboard")).rejects.toThrow(
      "REDIRECT:/sign-in?redirect_url=%2Fapp%2Fhomeowner%2Fdashboard",
    );
  });

  it("sends signed-in users without a profile to onboarding", async () => {
    state.clerkUserId = "user_clerk_123";
    await expect(requireUser()).rejects.toThrow("REDIRECT:/get-started/profile");
  });
});

describe("requireRole", () => {
  it.each(["homeowner", "provider", "admin"] as const)("permits matching role %s", async (role) => {
    signedInAs(role);
    await expect(requireRole([role])).resolves.toMatchObject({ role });
  });

  it("redirects a user to their own dashboard for a wrong role", async () => {
    signedInAs("homeowner");
    await expect(requireRole(["admin"])).rejects.toThrow(
      "REDIRECT:/app/homeowner/dashboard",
    );
  });

  it("uses the current database role for authorization", async () => {
    signedInAs("admin");
    state.databaseUser = { ...state.databaseUser!, role: "provider" };
    await expect(requireRole(["admin"])).rejects.toThrow(
      "REDIRECT:/app/provider/dashboard",
    );
  });
});

describe("authorizeRequest", () => {
  it("returns the database user for an allowed role", async () => {
    signedInAs("homeowner");
    const result = await authorizeRequest(["homeowner"]);
    expect(result.ok).toBe(true);
    expect(result.ok && result.user.id).toBe("user_db_123");
  });

  it("returns 401 without a Clerk session", async () => {
    const result = await authorizeRequest(["homeowner"]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(401);
  });

  it("returns 409 when profile onboarding is incomplete", async () => {
    state.clerkUserId = "user_clerk_123";
    const result = await authorizeRequest();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(409);
  });

  it("returns 403 for a wrong application role", async () => {
    signedInAs("homeowner");
    const result = await authorizeRequest(["admin"]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(403);
  });

  it("allows any profiled user when no role allow-list is supplied", async () => {
    signedInAs("provider");
    expect((await authorizeRequest()).ok).toBe(true);
  });
});
