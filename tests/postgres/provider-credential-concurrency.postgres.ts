import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

// Identity and the limiter's remote transport are the only service stubs.
// Authorization, active grants, provider policy, writes and audit rows are real.
const session = vi.hoisted(() => ({ clerkId: null as string | null }));
vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId: session.clerkId }) }));
vi.mock("@/lib/server/rate-limit", async (importActual) => ({
  ...await importActual<typeof import("@/lib/server/rate-limit")>(),
  isRedisConfigured: () => true,
  consumeRateLimit: async () => ({ success: true, retryAfterSeconds: 0 }),
}));

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

let barrier: { armed: boolean; read: ReturnType<typeof deferred>; release: ReturnType<typeof deferred> } | null = null;
let transactionTrace: Array<{ operation: string; rows?: number }> | null = null;
const adapter = new PrismaPg({ connectionString: process.env.TEST_DATABASE_URL! });
const connect = adapter.connect.bind(adapter);
adapter.connect = async () => {
  const connection = await connect();
  const start = connection.startTransaction.bind(connection);
  connection.startTransaction = async (...args) => {
    const transaction = await start(...args);
    const queryRaw = transaction.queryRaw.bind(transaction);
    transaction.queryRaw = async (query) => {
      const result = await queryRaw(query);
      if (transactionTrace) {
        for (const model of ["User", "ProviderProfile"]) {
          if (new RegExp(`UPDATE\\s+(?:"[^"]+"\\.)?"${model}"`).test(query.sql)) {
            transactionTrace.push({ operation: `update ${model}`, rows: result.rows.length });
          }
        }
      }
      return result;
    };
    const rollback = transaction.rollback.bind(transaction);
    transaction.rollback = async () => {
      const result = await rollback();
      transactionTrace?.push({ operation: "rollback" });
      return result;
    };
    return transaction;
  };
  return connection;
};
const client = new PrismaClient({ adapter });
const observed = client.$extends({ query: { providerProfile: {
  async findUnique({ args, query }) {
    // Execute actual SQL first. Never replace a database result or a write.
    const row = await query(args);
    if (barrier?.armed && args.select?.licenseNumber && args.select?.licenseState) {
      const paused = barrier;
      paused.armed = false;
      paused.read.resolve();
      await paused.release.promise;
    }
    return row;
  },
} } });
// The production lazy singleton and every transaction use this real client.
(globalThis as unknown as { prisma: unknown }).prisma = observed;

let providerRoute: typeof import("@/app/api/profile/provider/route");
let adminRoute: typeof import("@/app/api/admin/providers/[userId]/route");
const run = randomUUID();
const ids: string[] = [];

function request(method: "PATCH" | "PUT", body: unknown) {
  return new Request("http://localhost/api/profile/provider", {
    method, headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
}

async function fixture() {
  const suffix = `${run}-${ids.length}`;
  const provider = await client.user.create({ data: {
    clerkUserId: `pg-provider-${suffix}`, email: `pg-provider-${suffix}@example.invalid`,
    fullName: "Original name", role: "provider", isVerified: true,
    providerProfile: { create: {
      accountStatus: "active", companyName: "Original company",
      licenseNumber: "CLAIM-X", licenseState: "TX",
      insuranceProvider: "INSURER-X", insurancePolicyNumber: "POLICY-X",
    } },
  } });
  ids.push(provider.id);
  const admin = await client.user.create({ data: {
    clerkUserId: `pg-admin-${suffix}`, email: `pg-admin-${suffix}@example.invalid`,
    fullName: "Reviewer", role: "admin", isVerified: true,
    adminAccess: { create: { email: `pg-admin-${suffix}@example.invalid`, status: "active", level: "admin" } },
  } });
  ids.push(admin.id);
  return { provider, admin };
}

async function verify(userId: string, clerkId: string, credentials: { license?: "verify"; insurance?: "verify" }) {
  const row = await client.providerProfile.findUniqueOrThrow({ where: { userId } });
  session.clerkId = clerkId;
  return adminRoute.PATCH(request("PATCH", { ...credentials, expectedUpdatedAt: row.updatedAt.toISOString() }),
    { params: Promise.resolve({ userId }) });
}

function save(method: "PATCH" | "PUT", business: Record<string, unknown>) {
  return providerRoute[method](request(method, method === "PUT"
    ? { common: { fullName: "Saved name" }, provider: business } : business));
}

const matrix = [
  ["PATCH", "license"], ["PUT", "license"],
  ["PATCH", "insurance"], ["PUT", "insurance"],
] as const;

beforeAll(async () => {
  [providerRoute, adminRoute] = await Promise.all([
    import("@/app/api/profile/provider/route"), import("@/app/api/admin/providers/[userId]/route"),
  ]);
});

afterAll(async () => {
  barrier?.release.resolve();
  // Audit history is append-only, including for test actors. Leave these
  // uniquely named fixtures in this disposable database; never bypass triggers.
  await client.$disconnect();
  delete (globalThis as unknown as { prisma?: unknown }).prisma;
});

describe("provider credential edits cannot inherit another claim's staff verification", () => {
  it.each(matrix)("rejects stale %s after a different %s claim is verified", async (method, credential) => {
    const { provider, admin } = await fixture();
    const oldClaim = credential === "license"
      ? { licenseNumber: "CLAIM-X", licenseState: "TX" }
      : { insuranceProvider: "INSURER-X", insurancePolicyNumber: "POLICY-X" };
    const newClaim = credential === "license"
      ? { licenseNumber: "CLAIM-Y", licenseState: "CA" }
      : { insuranceProvider: "INSURER-Y", insurancePolicyNumber: "POLICY-Y" };
    session.clerkId = provider.clerkUserId;
    barrier = { armed: true, read: deferred(), release: deferred() };
    const delayed = providerRoute[method](request(method, method === "PUT"
      ? { common: { fullName: "Delayed overwrite" }, provider: { ...oldClaim, companyName: "Delayed company" } }
      : { ...oldClaim, companyName: "Delayed company" }));

    try {
      await Promise.race([
        barrier.read.promise,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Credential read barrier was not reached.")), 5_000)),
      ]);
      expect((await providerRoute.PATCH(request("PATCH", newClaim))).status).toBe(200);
      const reviewed = await client.providerProfile.findUniqueOrThrow({ where: { userId: provider.id } });
      session.clerkId = admin.clerkUserId;
      const verified = await adminRoute.PATCH(request("PATCH", {
        [credential]: "verify", expectedUpdatedAt: reviewed.updatedAt.toISOString(),
      }), { params: Promise.resolve({ userId: provider.id }) });
      expect(verified.status).toBe(200);
      const before = await client.providerProfile.findUniqueOrThrow({ where: { userId: provider.id } });
      const userBefore = await client.user.findUniqueOrThrow({ where: { id: provider.id } });
      const auditBefore = await client.adminAuditLog.findMany({ where: { providerUserId: provider.id }, orderBy: { id: "asc" } });
      expect(before[credential === "license" ? "licenseVerifiedAt" : "insuranceVerifiedAt"]).not.toBeNull();
      expect(auditBefore.map((entry) => entry.action)).toEqual([credential === "license" ? "provider_license_verified" : "provider_insurance_verified"]);

      transactionTrace = [];
      barrier.release.resolve();
      const response = await delayed;
      const after = await client.providerProfile.findUniqueOrThrow({ where: { userId: provider.id } });
      // Include persisted state in a sanitized failure, without identities or URLs.
      expect({ status: response.status, company: after.companyName,
        claim: credential === "license" ? after.licenseNumber : after.insuranceProvider,
        verified: after[credential === "license" ? "licenseVerifiedAt" : "insuranceVerifiedAt"] !== null,
      }).toEqual({ status: 409, company: "Original company",
        claim: credential === "license" ? "CLAIM-Y" : "INSURER-Y", verified: true });
      expect(after).toEqual(before);
      expect(await client.user.findUniqueOrThrow({ where: { id: provider.id } })).toEqual(userBefore);
      expect(await client.adminAuditLog.findMany({ where: { providerUserId: provider.id }, orderBy: { id: "asc" } })).toEqual(auditBefore);
      if (method === "PUT") {
        // Real adapter results establish that the first common-row write
        // succeeded inside the transaction before CAS failed and rolled back.
        expect(transactionTrace).toEqual([
          { operation: "update User", rows: 1 },
          { operation: "update ProviderProfile", rows: 0 },
          { operation: "rollback" },
        ]);
      }
    } finally {
      barrier.release.resolve();
      await delayed;
      barrier = null;
      transactionTrace = null;
    }
  });

  it.each(matrix)("preserves unchanged claims and revokes only changed %s %s credentials with audits", async (method, credential) => {
    const { provider, admin } = await fixture();
    expect((await verify(provider.id, admin.clerkUserId, { license: "verify", insurance: "verify" })).status).toBe(200);
    const before = await client.providerProfile.findUniqueOrThrow({ where: { userId: provider.id } });
    session.clerkId = provider.clerkUserId;
    expect((await save(method, { companyName: "Updated company", licenseNumber: "CLAIM-X", licenseState: "TX",
      insuranceProvider: "INSURER-X", insurancePolicyNumber: "POLICY-X" })).status).toBe(200);
    const unchanged = await client.providerProfile.findUniqueOrThrow({ where: { userId: provider.id } });
    expect(unchanged.licenseVerifiedAt).toEqual(before.licenseVerifiedAt);
    expect(unchanged.insuranceVerifiedAt).toEqual(before.insuranceVerifiedAt);
    expect(unchanged.licenseVerifiedByUserId).toBe(admin.id);
    expect(unchanged.insuranceVerifiedByUserId).toBe(admin.id);
    expect(unchanged.companyName).toBe("Updated company");
    expect(await client.adminAuditLog.count({ where: { providerUserId: provider.id } })).toBe(2);

    const changed = credential === "license" ? { licenseNumber: "CLAIM-Y" } : { insurancePolicyNumber: "POLICY-Y" };
    const response = await save(method, changed);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect((method === "PUT" ? body.provider : body)[credential === "license" ? "isLicenseVerified" : "isInsuranceVerified"]).toBe(false);
    const after = await client.providerProfile.findUniqueOrThrow({ where: { userId: provider.id } });
    expect(after[credential === "license" ? "licenseVerifiedAt" : "insuranceVerifiedAt"]).toBeNull();
    expect(after[credential === "license" ? "licenseVerifiedByUserId" : "insuranceVerifiedByUserId"]).toBeNull();
    expect(after[credential === "license" ? "insuranceVerifiedAt" : "licenseVerifiedAt"]).toEqual(before[credential === "license" ? "insuranceVerifiedAt" : "licenseVerifiedAt"]);
    const audits = await client.adminAuditLog.findMany({ where: { providerUserId: provider.id }, orderBy: { createdAt: "asc" } });
    expect(audits).toHaveLength(3);
    expect(audits[2]).toMatchObject({ action: credential === "license" ? "provider_license_revoked" : "provider_insurance_revoked", actorUserId: null });
  });

  it.each(matrix)("rejects an in-flight staff verification overtaken by %s %s editing", async (method, credential) => {
    const { provider, admin } = await fixture();
    const reviewed = await client.providerProfile.findUniqueOrThrow({ where: { userId: provider.id } });
    session.clerkId = admin.clerkUserId;
    barrier = { armed: true, read: deferred(), release: deferred() };
    const delayed = adminRoute.PATCH(request("PATCH", {
      [credential]: "verify", expectedUpdatedAt: reviewed.updatedAt.toISOString(),
    }), { params: Promise.resolve({ userId: provider.id }) });
    try {
      await Promise.race([
        barrier.read.promise,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Staff read barrier was not reached.")), 5_000)),
      ]);
      session.clerkId = provider.clerkUserId;
      expect((await save(method, credential === "license"
        ? { licenseNumber: "CLAIM-Y", licenseState: "CA" }
        : { insuranceProvider: "INSURER-Y", insurancePolicyNumber: "POLICY-Y" })).status).toBe(200);
      const before = await client.providerProfile.findUniqueOrThrow({ where: { userId: provider.id } });
      const userBefore = await client.user.findUniqueOrThrow({ where: { id: provider.id } });
      transactionTrace = [];
      barrier.release.resolve();
      expect((await delayed).status).toBe(409);
      expect(await client.providerProfile.findUniqueOrThrow({ where: { userId: provider.id } })).toEqual(before);
      expect(await client.user.findUniqueOrThrow({ where: { id: provider.id } })).toEqual(userBefore);
      expect(before.licenseVerifiedAt).toBeNull();
      expect(before.insuranceVerifiedAt).toBeNull();
      expect(await client.adminAuditLog.count({ where: { providerUserId: provider.id } })).toBe(0);
      expect(transactionTrace).toEqual([
        { operation: "update ProviderProfile", rows: 0 }, { operation: "rollback" },
      ]);
    } finally {
      barrier.release.resolve();
      await delayed;
      barrier = null;
      transactionTrace = null;
    }
  });

  it.each(matrix)("advances same-millisecond %s %s versions and rejects stale staff review", async (method, credential) => {
    const { provider, admin } = await fixture();
    const initial = await client.providerProfile.findUniqueOrThrow({ where: { userId: provider.id } });
    const clock = vi.spyOn(Date, "now").mockReturnValue(initial.updatedAt.getTime());
    try {
      expect((await verify(provider.id, admin.clerkUserId, { [credential]: "verify" })).status).toBe(200);
      const reviewed = await client.providerProfile.findUniqueOrThrow({ where: { userId: provider.id } });
      expect(reviewed.updatedAt.getTime()).toBe(initial.updatedAt.getTime() + 1);
      session.clerkId = provider.clerkUserId;
      expect((await save(method, credential === "license" ? { licenseNumber: "CLAIM-Y" } : { insuranceProvider: "INSURER-Y" })).status).toBe(200);
      const changed = await client.providerProfile.findUniqueOrThrow({ where: { userId: provider.id } });
      expect(changed.updatedAt.getTime()).toBe(initial.updatedAt.getTime() + 2);
      const auditCount = await client.adminAuditLog.count({ where: { providerUserId: provider.id } });
      session.clerkId = admin.clerkUserId;
      const stale = await adminRoute.PATCH(request("PATCH", { [credential]: "verify", expectedUpdatedAt: reviewed.updatedAt.toISOString() }),
        { params: Promise.resolve({ userId: provider.id }) });
      expect(stale.status).toBe(409);
      expect(await client.providerProfile.findUniqueOrThrow({ where: { userId: provider.id } })).toEqual(changed);
      expect(await client.adminAuditLog.count({ where: { providerUserId: provider.id } })).toBe(auditCount);
      expect((await verify(provider.id, admin.clerkUserId, { [credential]: "verify" })).status).toBe(200);
      expect((await client.providerProfile.findUniqueOrThrow({ where: { userId: provider.id } })).updatedAt.getTime()).toBe(initial.updatedAt.getTime() + 3);
    } finally { clock.mockRestore(); }
  });

  it.each([ ["PATCH", "suspended"], ["PUT", "suspended"], ["PATCH", "homeowner"], ["PUT", "homeowner"] ] as const)(
    "rejects %s from a database-backed %s account without writes", async (method, authority) => {
      const { provider } = await fixture();
      if (authority === "suspended") await client.providerProfile.update({ where: { userId: provider.id }, data: { accountStatus: "suspended" } });
      else await client.user.update({ where: { id: provider.id }, data: { role: "homeowner" } });
      const before = await client.providerProfile.findUniqueOrThrow({ where: { userId: provider.id } });
      const userBefore = await client.user.findUniqueOrThrow({ where: { id: provider.id } });
      session.clerkId = provider.clerkUserId;
      expect((await save(method, { companyName: "Forbidden change" })).status).toBe(403);
      expect(await client.providerProfile.findUniqueOrThrow({ where: { userId: provider.id } })).toEqual(before);
      expect(await client.user.findUniqueOrThrow({ where: { id: provider.id } })).toEqual(userBefore);
      expect(await client.adminAuditLog.count({ where: { providerUserId: provider.id } })).toBe(0);
    },
  );
});
