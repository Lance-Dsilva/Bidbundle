import { beforeEach, describe, expect, it, vi } from "vitest";
import { approvedProviderVerification } from "./fixtures/provider-verification";
import { providerAdminUpdateSchema } from "@/lib/validation/community";

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
  transactionError: null as unknown,
  credentials: vi.fn(),
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
    adminAuditLog: { create: op("adminAuditLog", "create"), findMany: async () => [] },
    user: { findMany: async () => [] },
    providerCommunityApproval: { findMany: async () => [] },
    mediaAsset: { update: op("mediaAsset", "update") },
    notification: { createMany: op("notification", "createMany") },
    outboxEvent: { createMany: op("outboxEvent", "createMany") },
    $transaction: async (ops: Op[]) => {
      if (state.transactionError) throw state.transactionError;
      state.batches.push(ops);
      return ops;
    },
  },
}));
vi.mock("@/lib/server/provider-credentials", () => ({ listProviderCredentials: state.credentials }));

const { assertProviderCanAct, updateProviderAdministration, getProviderDetail } = await import(
  "@/lib/server/providers-admin"
);

const ADMIN = { id: "admin-1" };
const LICENSE_REVIEW = {
  licenseDocumentId: "license-document-1", licenseDocumentChecksum: "a".repeat(64), licenseExpiresOn: "2099-01-01",
};
const INSURANCE_REVIEW = {
  insuranceDocumentId: "insurance-document-1", insuranceDocumentChecksum: "b".repeat(64), insuranceExpiresOn: "2099-01-01",
  insuranceCoverageCents: 100_000_000, insuranceAdditionalInsured: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  state.provider = {
    ...approvedProviderVerification(),
    accountStatus: "pending",
    licenseNumber: "LIC-1",
    licenseState: "TX",
    licenseVerifiedAt: null,
    licenseVerifiedByUserId: null,
    insuranceProvider: "Example Mutual",
    insurancePolicyNumber: "POL-1",
    insuranceVerifiedAt: null,
    insuranceVerifiedByUserId: null,
    user: { email: "provider@example.com" },
    updatedAt: new Date("2026-08-12T12:00:00.000Z"),
  };
  state.batches = [];
  state.transactionError = null;
  state.credentials.mockResolvedValue({ license: { id: "private-document", url: "/api/provider/credentials/private-document" } });
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
      ...LICENSE_REVIEW,
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
    expect(data).toMatchObject({ licenseVerifiedDocumentChecksum: LICENSE_REVIEW.licenseDocumentChecksum,
      licenseExpiresAt: new Date("2099-01-01T00:00:00Z") });
    expect(state.batches[0].find((entry) => entry.model === "mediaAsset")?.args).toMatchObject({
      where: { id: LICENSE_REVIEW.licenseDocumentId, checksum: LICENSE_REVIEW.licenseDocumentChecksum, providerProfileId: "provider-profile-1" },
      data: { credentialReviewStatus: "approved", credentialReviewedByUserId: ADMIN.id, credentialExpiresAt: new Date("2099-01-01") },
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
      ...LICENSE_REVIEW,
      ...INSURANCE_REVIEW,
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

  it.each([
    { id: "replaced-document" }, { checksum: "changed-bytes" },
    { providerProfileId: "another-provider" }, { purpose: "amenity_gallery" },
    { status: "removed" }, { credentialSnapshot: { licenseNumber: "LIC-2", licenseState: "TX" } },
  ])("refuses to approve mismatched or replaced evidence: %j", async (change) => {
    state.provider!.licenseDocument = { ...(state.provider!.licenseDocument as Record<string, unknown>), ...change };
    await expect(updateProviderAdministration(ADMIN, "p1", {
      license: "verify", ...LICENSE_REVIEW, expectedUpdatedAt: "2026-08-12T12:00:00.000Z",
    })).rejects.toMatchObject({ status: 409 });
    expect(state.batches).toEqual([]);
  });

  it("does not let a caller replay another document or checksum against the current review", async () => {
    await expect(updateProviderAdministration(ADMIN, "p1", {
      license: "verify", ...LICENSE_REVIEW, licenseDocumentId: "old-document", licenseDocumentChecksum: "old-checksum",
      expectedUpdatedAt: "2026-08-12T12:00:00.000Z",
    })).rejects.toMatchObject({ status: 409 });
    expect(state.batches).toEqual([]);
  });

  it.each(["2000-01-01", "2099-02-30", "invalid"])("refuses an expired or invalid confirmed expiration: %s", async (licenseExpiresOn) => {
    await expect(updateProviderAdministration(ADMIN, "p1", {
      license: "verify", ...LICENSE_REVIEW, licenseExpiresOn, expectedUpdatedAt: "2026-08-12T12:00:00.000Z",
    })).rejects.toMatchObject({ status: 422 });
    expect(state.batches).toEqual([]);
  });

  it("records a rejection reason while clearing the rejected credential approval", async () => {
    await updateProviderAdministration(ADMIN, "p1", {
      insurance: "reject", ...INSURANCE_REVIEW, note: "The certificate does not name this provider.", expectedUpdatedAt: "2026-08-12T12:00:00.000Z",
    });
    expect(updateData()).toMatchObject({ insuranceVerifiedAt: null, insuranceExpiresAt: null,
      insuranceVerifiedDocumentChecksum: null, insuranceCoverageCents: null, insuranceAdditionalInsured: false });
    expect(state.batches[0].find((entry) => entry.model === "mediaAsset")?.args.data).toMatchObject({
      credentialReviewStatus: "rejected", credentialReviewReason: "The certificate does not name this provider.", credentialReviewedByUserId: ADMIN.id,
    });
    expect(auditCount()).toBe(1);
  });

  it("requires a rejection reason and writes nothing without one", async () => {
    await expect(updateProviderAdministration(ADMIN, "p1", {
      insurance: "reject", expectedUpdatedAt: "2026-08-12T12:00:00.000Z",
    })).rejects.toMatchObject({ status: 422 });
    expect(state.batches).toEqual([]);
  });

  it("returns stale review when replacement wins the write race", async () => {
    state.transactionError = { code: "P2025" };
    await expect(updateProviderAdministration(ADMIN, "p1", {
      license: "verify", ...LICENSE_REVIEW, expectedUpdatedAt: "2026-08-12T12:00:00.000Z",
    })).rejects.toMatchObject({ code: "stale_review", status: 409 });
    expect(state.batches).toEqual([]);
  });

  it.each(["verify", "revoke", "reject"] as const)("denies an operations staff member's %s credential intent at the service boundary", async (intent) => {
    await expect(updateProviderAdministration({ id: "staff-1", adminIsStaffAccount: true }, "p1", {
      license: intent, ...LICENSE_REVIEW, note: "Staff attempted review", expectedUpdatedAt: "2026-08-12T12:00:00.000Z",
    })).rejects.toMatchObject({ status: 403 });
    expect(state.batches).toEqual([]);
  });

  it("preserves operations staff account-status changes without credential authority", async () => {
    await expect(updateProviderAdministration({ id: "staff-1", adminIsStaffAccount: true }, "p1", {
      accountStatus: "suspended", expectedUpdatedAt: "2026-08-12T12:00:00.000Z",
    })).resolves.toEqual({ changed: true });
    expect(updateData()).toMatchObject({ accountStatus: "suspended", accountStatusUpdatedByUserId: "staff-1" });
    expect(updateData()).not.toHaveProperty("licenseVerifiedAt");
  });
});

describe("operations provider detail redaction", () => {
  it("keeps account and contact data while skipping the private credential loader entirely", async () => {
    Object.assign(state.provider!, { userId: "p1", companyName: "Example provider", trades: ["cleaning"], createdAt: new Date("2026-01-01"),
      user: { id: "p1", fullName: "Example Provider", email: "provider@example.invalid", role: "provider", avatarUrl: null, neighborhood: null, phone: "555-0100" } });
    const detail = await getProviderDetail("p1", { includeCredentials: false });
    expect(detail).toMatchObject({ companyName: "Example provider", phone: "555-0100", credentials: null });
    expect(state.credentials).not.toHaveBeenCalled();
    expect(JSON.stringify(detail)).not.toMatch(/api\/provider\/credentials|private-document|storageUrl|storagePath/);
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

describe("staff credential review request boundary", () => {
  it("accepts an exact document review with an explicit expiry and row version", () => {
    expect(providerAdminUpdateSchema.safeParse({ license: "verify", ...LICENSE_REVIEW,
      expectedUpdatedAt: "2026-08-12T12:00:00.000Z" }).success).toBe(true);
  });

  it.each(["licenseDocumentId", "licenseDocumentChecksum", "licenseExpiresOn", "expectedUpdatedAt"])("requires %s for approval", (field) => {
    const body: Record<string, unknown> = { license: "verify", ...LICENSE_REVIEW, expectedUpdatedAt: "2026-08-12T12:00:00.000Z" };
    delete body[field];
    expect(providerAdminUpdateSchema.safeParse(body).success).toBe(false);
  });

  it.each([
    { insuranceCoverageCents: -1 }, { insuranceCoverageCents: 1.5 },
    { insuranceCoverageCents: undefined }, { insuranceAdditionalInsured: undefined },
    { storageUrl: "https://attacker.invalid/document" },
  ])("rejects missing or invalid insurance terms and client storage URLs: %j", (change) => {
    expect(providerAdminUpdateSchema.safeParse({ insurance: "verify", ...INSURANCE_REVIEW,
      expectedUpdatedAt: "2026-08-12T12:00:00.000Z", ...change }).success).toBe(false);
  });
});
