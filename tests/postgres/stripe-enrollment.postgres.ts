import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { Client as PgClient } from "pg";
import { afterAll, describe, expect, it, vi } from "vitest";
vi.mock("@vercel/blob", () => ({ put: vi.fn(async () => ({})), del: vi.fn(async () => undefined), get: vi.fn() }));
vi.mock("next/server", async importActual => ({ ...await importActual<typeof import("next/server")>(), after: vi.fn() }));
// Substitute only the remote Stripe account verification; the award's local
// provider-account SQL lock/recheck still executes against real PostgreSQL.
vi.mock("@/lib/server/stripe-test-connect", async importActual => ({
  ...await importActual<typeof import("@/lib/server/stripe-test-connect")>(),
  requireStripeTestAwardPayouts: async (providerId: string) => {
    const client = (globalThis as unknown as { prisma: PrismaClient }).prisma;
    return (await client.providerProfile.findUniqueOrThrow({ where: { userId: providerId } })).stripeTestAccountId!;
  },
}));
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.TEST_DATABASE_URL! }) });
(globalThis as unknown as { prisma: PrismaClient }).prisma = db;
import { commitPriceLadder, acceptPriceLadder } from "@/lib/server/price-ladder";
import { awardBid, transitionHoaRequest } from "@/lib/server/hoa-market";
import { storeProviderCredential } from "@/lib/server/provider-credentials";
import { updateProviderAdministration } from "@/lib/server/providers-admin";
import { readEnrollmentAuthorization } from "@/lib/server/enrollment-authorization";
afterAll(() => db.$disconnect());

async function seed(protectedRequest = true, enableDuringAccept = false) {
  const tag = randomUUID();
  const admin = await db.user.create({ data: { clerkUserId: `admin-${tag}`, email: `admin-${tag}@example.invalid`, fullName: "Synthetic admin", role: "admin", isVerified: true,
    adminAccess: { create: { email: `admin-${tag}@example.invalid`, level: "owner", status: "active" } } } });
  const provider = await db.user.create({ data: { clerkUserId: `provider-${tag}`, email: `provider-${tag}@example.invalid`, fullName: "Synthetic provider", role: "provider",
    providerProfile: { create: { accountStatus: "active", trades: ["cleaning"], stripeTestAccountId: `acct_${tag}`, stripeTestPayoutStatus: "active" } } } });
  const community = await db.community.create({ data: { name: tag, type: "hoa", status: "active", hoaProfile: { create: { legalName: "Synthetic HOA", addressLine1: "1 Synthetic St", locality: "Austin", region: "TX", postalCode: "78758", totalHomes: 5 } } } });
  const manager = await db.user.create({ data: { clerkUserId: `manager-${tag}`, email: `manager-${tag}@example.invalid`, fullName: "Synthetic manager", role: "hoa_staff" } });
  await db.communityStaffAssignment.create({ data: { communityId: community.id, userId: manager.id, role: "hoa_manager", status: "active" } });
  const request = await db.hoaServiceRequest.create({ data: { communityId: community.id, createdByUserId: manager.id, title: "Synthetic capped enrollment", category: "cleaning", description: "Two synthetic visits", kind: "optional_group", status: "collecting_interest", enrollmentClosesAt: new Date(Date.now() + 3600000), totalOccurrences: 2, minHomes: 2 } });
  const commitment = await commitPriceLadder(admin.id, community.id, { requestId: request.id, providerUserId: provider.id, scope: "Two cleaning visits", providerAgreementConfirmed: true, tiers: [{ minHomes: 1, perHomeCents: 12000 }, { minHomes: 2, perHomeCents: 10000 }] });
  if (enableDuringAccept) vi.stubEnv("STRIPE_TEST_PAYMENTS", "1");
  try { await acceptPriceLadder(provider.id, commitment.id); }
  finally { if (enableDuringAccept) vi.unstubAllEnvs(); }
  if (protectedRequest) await db.hoaServiceRequest.update({ where: { id: request.id }, data: { stripeTestEnrollmentRequired: true } });
  const homes = [];
  for (let i = 0; i < 2; i++) {
    const user = await db.user.create({ data: { clerkUserId: `home-${i}-${tag}`, email: `home-${i}-${tag}@example.invalid`, fullName: "Synthetic homeowner", role: "homeowner", stripeTestCustomerId: `cus_${i}_${tag}`, homeownerProfile: { create: { notifyEmail: false } } } });
    const unit = await db.communityUnit.create({ data: { communityId: community.id, label: `Synthetic home ${i}`, occupancyStatus: "occupied" } });
    const membership = await db.communityMembership.create({ data: { communityId: community.id, userId: user.id, unitId: unit.id, status: "active" } });
    homes.push({ user, unit, membership });
  }
  return { admin, provider, community, manager, request, commitment, homes };
}
type Fixture = Awaited<ReturnType<typeof seed>>;
async function consent(f: Fixture, index: number, changes: { providerUserId?: string; maximumCents?: number } = {}) {
  const home = f.homes[index];
  return db.enrollmentBillingConsent.create({ data: { id: randomUUID(), requestId: f.request.id, payerUserId: home.user.id, unitId: home.unit.id, membershipId: home.membership.id, commitmentId: f.commitment.id, providerUserId: f.provider.id,
    maximumCents: 12000, currency: "usd", termsToken: `synthetic-${randomUUID()}`, termsVersion: "capped-completed-visit-v1", ...changes } });
}
async function card(f: Fixture, index: number, consentId: string, setupIntentId = `seti_${randomUUID()}`) {
  return db.enrollmentBillingCard.create({ data: { consentId, customerId: f.homes[index].user.stripeTestCustomerId!, paymentMethodId: `pm_${randomUUID()}`, setupIntentId, brand: "visa", last4: "4242" } });
}
function join(f: Fixture, index: number, consentId?: string) {
  return db.hoaRequestParticipation.create({ data: { requestId: f.request.id, userId: f.homes[index].user.id, unitId: f.homes[index].unit.id, response: "joined", enrollmentConsentId: consentId } });
}
async function credentials(f: Fixture) {
  await db.providerProfile.update({ where: { userId: f.provider.id }, data: { licenseNumber: "synthetic-license", licenseState: "TX", insuranceProvider: "synthetic-insurer", insurancePolicyNumber: "synthetic-policy" } });
  for (const kind of ["license", "insurance"] as const) {
    await storeProviderCredential(f.provider.id, kind, new Blob([`%PDF-1.7\n${kind}\n%%EOF`], { type: "application/pdf" }));
    const profile = await db.providerProfile.findUniqueOrThrow({ where: { userId: f.provider.id }, include: { licenseDocument: true, insuranceDocument: true } });
    const document = kind === "license" ? profile.licenseDocument! : profile.insuranceDocument!;
    await updateProviderAdministration(f.admin, f.provider.id, { [kind]: "verify", expectedUpdatedAt: profile.updatedAt.toISOString(), [`${kind}DocumentId`]: document.id, [`${kind}DocumentChecksum`]: document.checksum, [`${kind}ExpiresOn`]: "2099-12-31", ...(kind === "insurance" ? { insuranceCoverageCents: 100000000, insuranceAdditionalInsured: true } : {}) });
  }
}
async function readyForAward() {
  const f = await seed(); await credentials(f);
  const consents = [];
  for (let i = 0; i < 2; i++) { const accepted = await consent(f, i); await card(f, i, accepted.id); await join(f, i, accepted.id); consents.push(accepted); }
  await db.hoaServiceRequest.update({ where: { id: f.request.id }, data: { status: "open_for_bids", participantsLockedAt: new Date(), biddingClosesAt: new Date(Date.now() + 3600000) } });
  return { f, consents };
}

describe("persisted capped enrollment billing policy", () => {
  it("activates persistent card policy when the provider accepts a new sandbox request", async () => {
    const f = await seed(false, true);
    expect((await db.hoaServiceRequest.findUniqueOrThrow({ where: { id: f.request.id } })).stripeTestEnrollmentRequired).toBe(true);
    await expect(join(f, 0)).rejects.toThrow();
  });
  it("blocks direct SQL enrollment without both capped consent and verified card", async () => {
    const f = await seed();
    await expect(join(f, 0)).rejects.toThrow();
    const accepted = await consent(f, 0);
    await expect(join(f, 0, accepted.id)).rejects.toThrow();
    await card(f, 0, accepted.id);
    await expect(join(f, 0, accepted.id)).resolves.toMatchObject({ enrollmentConsentId: accepted.id, response: "joined" });
    await expect(db.hoaServiceRequest.update({ where: { id: f.request.id }, data: { stripeTestEnrollmentRequired: false } })).rejects.toThrow();
  });

  it.each(["membership", "customer"])("rejects changed %s before direct enrollment", async change => {
    const f = await seed(); const accepted = await consent(f, 0); await card(f, 0, accepted.id);
    if (change === "membership") await db.communityMembership.update({ where: { id: f.homes[0].membership.id }, data: { status: "removed" } });
    else await db.user.update({ where: { id: f.homes[0].user.id }, data: { stripeTestCustomerId: `cus_replaced_${randomUUID()}` } });
    await expect(join(f, 0, accepted.id)).rejects.toThrow();
    expect(await db.hoaRequestParticipation.count({ where: { requestId: f.request.id } })).toBe(0);
  });

  it.each(["provider", "cap"])("rejects a consent bound to the wrong %s", async change => {
    const f = await seed();
    const operation = async () => {
      const accepted = await consent(f, 0, change === "provider" ? { providerUserId: f.homes[1].user.id } : { maximumCents: 100 });
      await card(f, 0, accepted.id);
      return join(f, 0, accepted.id);
    };
    await expect(operation()).rejects.toThrow();
    expect(await db.hoaRequestParticipation.count({ where: { requestId: f.request.id } })).toBe(0);
  });

  it("rechecks membership after actually waiting for concurrent removal", async () => {
    const f = await seed(); const accepted = await consent(f, 0); await card(f, 0, accepted.id);
    const mutator = new PgClient({ connectionString: process.env.TEST_DATABASE_URL! });
    const observer = new PgClient({ connectionString: process.env.TEST_DATABASE_URL! });
    await mutator.connect(); await observer.connect();
    await mutator.query("BEGIN");
    const blockerPid = (await mutator.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    await mutator.query('UPDATE "CommunityMembership" SET status = $1 WHERE id = $2', ["removed", f.homes[0].membership.id]);
    let joiningPid = 0;
    const joining = db.$transaction(async tx => {
      joiningPid = (await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`)[0].pid;
      return tx.hoaRequestParticipation.create({ data: { requestId: f.request.id, userId: f.homes[0].user.id, unitId: f.homes[0].unit.id, response: "joined", enrollmentConsentId: accepted.id } });
    }, { timeout: 10000 });
    void joining.catch(() => undefined);
    try {
      let blocked = false;
      for (const deadline = Date.now() + 3000; Date.now() < deadline;) {
        if (joiningPid) blocked = (await observer.query("SELECT $1::int = ANY(pg_blocking_pids($2::int)) AS blocked", [blockerPid, joiningPid])).rows[0].blocked;
        if (blocked) break;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      expect(blocked, "join must wait on the actual membership mutation").toBe(true);
    } finally { await mutator.query("COMMIT"); await mutator.end(); await observer.end(); }
    await expect(joining).rejects.toThrow();
    expect(await db.hoaRequestParticipation.count({ where: { requestId: f.request.id } })).toBe(0);
  });

  it("rejects another household's consent and revokes old setup authorization after withdrawal", async () => {
    const f = await seed(); const accepted = await consent(f, 0); const saved = await card(f, 0, accepted.id);
    await expect(join(f, 1, accepted.id)).rejects.toThrow();
    const participation = await join(f, 0, accepted.id);
    await db.hoaRequestParticipation.update({ where: { id: participation.id }, data: { response: "declined" } });
    expect((await db.enrollmentBillingConsent.findUniqueOrThrow({ where: { id: accepted.id } })).revokedAt).not.toBeNull();
    await expect(db.hoaRequestParticipation.update({ where: { id: participation.id }, data: { response: "joined", enrollmentConsentId: accepted.id } })).rejects.toThrow();
    const fresh = await consent(f, 0);
    await expect(card(f, 0, fresh.id, saved.setupIntentId)).rejects.toThrow();
    expect(await db.stripeTestPayment.count({ where: { requestId: f.request.id } })).toBe(0);
  });

  it("does not advance or create charges when the enrolled homes are below the minimum", async () => {
    const f = await seed(); const accepted = await consent(f, 0); await card(f, 0, accepted.id); await join(f, 0, accepted.id);
    await expect(transitionHoaRequest(f.manager.id, f.request.id, { action: "open_bidding", biddingClosesAt: new Date(Date.now() + 3600000).toISOString() })).rejects.toThrow(/required|homes|minimum/i);
    expect(await db.serviceAgreement.count({ where: { requestId: f.request.id } })).toBe(0);
    expect(await db.stripeTestPayment.count({ where: { requestId: f.request.id } })).toBe(0);
    expect((await db.hoaServiceRequest.findUniqueOrThrow({ where: { id: f.request.id } })).status).toBe("collecting_interest");
  });

  it("rejects a forged agreement authorization using a valid consent from another request", async () => {
    const source = await seed(); const accepted = await consent(source, 0); await card(source, 0, accepted.id);
    const target = await seed(false); await credentials(target); await join(target, 0); await join(target, 1);
    await db.hoaServiceRequest.update({ where: { id: target.request.id }, data: { status: "open_for_bids", participantsLockedAt: new Date(), biddingClosesAt: new Date(Date.now() + 3600000) } });
    const agreementId = await awardBid(target.manager.id, target.request.id, { bidId: `ladder:${target.commitment.id}`, expectedBidVersion: 1 });
    await expect(db.agreementBillingAuthorization.create({ data: { id: randomUUID(), agreementId, enrollmentConsentId: accepted.id, payerUserId: accepted.payerUserId, unitId: accepted.unitId, authorizedTotalCents: 10000 } })).rejects.toThrow();
    expect(await db.agreementBillingAuthorization.count({ where: { agreementId } })).toBe(0);
  });

  it("rejects an award after waiting for a concurrent consent revocation", async () => {
    const { f, consents } = await readyForAward();
    const mutator = new PgClient({ connectionString: process.env.TEST_DATABASE_URL! });
    const observer = new PgClient({ connectionString: process.env.TEST_DATABASE_URL! });
    await mutator.connect(); await observer.connect(); await mutator.query("BEGIN");
    const blockerPid = (await mutator.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    await mutator.query('UPDATE "EnrollmentBillingConsent" SET "revokedAt" = clock_timestamp() WHERE id = $1', [consents[0].id]);
    const awarding = awardBid(f.manager.id, f.request.id, { bidId: `ladder:${f.commitment.id}`, expectedBidVersion: 1 });
    void awarding.catch(() => undefined);
    try {
      let blocked = false;
      for (const deadline = Date.now() + 3000; Date.now() < deadline;) {
        blocked = (await observer.query("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND $1::int = ANY(pg_blocking_pids(pid))) AS blocked", [blockerPid])).rows[0].blocked;
        if (blocked) break;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      expect(blocked, "award must actually wait on the consent revocation's request lock").toBe(true);
    } finally { await mutator.query("COMMIT"); await mutator.end(); await observer.end(); }
    await expect(awarding).rejects.toThrow();
    expect(await db.serviceAgreement.count({ where: { requestId: f.request.id } })).toBe(0);
    expect((await db.hoaServiceRequest.findUniqueOrThrow({ where: { id: f.request.id } })).status).toBe("open_for_bids");
  });

  it("serializes concurrent visit allocations so their combined sum cannot exceed the household cap", async () => {
    const { f } = await readyForAward();
    const agreementId = await awardBid(f.manager.id, f.request.id, { bidId: `ladder:${f.commitment.id}`, expectedBidVersion: 1 });
    const unitId = f.homes[0].unit.id, payerId = f.homes[0].user.id;
    const visits = await db.serviceVisit.findMany({ where: { unitId, occurrence: { agreementId } } });
    // These newly created, unserved synthetic visits are removed solely to
    // exercise two independent materialization writers against the same cap.
    await db.serviceVisit.deleteMany({ where: { id: { in: visits.map(row => row.id) } } });
    const firstWriter = new PgClient({ connectionString: process.env.TEST_DATABASE_URL! });
    const observer = new PgClient({ connectionString: process.env.TEST_DATABASE_URL! });
    await firstWriter.connect(); await observer.connect(); await firstWriter.query("BEGIN");
    const blockerPid = (await firstWriter.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    await firstWriter.query('INSERT INTO "ServiceVisit" (id,"occurrenceId","unitId","allocatedVisitCents","billingPayerUserId","updatedAt") VALUES($1,$2,$3,6000,$4,clock_timestamp())', [randomUUID(), visits[0].occurrenceId, unitId, payerId]);
    let secondPid = 0;
    const secondWriter = db.$transaction(async tx => {
      secondPid = (await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`)[0].pid;
      return tx.serviceVisit.create({ data: { occurrenceId: visits[1].occurrenceId, unitId, allocatedVisitCents: 6000, billingPayerUserId: payerId } });
    }, { timeout: 10000 });
    void secondWriter.catch(() => undefined);
    try {
      let blocked = false;
      for (const deadline = Date.now() + 3000; Date.now() < deadline;) {
        if (secondPid) blocked = (await observer.query("SELECT $1::int = ANY(pg_blocking_pids($2::int)) AS blocked", [blockerPid, secondPid])).rows[0].blocked;
        if (blocked) break;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      expect(blocked, "second visit writer must wait for the first writer's agreement lock").toBe(true);
    } finally { await firstWriter.query("COMMIT"); await firstWriter.end(); await observer.end(); }
    await expect(secondWriter).rejects.toThrow(/exceed|authorized/i);
    expect((await db.serviceVisit.aggregate({ where: { unitId, occurrence: { agreementId } }, _sum: { allocatedVisitCents: true } }))._sum.allocatedVisitCents).toBe(6000);
  });

  it("authorizes the lower reached tier once and preserves original acceptance and verification times", async () => {
    const f = await seed(); await credentials(f);
    const originals = [];
    for (let i = 0; i < 2; i++) { const accepted = await consent(f, i); const saved = await card(f, i, accepted.id); await join(f, i, accepted.id); originals.push({ accepted, saved }); }
    await db.hoaServiceRequest.update({ where: { id: f.request.id }, data: { status: "open_for_bids", participantsLockedAt: new Date(), biddingClosesAt: new Date(Date.now() + 3600000) } });
    const agreementId = await awardBid(f.manager.id, f.request.id, { bidId: `ladder:${f.commitment.id}`, expectedBidVersion: 1 });
    const authorizations = await db.agreementBillingAuthorization.findMany({ where: { agreementId } });
    expect(authorizations).toHaveLength(2);
    for (const [index, original] of originals.entries()) {
      const authorization = authorizations.find(row => row.enrollmentConsentId === original.accepted.id)!;
      expect(authorization).toMatchObject({ authorizedTotalCents: 10000, payerUserId: f.homes[index].user.id, unitId: f.homes[index].unit.id });
      expect(authorization.authorizedTotalCents).toBeLessThanOrEqual(original.accepted.maximumCents);
      expect((await db.enrollmentBillingConsent.findUniqueOrThrow({ where: { id: original.accepted.id } })).acceptedAt).toEqual(original.accepted.acceptedAt);
      expect((await db.enrollmentBillingCard.findUniqueOrThrow({ where: { consentId: original.accepted.id } })).verifiedAt).toEqual(original.saved.verifiedAt);
      const billing = await readEnrollmentAuthorization(db, agreementId, original.accepted.payerUserId, original.accepted.unitId);
      expect(billing).toMatchObject({ id: authorization.id, termsToken: original.accepted.termsToken, acceptedAt: original.accepted.acceptedAt, card: { verifiedAt: original.saved.verifiedAt, customerId: original.saved.customerId, paymentMethodId: original.saved.paymentMethodId } });
      const visits = await db.serviceVisit.findMany({ where: { unitId: f.homes[index].unit.id, occurrence: { agreementId } } });
      expect(visits.map(row => row.allocatedVisitCents)).toEqual([5000, 5000]);
      expect(visits.every(row => row.billingPayerUserId === original.accepted.payerUserId)).toBe(true);
    }
    expect(await db.visitBillingConsent.count({ where: { agreementId } }), "capped permission must not manufacture later exact-price consent").toBe(0);
    expect(await db.stripeTestPayment.count({ where: { requestId: f.request.id } })).toBe(0);
  });
});
