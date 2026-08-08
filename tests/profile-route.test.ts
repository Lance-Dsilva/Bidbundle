import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  clerkUserId: "user_clerk_123" as string | null,
  clerkUser: {
    id: "user_clerk_123",
    fullName: "Ada Lovelace",
    firstName: "Ada",
    lastName: "Lovelace",
    primaryEmailAddress: {
      emailAddress: "Ada@Example.COM",
      verification: { status: "verified" },
    },
    emailAddresses: [] as Array<{ emailAddress: string; verification?: { status?: string } }>,
    primaryPhoneNumber: { phoneNumber: "+1 215 555 0192" },
  } as Record<string, unknown> | null,
  guardFailure: null as unknown,
  upsertBehaviour: "success" as "success" | "duplicate" | "error",
  lastUpsertArgs: null as {
    where: Record<string, unknown>;
    create: Record<string, unknown>;
    update: Record<string, unknown>;
  } | null,
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: state.clerkUserId }),
  currentUser: async () => state.clerkUser,
}));

vi.mock("@/lib/server/auth-guard", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/auth-guard")>();
  return { ...actual, guardRegistration: async () => state.guardFailure };
});

class FakePrismaError extends Error {
  constructor(public code: string) {
    super("Prisma error");
  }
}

vi.mock("@/lib/server/db", () => ({
  db: {
    user: {
      upsert: async (args: {
        where: Record<string, unknown>;
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      }) => {
        state.lastUpsertArgs = args;
        if (state.upsertBehaviour === "duplicate") throw new FakePrismaError("P2002");
        if (state.upsertBehaviour === "error") throw new Error("database password=secret");
        return { role: args.create.role ?? "homeowner" };
      },
    },
  },
}));

const { POST } = await import("@/app/api/auth/profile/route");

function profileRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("https://bundleen.example/api/auth/profile", {
    method: "POST",
    headers: { "content-type": "application/json", "x-real-ip": "203.0.113.5", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  state.clerkUserId = "user_clerk_123";
  state.clerkUser = {
    id: "user_clerk_123",
    fullName: "Ada Lovelace",
    firstName: "Ada",
    lastName: "Lovelace",
    primaryEmailAddress: {
      emailAddress: "Ada@Example.COM",
      verification: { status: "verified" },
    },
    emailAddresses: [],
    primaryPhoneNumber: { phoneNumber: "+1 215 555 0192" },
  };
  state.guardFailure = null;
  state.upsertBehaviour = "success";
  state.lastUpsertArgs = null;
  vi.stubEnv("NODE_ENV", "test");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("Clerk profile synchronization", () => {
  it("creates a homeowner profile from the authenticated Clerk identity", async () => {
    const response = await POST(profileRequest({ role: "homeowner" }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      profileReady: true,
      role: "homeowner",
      redirectTo: "/app/homeowner/dashboard",
    });
    expect(state.lastUpsertArgs?.where).toEqual({ clerkUserId: "user_clerk_123" });
    expect(state.lastUpsertArgs?.create).toMatchObject({
      clerkUserId: "user_clerk_123",
      email: "ada@example.com",
      fullName: "Ada Lovelace",
      phone: "+1 215 555 0192",
      role: "homeowner",
      isVerified: true,
    });
  });

  it("creates a provider and returns the provider dashboard", async () => {
    const response = await POST(profileRequest({ role: "provider" }));
    expect(state.lastUpsertArgs?.create.role).toBe("provider");
    expect((await response.json()).redirectTo).toBe("/app/provider/dashboard");
  });

  it("never accepts identity fields or credentials from the browser", async () => {
    await POST(
      profileRequest({
        role: "homeowner",
        email: "attacker@example.com",
        password: "not-an-app-concern",
        clerkUserId: "forged_id",
      }),
    );
    expect(state.lastUpsertArgs?.create.email).toBe("ada@example.com");
    expect(state.lastUpsertArgs?.create.clerkUserId).toBe("user_clerk_123");
    expect(state.lastUpsertArgs?.create).not.toHaveProperty("password");
    expect(state.lastUpsertArgs?.create).not.toHaveProperty("passwordHash");
  });

  it("does not change an existing user's role during refresh", async () => {
    await POST(profileRequest({ role: "provider" }));
    expect(state.lastUpsertArgs?.update).not.toHaveProperty("role");
  });
});

describe("authentication and validation", () => {
  it("rejects requests without a Clerk session", async () => {
    state.clerkUserId = null;
    const response = await POST(profileRequest({ role: "homeowner" }));
    expect(response.status).toBe(401);
    expect(state.lastUpsertArgs).toBeNull();
  });

  it("rejects a mismatched Clerk profile", async () => {
    state.clerkUser = { ...state.clerkUser!, id: "different_clerk_user" };
    expect((await POST(profileRequest({ role: "homeowner" }))).status).toBe(401);
  });

  it("requires an email on the Clerk identity", async () => {
    state.clerkUser = {
      ...state.clerkUser!,
      primaryEmailAddress: null,
      emailAddresses: [],
    };
    expect((await POST(profileRequest({ role: "homeowner" }))).status).toBe(400);
  });

  it("rejects admin and unknown public roles", async () => {
    expect((await POST(profileRequest({ role: "admin" }))).status).toBe(400);
    expect((await POST(profileRequest({ role: "wizard" }))).status).toBe(400);
    expect(state.lastUpsertArgs).toBeNull();
  });

  it("rejects malformed JSON, non-JSON, and oversized bodies", async () => {
    expect((await POST(profileRequest("{bad json"))).status).toBe(400);
    const text = new Request("https://bundleen.example/api/auth/profile", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "role=homeowner",
    });
    expect((await POST(text)).status).toBe(415);
    expect(
      (await POST(profileRequest({ role: "homeowner", fullName: "x".repeat(10_000) }))).status,
    ).toBe(413);
  });
});

describe("operational failures", () => {
  it("returns 429 and does not write when the rate limit is exceeded", async () => {
    state.guardFailure = { kind: "rate-limited", retryAfterSeconds: 60 };
    const response = await POST(profileRequest({ role: "homeowner" }));
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("60");
    expect(state.lastUpsertArgs).toBeNull();
  });

  it("returns 503 and does not write when the limiter is unavailable", async () => {
    state.guardFailure = { kind: "unavailable" };
    const response = await POST(profileRequest({ role: "homeowner" }));
    expect(response.status).toBe(503);
    expect(state.lastUpsertArgs).toBeNull();
  });

  it("returns a safe conflict for a duplicate identity mapping", async () => {
    state.upsertBehaviour = "duplicate";
    const response = await POST(profileRequest({ role: "homeowner" }));
    expect(response.status).toBe(409);
  });

  it("does not expose database details", async () => {
    state.upsertBehaviour = "error";
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await POST(profileRequest({ role: "homeowner" }));
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toMatch(/password|database|secret/i);
  });
});
