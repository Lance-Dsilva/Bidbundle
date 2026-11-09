import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { providerVerificationSelect, providerVerificationState } from "@/lib/provider-verification";

// Only the remote Blob transport is substituted. Database rows, constraints,
// domain rules, transactions, revisions, audit and notification writes are real.
const transport = vi.hoisted(() => ({ put: vi.fn(async () => ({})), del: vi.fn(async (_path: string, _options?: unknown) => undefined), get: vi.fn() }));
vi.mock("@vercel/blob", () => transport);
function deferred() { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done; }); return { promise, resolve }; }
let pause: { table: "profile" | "user" | "policy"; userId: string; read: ReturnType<typeof deferred>; release: ReturnType<typeof deferred> } | null = null;
const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.TEST_DATABASE_URL! }) });
const observed = client.$extends({ query: {
  providerProfile: { async findUnique({ args, query }) {
    const result = await query(args);
    if (pause?.table === "profile" && args.where.userId === pause.userId) { const held = pause; pause = null; held.read.resolve(); await held.release.promise; }
    return result;
  } },
  user: { async findUnique({ args, query }) {
    const result = await query(args);
    if (pause?.table === "user" && args.where.id === pause.userId && args.select?.providerProfile) { const held = pause; pause = null; held.read.resolve(); await held.release.promise; }
    return result;
  } },
  hoaProfile: { async findUnique({ args, query }) {
    const result = await query(args);
    if (pause?.table === "policy" && args.where.communityId === pause.userId) { const held = pause; pause = null; held.read.resolve(); await held.release.promise; }
    return result;
  } },
} });
(globalThis as unknown as { prisma: unknown }).prisma = observed;
let documents: typeof import("@/lib/server/provider-credentials");
let administration: typeof import("@/lib/server/providers-admin");
let marketplace: typeof import("@/lib/server/hoa-market");
let expiry: typeof import("@/lib/server/provider-credential-expiry");
let policy: typeof import("@/lib/server/provider-policy");
const pending: Array<Promise<unknown>> = [];
const holds: Array<ReturnType<typeof deferred>> = [];
const previousToken = process.env.PROVIDER_DOCUMENT_BLOB_READ_WRITE_TOKEN;

function hold(table: "profile" | "user" | "policy", userId: string) {
  const held = { table, userId, read: deferred(), release: deferred() };
  holds.push(held.release); pause = held; return held;
}
function track<T>(promise: Promise<T>) { pending.push(promise); void promise.catch(() => undefined); return promise; }
async function reached(held: ReturnType<typeof hold>) {
  await Promise.race([held.read.promise, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Production read barrier not reached.")), 5000))]);
}
function pdf(label: string) { return new Blob([`%PDF-1.7\n${label}\n%%EOF`], { type: "application/pdf" }); }
async function fixture() {
  const tag = `credential51-${randomUUID()}`;
  const provider = await client.user.create({ data: {
    clerkUserId: tag, email: `${tag}@example.invalid`, fullName: "Isolated provider", role: "provider", isVerified: true,
    providerProfile: { create: { accountStatus: "active", trades: ["cleaning"], companyName: "Fixture provider",
      licenseNumber: "FIXTURE-LICENSE", licenseState: "TX", insuranceProvider: "Fixture insurer", insurancePolicyNumber: "FIXTURE-POLICY" } },
  } });
  const admin = await client.user.create({ data: { clerkUserId: `${tag}-reviewer`, email: `${tag}-reviewer@example.invalid`, fullName: "Isolated reviewer", role: "admin", isVerified: true,
    adminAccess: { create: { email: `${tag}-reviewer@example.invalid`, status: "active", level: "admin" } } } });
  return { provider, admin };
}
async function reviewInput(userId: string, kind: "license" | "insurance") {
  const profile = await client.providerProfile.findUniqueOrThrow({ where: { userId }, include: { licenseDocument: true, insuranceDocument: true } });
  const document = kind === "license" ? profile.licenseDocument! : profile.insuranceDocument!;
  return { [kind]: "verify", expectedUpdatedAt: profile.updatedAt.toISOString(),
    [`${kind}DocumentId`]: document.id, [`${kind}DocumentChecksum`]: document.checksum, [`${kind}ExpiresOn`]: "2099-12-31",
    ...(kind === "insurance" ? { insuranceCoverageCents: 100_000_000, insuranceAdditionalInsured: true } : {}),
  } as Parameters<typeof administration.updateProviderAdministration>[2];
}
async function approveBoth(f: Awaited<ReturnType<typeof fixture>>) {
  for (const kind of ["license", "insurance"] as const) {
    await documents.storeProviderCredential(f.provider.id, kind, pdf(kind));
    await administration.updateProviderAdministration(f.admin, f.provider.id, await reviewInput(f.provider.id, kind));
  }
}
async function requestFixture(f: Awaited<ReturnType<typeof fixture>>) {
  const tag = `award51-${randomUUID()}`;
  const manager = await client.user.create({ data: { clerkUserId: tag, email: `${tag}@example.invalid`, fullName: "Isolated manager", role: "hoa_staff" } });
  const community = await client.community.create({ data: { name: tag, type: "hoa", hoaProfile: { create: { legalName: tag,
    addressLine1: "1 Test St", locality: "Austin", region: "TX", postalCode: "78758", totalHomes: 1,
    minimumInsuranceCoverageCents: 50_000_000, requiresAdditionalInsured: true,
  } } } });
  await client.communityStaffAssignment.create({ data: { communityId: community.id, userId: manager.id, role: "hoa_manager", status: "active" } });
  const unit = await client.communityUnit.create({ data: { communityId: community.id, label: "Fixture unit" } });
  const request = await client.hoaServiceRequest.create({ data: { communityId: community.id, createdByUserId: manager.id, title: tag,
    category: "cleaning", description: "Owned credential award regression", kind: "compulsory_recurring", recurrenceLabel: "Daily", status: "draft",
    totalOccurrences: 2, recurrenceIntervalDays: 1, biddingClosesAt: new Date(Date.now() + 3_600_000),
  } });
  await client.hoaRequestParticipation.create({ data: { requestId: request.id, unitId: unit.id, response: "joined" } });
  await client.hoaServiceRequest.update({ where: { id: request.id }, data: { status: "open_for_bids", participantsLockedAt: new Date() } });
  const bid = await client.serviceBid.create({ data: { requestId: request.id, providerUserId: f.provider.id, amountCents: 10_000, currency: "usd", pricingBasis: "total", scope: "Fixture whole job" } });
  return { community, manager, request, bid };
}
async function noAwardEffects(f: Awaited<ReturnType<typeof requestFixture>>) {
  expect(await client.serviceAgreement.count({ where: { requestId: f.request.id } })).toBe(0);
  expect((await client.serviceBid.findUniqueOrThrow({ where: { id: f.bid.id } })).status).toBe("submitted");
  expect((await client.hoaServiceRequest.findUniqueOrThrow({ where: { id: f.request.id } })).status).toBe("open_for_bids");
  expect(await client.adminAuditLog.count({ where: { communityId: f.community.id } })).toBe(0);
}
beforeAll(async () => {
  process.env.PROVIDER_DOCUMENT_BLOB_READ_WRITE_TOKEN = "issue51-disposable-private-transport-only";
  [documents, administration, marketplace, expiry, policy] = await Promise.all([
    import("@/lib/server/provider-credentials"), import("@/lib/server/providers-admin"), import("@/lib/server/hoa-market"),
    import("@/lib/server/provider-credential-expiry"), import("@/lib/server/provider-policy"),
  ]);
});
afterEach(async () => { pause = null; for (const release of holds.splice(0)) release.resolve(); await Promise.allSettled(pending.splice(0)); vi.clearAllMocks(); });
afterAll(async () => { await client.$disconnect(); delete (globalThis as unknown as { prisma?: unknown }).prisma;
  if (previousToken === undefined) delete process.env.PROVIDER_DOCUMENT_BLOB_READ_WRITE_TOKEN; else process.env.PROVIDER_DOCUMENT_BLOB_READ_WRITE_TOKEN = previousToken;
  // Keep append-only audit and uniquely named fixtures until the owned
  // disposable container is destroyed. Never truncate application tables.
});

describe("actual PostgreSQL private credential binding and transaction races", () => {
  it("replaces approved bytes atomically and revokes only that credential", async () => {
    const f = await fixture(); await approveBoth(f);
    const before = await client.providerProfile.findUniqueOrThrow({ where: { userId: f.provider.id } });
    const id = await documents.storeProviderCredential(f.provider.id, "license", pdf("new license"));
    const after = await client.providerProfile.findUniqueOrThrow({ where: { userId: f.provider.id }, select: providerVerificationSelect });
    expect(after.licenseDocumentId).toBe(id); expect(after.licenseVerifiedAt).toBeNull();
    expect(after.insuranceVerifiedAt).toEqual(before.insuranceVerifiedAt);
    expect(providerVerificationState(after)).toEqual({ license: false, insurance: true, verified: false });
    const asset = await client.mediaAsset.findUniqueOrThrow({ where: { id } });
    expect(asset).toMatchObject({ communityId: null, purpose: "provider_license", storageUrl: "", credentialReviewStatus: "pending" });
    expect((await client.mediaAsset.findUniqueOrThrow({ where: { id: before.licenseDocumentId! } })).status).toBe("removed");
    expect(await documents.loadProviderCredentialForAccess(id, { userId: "unrelated", canReviewProviders: false })).toBeNull();
    expect(await documents.loadProviderCredentialForAccess(id, { userId: f.provider.id, canReviewProviders: false })).not.toBeNull();
  });

  it("rejects prepared approval after the document is replaced, with no review/audit writes", async () => {
    const f = await fixture(); await documents.storeProviderCredential(f.provider.id, "license", pdf("old"));
    const input = await reviewInput(f.provider.id, "license");
    const held = hold("profile", f.provider.id);
    const delayed = track(administration.updateProviderAdministration(f.admin, f.provider.id, input));
    await reached(held);
    const current = await documents.storeProviderCredential(f.provider.id, "license", pdf("replacement"));
    const before = await client.providerProfile.findUniqueOrThrow({ where: { userId: f.provider.id } });
    const audit = await client.adminAuditLog.count({ where: { providerUserId: f.provider.id } });
    held.release.resolve(); await expect(delayed).rejects.toThrow(/reload|changed|review/i);
    expect(await client.providerProfile.findUniqueOrThrow({ where: { userId: f.provider.id } })).toEqual(before);
    expect((await client.mediaAsset.findUniqueOrThrow({ where: { id: current } })).credentialReviewStatus).toBe("pending");
    expect(await client.adminAuditLog.count({ where: { providerUserId: f.provider.id } })).toBe(audit);
  });

  it("rolls back an in-flight replacement overtaken by approval and cleans up only its orphan blob", async () => {
    const f = await fixture(); const id = await documents.storeProviderCredential(f.provider.id, "license", pdf("old"));
    const input = await reviewInput(f.provider.id, "license");
    const held = hold("profile", f.provider.id);
    const delayed = track(documents.storeProviderCredential(f.provider.id, "license", pdf("delayed replacement")));
    await reached(held);
    await administration.updateProviderAdministration(f.admin, f.provider.id, input);
    const before = await client.providerProfile.findUniqueOrThrow({ where: { userId: f.provider.id } });
    const audit = await client.adminAuditLog.count({ where: { providerUserId: f.provider.id } });
    held.release.resolve(); await expect(delayed).rejects.toThrow(/changed|reload/i);
    expect(await client.providerProfile.findUniqueOrThrow({ where: { userId: f.provider.id } })).toEqual(before);
    expect(await client.mediaAsset.count({ where: { providerProfileId: before.id } })).toBe(1);
    expect(before.licenseDocumentId).toBe(id); expect(before.licenseVerifiedAt).not.toBeNull();
    expect(await client.adminAuditLog.count({ where: { providerUserId: f.provider.id } })).toBe(audit);
    expect(transport.del).toHaveBeenCalledTimes(1);
    expect(transport.del.mock.calls[0]?.[0]).not.toContain(id);
  });

  it.each(["public-url", "missing-owner", "executable-type"])("database rejects credential evidence with %s", async (bad) => {
    const f = await fixture(); const profile = await client.providerProfile.findUniqueOrThrow({ where: { userId: f.provider.id } });
    const id = randomUUID();
    await expect(client.mediaAsset.create({ data: { id, purpose: "provider_license", providerProfileId: bad === "missing-owner" ? null : profile.id,
      uploaderUserId: f.provider.id, storagePath: `fixture/${id}`, storageUrl: bad === "public-url" ? "https://example.invalid/private.pdf" : "",
      contentType: bad === "executable-type" ? "application/javascript" : "application/pdf", byteSize: 20, checksum: "a".repeat(64),
      credentialSnapshot: { licenseNumber: profile.licenseNumber, licenseState: profile.licenseState },
    } })).rejects.toThrow(/MediaAsset_(?:one_owner|supported_type)/);
    expect(await client.mediaAsset.count({ where: { id } })).toBe(0);
  });

  it.each(["coverage", "additional-insured", "expiry"])("blocks a new HOA award for invalid %s before any award effect", async (bad) => {
    const f = await fixture(); await approveBoth(f); const request = await requestFixture(f);
    if (bad === "coverage") await client.hoaProfile.update({ where: { communityId: request.community.id }, data: { minimumInsuranceCoverageCents: 200_000_000 } });
    if (bad === "additional-insured") await client.providerProfile.update({ where: { userId: f.provider.id }, data: { insuranceAdditionalInsured: false } });
    if (bad === "expiry") await client.providerProfile.update({ where: { userId: f.provider.id }, data: { licenseExpiresAt: new Date("2000-01-01T00:00:00Z") } });
    await expect(marketplace.awardBid(request.manager.id, request.request.id, { bidId: request.bid.id })).rejects.toThrow(/insurance|credential|verified|coverage/i);
    await noAwardEffects(request);
  });

  it.each(["credential", "HOA-policy"])("prepared award rechecks concurrent %s changes transactionally", async (change) => {
    const f = await fixture(); await approveBoth(f); const request = await requestFixture(f);
    const held = hold("user", f.provider.id);
    const delayed = track(marketplace.awardBid(request.manager.id, request.request.id, { bidId: request.bid.id }));
    await reached(held);
    if (change === "credential") {
      const profile = await client.providerProfile.findUniqueOrThrow({ where: { userId: f.provider.id } });
      await administration.updateProviderAdministration(f.admin, f.provider.id, { license: "revoke", expectedUpdatedAt: profile.updatedAt.toISOString() });
    } else await client.hoaProfile.update({ where: { communityId: request.community.id }, data: { minimumInsuranceCoverageCents: 200_000_000 } });
    held.release.resolve(); await expect(delayed).rejects.toThrow(/changed|review|reload|credential|insurance/i);
    await noAwardEffects(request);
  });

  it("retains award idempotence and completion of existing work after credential expiry", async () => {
    const f = await fixture(); await approveBoth(f); const request = await requestFixture(f);
    const id = await marketplace.awardBid(request.manager.id, request.request.id, { bidId: request.bid.id });
    await client.providerProfile.update({ where: { userId: f.provider.id }, data: { licenseExpiresAt: new Date("2000-01-01T00:00:00Z") } });
    expect(await marketplace.awardBid(request.manager.id, request.request.id, { bidId: request.bid.id })).toBe(id);
    const visit = await client.serviceVisit.findFirstOrThrow({ where: { occurrence: { agreementId: id } } });
    await client.serviceVisit.update({ where: { id: visit.id }, data: { status: "in_progress" } });
    await marketplace.updateVisitStatus(f.provider.id, visit.id, { status: "completed", completionNote: "Fixture work completed" });
    expect((await client.serviceVisit.findUniqueOrThrow({ where: { id: visit.id } })).status).toBe("completed");
  });

  it("claims both 30/7-day reminders once under competing workers, then clears both expired credentials in one sweep", async () => {
    const f = await fixture();
    for (const kind of ["license", "insurance"] as const) {
      await documents.storeProviderCredential(f.provider.id, kind, pdf(`reminder ${kind}`));
      await administration.updateProviderAdministration(f.admin, f.provider.id, {
        ...await reviewInput(f.provider.id, kind), [`${kind}ExpiresOn`]: "2044-12-31",
      });
    }
    const before = await client.notification.count({ where: { userId: f.provider.id } });
    expect(await expiry.sweepProviderCredentialExpirations(new Date("2044-12-01T12:00:00Z"), 500)).toMatchObject({ remindersQueued: 2 });
    expect(await client.notification.count({ where: { userId: f.provider.id } })).toBe(before + 2);
    expect(await expiry.sweepProviderCredentialExpirations(new Date("2044-12-01T12:01:00Z"), 500)).toMatchObject({ remindersQueued: 0 });
    const competing = await Promise.all([
      expiry.sweepProviderCredentialExpirations(new Date("2044-12-24T12:00:00Z"), 500),
      expiry.sweepProviderCredentialExpirations(new Date("2044-12-24T12:00:00Z"), 500),
    ]);
    expect(competing.reduce((sum, result) => sum + result.remindersQueued, 0)).toBe(2);
    expect(await client.notification.count({ where: { userId: f.provider.id } })).toBe(before + 4);
    expect((await expiry.sweepProviderCredentialExpirations(new Date("2044-12-31T23:59:59.999Z"), 500)).expired).toBe(0);
    expect(await expiry.sweepProviderCredentialExpirations(new Date("2045-01-01T00:00:00Z"), 500)).toMatchObject({ expired: 2 });
    const current = await client.providerProfile.findUniqueOrThrow({ where: { userId: f.provider.id } });
    expect(current.licenseVerifiedAt).toBeNull(); expect(current.insuranceVerifiedAt).toBeNull();
    expect(await client.notification.count({ where: { userId: f.provider.id } })).toBe(before + 6);
    expect(await expiry.sweepProviderCredentialExpirations(new Date("2045-01-01T01:00:00Z"), 500)).toEqual({ expired: 0, remindersQueued: 0 });
  });

  it("revoked manager authority cannot apply a previously prepared insurance policy change", async () => {
    const f = await fixture(); const request = await requestFixture(f);
    const held = hold("policy", request.community.id);
    const delayed = track(policy.updateProviderPolicy(request.manager.id, request.community.id, {
      minimumInsuranceCoverageCents: 200_000_000, requiresAdditionalInsured: false,
    }));
    await reached(held);
    await client.communityStaffAssignment.updateMany({ where: { communityId: request.community.id, userId: request.manager.id }, data: { status: "revoked", revokedAt: new Date() } });
    held.release.resolve(); await expect(delayed).rejects.toThrow(/changed|authority|reload|manager|access/i);
    expect(await client.hoaProfile.findUniqueOrThrow({ where: { communityId: request.community.id } })).toMatchObject({
      minimumInsuranceCoverageCents: 50_000_000, requiresAdditionalInsured: true,
    });
    expect(await client.adminAuditLog.count({ where: { communityId: request.community.id } })).toBe(0);
  });
});
