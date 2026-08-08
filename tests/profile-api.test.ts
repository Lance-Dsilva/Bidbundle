import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Route-handler behaviour for `/api/profile*`.
 *
 * Clerk and Prisma are faked so the assertions are about authorization, the
 * allow-list, and what leaves the handler — not about network round trips.
 */

type Role = "homeowner" | "provider" | "admin";

const state = vi.hoisted(() => ({
  clerkUserId: "clerk_1" as string | null,
  role: "homeowner" as Role,
  /** Set to make one Prisma operation throw: `"model.operation"`. */
  failOn: null as { target: string; error: Error } | null,
  calls: [] as Array<{ model: string; operation: string; args: unknown }>,
}));

const USER_ROW = {
  id: "user_1",
  email: "ada@example.com",
  fullName: "Ada Lovelace",
  phone: null,
  isVerified: true,
  address: null,
  neighborhood: null,
  latitude: null,
  longitude: null,
  avatarUrl: null,
  avatarPath: null,
  avatarUpdatedAt: null,
  createdAt: new Date("2026-01-02T03:04:05.000Z"),
};

const HOMEOWNER_ROW = {
  notifyBids: true,
  notifyGroups: true,
  notifySavings: false,
  notifyEmail: true,
  notifyPush: true,
  serviceRadiusMi: 4,
};

const PROVIDER_ROW = {
  companyName: "ProFix",
  bio: null,
  trades: ["Plumbing"],
  serviceRadiusMi: 4,
  workingDays: ["mon"],
  workingHoursStart: "08:00",
  workingHoursEnd: "17:00",
  licenseNumber: "LIC-1",
  licenseState: null,
  insuranceProvider: null,
  insurancePolicyNumber: null,
  // Claimed but never checked by staff — the API must not call this verified.
  licenseVerifiedAt: null,
  insuranceVerifiedAt: null,
  payoutStatus: "not_connected",
  payoutLast4: null,
  payoutProvider: null,
  payoutUpdatedAt: null,
  notifyNewJobs: true,
  notifyMessages: true,
  notifyPayouts: true,
};

vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: state.clerkUserId }),
}));

function record(model: string, operation: string, args: unknown) {
  state.calls.push({ model, operation, args });
  if (state.failOn?.target === `${model}.${operation}`) throw state.failOn.error;
}

const client = {
  user: {
    findUnique: async (args: { select?: Record<string, unknown> }) => {
      record("user", "findUnique", args);
      // `findBundleenUser` asks for the role; the profile handlers ask for the
      // full column set.
      if (args.select && "clerkUserId" in args.select) {
        return { ...USER_ROW, clerkUserId: state.clerkUserId, role: state.role };
      }
      return { ...USER_ROW, role: state.role };
    },
    update: async (args: { data: Record<string, unknown> }) => {
      record("user", "update", args);
      return { ...USER_ROW, ...args.data, role: state.role };
    },
  },
  homeownerProfile: {
    upsert: async (args: { create: Record<string, unknown>; update: Record<string, unknown> }) => {
      record("homeownerProfile", "upsert", args);
      return { ...HOMEOWNER_ROW, ...args.update };
    },
  },
  providerProfile: {
    findUnique: async (args: unknown) => {
      record("providerProfile", "findUnique", args);
      return {
        licenseNumber: PROVIDER_ROW.licenseNumber,
        licenseState: PROVIDER_ROW.licenseState,
        insuranceProvider: PROVIDER_ROW.insuranceProvider,
        insurancePolicyNumber: PROVIDER_ROW.insurancePolicyNumber,
      };
    },
    upsert: async (args: { create: Record<string, unknown>; update: Record<string, unknown> }) => {
      record("providerProfile", "upsert", args);
      return { ...PROVIDER_ROW, ...args.update };
    },
  },
  $transaction: async (run: (tx: unknown) => Promise<unknown>) => run(client),
};

vi.mock("@/lib/server/db", () => ({ db: client }));

const commonRoute = await import("@/app/api/profile/route");
const homeownerRoute = await import("@/app/api/profile/homeowner/route");
const providerRoute = await import("@/app/api/profile/provider/route");
const meRoute = await import("@/app/api/auth/me/route");

function patchRequest(url: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(url, {
    method: "PATCH",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function signedInAs(role: Role) {
  state.clerkUserId = "clerk_1";
  state.role = role;
}

beforeEach(() => {
  signedInAs("homeowner");
  state.failOn = null;
  state.calls = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => vi.restoreAllMocks());

describe("GET /api/profile", () => {
  it("returns the signed-in user's record", async () => {
    const response = await commonRoute.GET();
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body).toMatchObject({
      id: "user_1",
      email: "ada@example.com",
      fullName: "Ada Lovelace",
      role: "homeowner",
      communityRadiusMi: 4,
    });
  });

  it("never exposes the Blob path or the Clerk id", async () => {
    const body = await (await commonRoute.GET()).json();
    expect(body).not.toHaveProperty("avatarPath");
    expect(body).not.toHaveProperty("clerkUserId");
  });

  it("answers 401 when there is no session", async () => {
    state.clerkUserId = null;
    expect((await commonRoute.GET()).status).toBe(401);
  });

  it("reports a database failure without quoting it", async () => {
    state.failOn = {
      target: "user.findUnique",
      error: new Error('select from "User" ... password=hunter2'),
    };
    const response = await commonRoute.GET();
    expect(response.status).toBe(500);

    const body = await response.json();
    expect(body.error).toBe("Something went wrong on our end. Please try again.");
    expect(JSON.stringify(body)).not.toContain("hunter2");
  });
});

describe("PATCH /api/profile", () => {
  it("saves a partial update and returns the fresh record", async () => {
    const response = await commonRoute.PATCH(
      patchRequest("https://bundleen.test/api/profile", { neighborhood: "Springfield" }),
    );
    expect(response.status).toBe(200);

    const update = state.calls.find((call) => call.operation === "update");
    expect((update?.args as { data: unknown }).data).toEqual({ neighborhood: "Springfield" });
  });

  it("scopes the write to the session's own id", async () => {
    await commonRoute.PATCH(
      patchRequest("https://bundleen.test/api/profile", { fullName: "Ada L." }),
    );
    const update = state.calls.find((call) => call.operation === "update");
    expect((update?.args as { where: unknown }).where).toEqual({ id: "user_1" });
  });

  it("clears stale coordinates when the address changes without a new position", async () => {
    await commonRoute.PATCH(
      patchRequest("https://bundleen.test/api/profile", { address: "742 Evergreen Terrace" }),
    );
    const update = state.calls.find((call) => call.operation === "update");
    expect((update?.args as { data: unknown }).data).toEqual({
      address: "742 Evergreen Terrace",
      latitude: null,
      longitude: null,
    });
  });

  it.each([
    ["email", "attacker@example.com"],
    ["role", "admin"],
    ["isVerified", true],
    ["id", "user_2"],
  ])("rejects an attempt to change %s", async (field, value) => {
    const response = await commonRoute.PATCH(
      patchRequest("https://bundleen.test/api/profile", { [field]: value }),
    );
    expect(response.status).toBe(400);
    expect(state.calls.some((call) => call.operation === "update")).toBe(false);
  });

  it("returns per-field messages for a bad value", async () => {
    const response = await commonRoute.PATCH(
      patchRequest("https://bundleen.test/api/profile", { phone: "call me" }),
    );
    expect(response.status).toBe(400);
    expect((await response.json()).fields).toHaveProperty("phone");
  });

  it("rejects a body that is not JSON", async () => {
    const response = await commonRoute.PATCH(
      new Request("https://bundleen.test/api/profile", {
        method: "PATCH",
        headers: { "content-type": "text/plain" },
        body: "fullName=Ada",
      }),
    );
    expect(response.status).toBe(415);
  });

  it("rejects an oversized body before parsing it", async () => {
    const response = await commonRoute.PATCH(
      patchRequest("https://bundleen.test/api/profile", { bio: "a" }, { "content-length": "999999" }),
    );
    expect(response.status).toBe(413);
  });

  it("answers 401 when there is no session", async () => {
    state.clerkUserId = null;
    const response = await commonRoute.PATCH(
      patchRequest("https://bundleen.test/api/profile", { fullName: "Ada" }),
    );
    expect(response.status).toBe(401);
  });

  it("reports a failing write generically", async () => {
    state.failOn = {
      target: "user.update",
      error: new Error('update "User" set address = 742 Evergreen Terrace'),
    };
    const response = await commonRoute.PATCH(
      patchRequest("https://bundleen.test/api/profile", { address: "742 Evergreen Terrace" }),
    );
    expect(response.status).toBe(500);

    const body = await response.json();
    expect(body.error).toBe("Something went wrong on our end. Please try again.");
    expect(JSON.stringify(body)).not.toContain("Evergreen");
  });
});

describe("role isolation", () => {
  it("lets a homeowner read their own profile", async () => {
    signedInAs("homeowner");
    expect((await homeownerRoute.GET()).status).toBe(200);
  });

  it("refuses a homeowner reading provider data", async () => {
    signedInAs("homeowner");
    expect((await providerRoute.GET()).status).toBe(403);
  });

  it("refuses a homeowner writing provider data", async () => {
    signedInAs("homeowner");
    const response = await providerRoute.PATCH(
      patchRequest("https://bundleen.test/api/profile/provider", { companyName: "Takeover" }),
    );
    expect(response.status).toBe(403);
    expect(state.calls.some((call) => call.model === "providerProfile")).toBe(false);
  });

  it("refuses a provider reading homeowner data", async () => {
    signedInAs("provider");
    expect((await homeownerRoute.GET()).status).toBe(403);
  });

  it("refuses a provider writing homeowner notification preferences", async () => {
    signedInAs("provider");
    const response = await homeownerRoute.PATCH(
      patchRequest("https://bundleen.test/api/profile/homeowner", { notifyBids: false }),
    );
    expect(response.status).toBe(403);
    expect(state.calls.some((call) => call.model === "homeownerProfile")).toBe(false);
  });

  it("refuses an admin, who holds neither role profile", async () => {
    signedInAs("admin");
    expect((await homeownerRoute.GET()).status).toBe(403);
    expect((await providerRoute.GET()).status).toBe(403);
  });
});

describe("PATCH /api/profile/homeowner", () => {
  it("saves a single toggle", async () => {
    const response = await homeownerRoute.PATCH(
      patchRequest("https://bundleen.test/api/profile/homeowner", { notifySavings: true }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ notifySavings: true, serviceRadiusMi: 4 });
  });

  it("rejects a request to widen the community radius", async () => {
    const response = await homeownerRoute.PATCH(
      patchRequest("https://bundleen.test/api/profile/homeowner", { serviceRadiusMi: 40 }),
    );
    expect(response.status).toBe(400);
    expect(state.calls.some((call) => call.model === "homeownerProfile")).toBe(false);
  });
});

describe("PATCH /api/profile/provider", () => {
  it("saves business details", async () => {
    signedInAs("provider");
    const response = await providerRoute.PATCH(
      patchRequest("https://bundleen.test/api/profile/provider", {
        companyName: "ProFix Plumbing",
        trades: ["Plumbing", "HVAC"],
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ companyName: "ProFix Plumbing" });
  });

  it("clears staff verification when the license claim changes", async () => {
    signedInAs("provider");
    const response = await providerRoute.PATCH(
      patchRequest("https://bundleen.test/api/profile/provider", {
        licenseNumber: "LIC-2",
      }),
    );
    expect(response.status).toBe(200);
    const update = state.calls.find(
      (call) => call.model === "providerProfile" && call.operation === "upsert",
    );
    expect((update?.args as { update: unknown }).update).toMatchObject({
      licenseNumber: "LIC-2",
      licenseVerifiedAt: null,
    });
  });

  it("atomically saves common and provider profile details", async () => {
    signedInAs("provider");
    const response = await providerRoute.PUT(
      new Request("https://bundleen.test/api/profile/provider", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          common: { fullName: "Ada L." },
          provider: { companyName: "ProFix Plumbing" },
        }),
      }),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      profile: { fullName: "Ada L." },
      provider: { companyName: "ProFix Plumbing" },
    });
  });

  it("reports a claimed but unchecked license as unverified", async () => {
    signedInAs("provider");
    const body = await (await providerRoute.GET()).json();
    expect(body.licenseNumber).toBe("LIC-1");
    expect(body.isLicenseVerified).toBe(false);
  });

  it.each([
    ["licenseVerifiedAt", new Date().toISOString()],
    ["insuranceVerifiedAt", new Date().toISOString()],
    ["payoutStatus", "active"],
    ["payoutLast4", "4242"],
  ])("rejects self-granted %s", async (field, value) => {
    signedInAs("provider");
    const response = await providerRoute.PATCH(
      patchRequest("https://bundleen.test/api/profile/provider", { [field]: value }),
    );
    expect(response.status).toBe(400);
    expect(state.calls.some((call) => call.model === "providerProfile")).toBe(false);
  });

  it("reports a database failure without quoting it", async () => {
    signedInAs("provider");
    state.failOn = {
      target: "providerProfile.upsert",
      error: new Error('update "ProviderProfile" set licenseNumber = LIC-SECRET'),
    };
    const response = await providerRoute.PATCH(
      patchRequest("https://bundleen.test/api/profile/provider", { companyName: "ProFix" }),
    );
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("LIC-SECRET");
  });
});

describe("GET /api/auth/me", () => {
  it("returns real profile columns rather than null placeholders", async () => {
    const body = await (await meRoute.GET()).json();
    expect(body).toMatchObject({
      id: "user_1",
      email: "ada@example.com",
      full_name: "Ada Lovelace",
      role: "homeowner",
      is_verified: true,
    });
    expect(body).not.toHaveProperty("clerkUserId");
  });

  it("answers 401 when there is no session", async () => {
    state.clerkUserId = null;
    expect((await meRoute.GET()).status).toBe(401);
  });
});
