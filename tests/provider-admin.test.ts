import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The provider fields only Bundleen staff may write.
 *
 * The point of these tests is the boundary: a *claim* is something the
 * provider typed, a *verification* is a timestamp this server wrote after
 * staff checked it, and nothing in a request body can cross from one to the
 * other.
 */

type Op = { model: string; action: string; args: Record<string, unknown> };

const state = vi.hoisted(() => ({
  provider: null as Record<string, unknown> | null,
  batches: [] as Op[][],
}));

function op(model: string, action: string) {
  return (args: Record<string, unknown>): Op => ({ model, action, args });
}

vi.mock("@/lib/server/db", () => ({
  db: {
    providerProfile: {
      findUnique: async () => state.provider,
      update: op("providerProfile", "update"),
    },
    adminAuditLog: { create: op("adminAuditLog", "create") },
    $transaction: async (ops: Op[]) => {
      state.batches.push(ops);
      return ops;
    },
  },
}));

const { assertProviderCanAct, updateProviderAdministration } = await import(
  "@/lib/server/providers-admin"
);

const ADMIN = { id: "admin-1" };

beforeEach(() => {
  state.provider = {
    accountStatus: "pending",
    licenseNumber: "LIC-1",
    licenseVerifiedAt: null,
    insuranceProvider: "Acme Mutual",
    insuranceVerifiedAt: null,
    updatedAt: new Date("2026-08-12T12:00:00.000Z"),
  };
  state.batches = [];
});

function updateData(): Record<string, unknown> {
  const batch = state.batches.at(-1);
  if (!batch) throw new Error("No transaction was issued.");
  const update = batch.find((entry) => entry.model === "providerProfile");
  if (!update) throw new Error("No provider update in the transaction.");
  return update.args.data as Record<string, unknown>;
}

function auditCount(): number {
  return (state.batches.at(-1) ?? []).filter((entry) => entry.model === "adminAuditLog").length;
}

describe("updateProviderAdministration", () => {
  it("stamps the verification time and the verifying admin from the server", async () => {
    const before = Date.now();
    await updateProviderAdministration(ADMIN, "p1", {
      license: "verify",
      expectedUpdatedAt: "2026-08-12T12:00:00.000Z",
    });

    const data = updateData();
    expect(data.licenseVerifiedByUserId).toBe("admin-1");
    expect((data.licenseVerifiedAt as Date).getTime()).toBeGreaterThanOrEqual(before);
    expect(auditCount()).toBe(1);
    const providerWrite = state.batches[0].find((entry) => entry.model === "providerProfile");
    expect(providerWrite?.args.where).toMatchObject({
      userId: "p1",
      updatedAt: new Date("2026-08-12T12:00:00.000Z"),
    });
  });

  it("requires the reviewed row version for credential actions", async () => {
    await expect(
      updateProviderAdministration(ADMIN, "p1", { license: "verify" }),
    ).rejects.toMatchObject({ code: "stale_review", status: 409 });
  });

  it("clears the timestamp and the verifier on revocation", async () => {
    state.provider = { ...state.provider!, licenseVerifiedAt: new Date() };

    await updateProviderAdministration(ADMIN, "p1", {
      license: "revoke",
      expectedUpdatedAt: "2026-08-12T12:00:00.000Z",
    });

    expect(updateData()).toMatchObject({
      licenseVerifiedAt: null,
      licenseVerifiedByUserId: null,
    });
  });

  it("refuses to verify a licence that was never claimed", async () => {
    state.provider = { ...state.provider!, licenseNumber: null };

    await expect(
      updateProviderAdministration(ADMIN, "p1", {
        license: "verify",
        expectedUpdatedAt: "2026-08-12T12:00:00.000Z",
      }),
    ).rejects.toMatchObject({ code: "not_found" });
    expect(state.batches).toHaveLength(0);
  });

  it("refuses to verify insurance that was never claimed", async () => {
    state.provider = { ...state.provider!, insuranceProvider: null };

    await expect(
      updateProviderAdministration(ADMIN, "p1", {
        insurance: "verify",
        expectedUpdatedAt: "2026-08-12T12:00:00.000Z",
      }),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("records who changed the status and when", async () => {
    await updateProviderAdministration(ADMIN, "p1", {
      accountStatus: "suspended",
      expectedUpdatedAt: "2026-08-12T12:00:00.000Z",
      note: "Repeated no-shows",
    });

    expect(updateData()).toMatchObject({
      accountStatus: "suspended",
      accountStatusUpdatedByUserId: "admin-1",
      accountStatusNote: "Repeated no-shows",
    });
    expect(auditCount()).toBe(1);
  });

  it("writes nothing when the provider is already in the requested state", async () => {
    const result = await updateProviderAdministration(ADMIN, "p1", {
      accountStatus: "pending",
      expectedUpdatedAt: "2026-08-12T12:00:00.000Z",
    });

    expect(result).toEqual({ changed: false });
    expect(state.batches).toHaveLength(0);
  });

  it("audits each change separately when several are applied at once", async () => {
    await updateProviderAdministration(ADMIN, "p1", {
      accountStatus: "active",
      license: "verify",
      insurance: "verify",
      expectedUpdatedAt: "2026-08-12T12:00:00.000Z",
    });

    expect(state.batches).toHaveLength(1);
    expect(auditCount()).toBe(3);
  });

  it("refuses an admin acting on their own account", async () => {
    await expect(
      updateProviderAdministration(ADMIN, ADMIN.id, { accountStatus: "active" }),
    ).rejects.toMatchObject({ code: "self_assignment", status: 403 });
  });

  it("reports a provider that no longer exists", async () => {
    state.provider = null;
    await expect(
      updateProviderAdministration(ADMIN, "p1", { accountStatus: "active" }),
    ).rejects.toMatchObject({ code: "not_found", status: 404 });
  });
});

describe("assertProviderCanAct", () => {
  it("permits an active provider", async () => {
    state.provider = { accountStatus: "active" };
    await expect(assertProviderCanAct("p1")).resolves.toBeUndefined();
  });

  it("blocks a suspended provider from provider-owned changes", async () => {
    state.provider = { accountStatus: "suspended" };
    await expect(assertProviderCanAct("p1")).rejects.toMatchObject({
      code: "provider_not_active",
      status: 403,
    });
  });

  it("allows a pending provider to complete its profile but not to bid", async () => {
    state.provider = { accountStatus: "pending" };
    await expect(assertProviderCanAct("p1")).resolves.toBeUndefined();
    await expect(assertProviderCanAct("p1", { requireActive: true })).rejects.toMatchObject({
      code: "provider_not_active",
      status: 403,
    });
  });

  it("blocks an account with no provider profile", async () => {
    state.provider = null;
    await expect(assertProviderCanAct("p1")).rejects.toMatchObject({ code: "not_found" });
  });
});
