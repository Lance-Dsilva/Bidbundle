import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

const injected = vi.hoisted(() => ({ current: null as (() => PrismaClient) | null }));
// The only application substitution selects a real Prisma client per async
// workflow. All domain functions, authorization, SQL, transactions, audit and
// notification/outbox persistence are the actual implementation.
vi.mock("@/lib/server/db", () => ({ db: new Proxy({}, {
  get(_target, key) {
    const client = injected.current?.();
    if (!client) throw new Error("PostgreSQL test client is not initialized.");
    const value = Reflect.get(client, key, client);
    return typeof value === "function" ? value.bind(client) : value;
  },
}) }));
import { awardBid, submitBid, withdrawBid } from "@/lib/server/hoa-market";

const connections = new AsyncLocalStorage<PrismaClient>();
function deferred() { let resolve!: () => void; let reject!: (error: unknown) => void; const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
type BidRead = { where?: { id?: string; requestId_providerUserId?: { requestId: string; providerUserId: string } } };
let pause: { matches: (client: string, args: BidRead) => boolean; seen: number; count: number; reached: ReturnType<typeof deferred>; release: ReturnType<typeof deferred> } | null = null;
let first: PrismaClient;
let second: PrismaClient;
const pending: Promise<unknown>[] = [];
const ownedRequests: string[] = [];
const ownedUsers: string[] = [];
const observed: Array<{ kind: "accepted-claim" | "database-error"; rows?: number; code?: string; table?: string; constraint?: string }> = [];
let observing = false;
let fixture: { requestId: string; bidId: string; otherBidId: string; managerId: string; providerId: string; otherProviderId: string; communityId: string };
const input = { amountCents: 20000, pricingBasis: "total" as const, perHomeCents: null, scope: "Revised full job", proposedStartDate: null, estimatedDurationLabel: null, exclusions: null, cadenceLabel: null, validUntil: null };

function client(name: string, connectionString: string): PrismaClient {
  const pool = new Pool({ connectionString });
  pool.on("connect", (connection) => {
    const original = connection.query;
    // Observe the real driver's results/errors before Prisma translates them.
    // Forward every original argument and result unchanged; never log values.
    connection.query = ((...args: unknown[]) => {
      const result = Reflect.apply(original, connection, args) as unknown;
      if (!(result instanceof Promise)) return result;
      const query = args[0] as { text?: string; values?: unknown[] };
      return result.then((value: { rowCount?: number }) => {
        if (observing && name === "first" && /UPDATE\s+(?:"public"\.)?"ServiceBid"/.test(query.text ?? "") && query.values?.includes(fixture.bidId) && query.values.includes("accepted")) {
          observed.push({ kind: "accepted-claim", rows: value.rowCount });
        }
        return value;
      }, (error: unknown) => {
        if (observing && name === "first") {
          const detail = error as { code?: string; table?: string; constraint?: string };
          observed.push({ kind: "database-error", code: detail.code, table: detail.table, constraint: detail.constraint });
        }
        throw error;
      });
    }) as typeof connection.query;
  });
  const base = new PrismaClient({ adapter: new PrismaPg(pool, { disposeExternalPool: true }) });
  return base.$extends({ query: { serviceBid: {
    async findUnique({ args, query }) {
      const result = await query(args);
      const current = pause;
      if (current?.matches(name, args as BidRead)) {
        current.seen++;
        if (current.seen >= current.count) current.reached.resolve();
        await current.release.promise;
      }
      return result;
    },
  } } }) as unknown as PrismaClient;
}
function hold(matches: (name: string, args: BidRead) => boolean, count = 1) {
  pause = { matches, count, seen: 0, reached: deferred(), release: deferred() };
  return pause;
}
function run<T>(db: PrismaClient, action: () => Promise<T>): Promise<T> {
  const result = connections.run(db, action);
  pending.push(result);
  // Avoid an unhandled rejection while the test waits for the read barrier.
  void result.catch((error) => { if (pause && pause.seen < pause.count) pause.reached.reject(error); });
  return result;
}
async function seed() {
  const tag = `pgcas18-${randomUUID()}`;
  const manager = await first.user.create({ data: { clerkUserId: `${tag}-manager`, email: `${tag}-manager@example.invalid`, fullName: "Isolated Manager", role: "hoa_staff" } });
  const providers = [];
  for (const suffix of ["one", "two"]) providers.push(await first.user.create({ data: {
    clerkUserId: `${tag}-${suffix}`, email: `${tag}-${suffix}@example.invalid`, fullName: `Isolated Provider ${suffix}`, role: "provider",
    providerProfile: { create: { companyName: "Isolated Test Company", trades: ["cleaning"], accountStatus: "active", licenseNumber: "TEST-ONLY", insuranceProvider: "TEST-ONLY", licenseVerifiedAt: new Date(), insuranceVerifiedAt: new Date() } },
    providerServiceAreas: { create: { label: "Isolated test area", centerLatitude: 30.4, centerLongitude: -97.7, radiusMiles: 10, postalCodes: [] } },
  } }));
  ownedUsers.push(manager.id, ...providers.map((provider) => provider.id));
  const community = await first.community.create({ data: { name: tag, type: "hoa", hoaProfile: { create: { legalName: "Isolated Test HOA", addressLine1: "1 Test St", locality: "Austin", region: "TX", postalCode: "78758", latitude: 30.4, longitude: -97.7, totalHomes: 1, addressVerificationStatus: "verified" } } } });
  await first.communityStaffAssignment.create({ data: { communityId: community.id, userId: manager.id, role: "hoa_manager", status: "active" } });
  const unit = await first.communityUnit.create({ data: { communityId: community.id, label: "Isolated unit" } });
  const request = await first.hoaServiceRequest.create({ data: { communityId: community.id, createdByUserId: manager.id, title: tag, category: "cleaning", description: "Owned PostgreSQL regression fixture", kind: "compulsory_recurring", recurrenceLabel: "Daily", status: "draft", totalOccurrences: 2, recurrenceIntervalDays: 1, biddingClosesAt: new Date(Date.now() + 3600000) } });
  ownedRequests.push(request.id);
  await first.hoaRequestParticipation.create({ data: { requestId: request.id, unitId: unit.id, userId: null, response: "joined" } });
  await first.hoaServiceRequest.update({ where: { id: request.id }, data: { status: "open_for_bids", participantsLockedAt: new Date() } });
  const bids = [];
  for (const provider of providers) bids.push(await first.serviceBid.create({ data: { requestId: request.id, providerUserId: provider.id, amountCents: 12345, currency: "eur", pricingBasis: "total", perHomeCents: null, scope: "Owned complete-job test quote" } }));
  fixture = { requestId: request.id, bidId: bids[0].id, otherBidId: bids[1].id, managerId: manager.id, providerId: providers[0].id, otherProviderId: providers[1].id, communityId: community.id };
}
async function closeBidding() { await second.hoaServiceRequest.update({ where: { id: fixture.requestId }, data: { status: "bidding_closed" } }); }
async function noAwardEffects() {
  expect(await first.serviceAgreement.count({ where: { requestId: fixture.requestId } })).toBe(0);
  expect(await first.adminAuditLog.count({ where: { communityId: fixture.communityId } })).toBe(0);
  expect(await first.notification.count({ where: { userId: { in: [fixture.providerId, fixture.otherProviderId] } } })).toBe(0);
  expect(await first.outboxEvent.count({ where: { OR: [{ dedupeKey: { contains: fixture.requestId } }, { dedupeKey: { contains: fixture.bidId } }] } })).toBe(0);
}

beforeAll(async () => {
  const target = process.env.TEST_DATABASE_URL;
  if (!target) throw new Error("Explicit TEST_DATABASE_URL is required.");
  let parsed: URL;
  try { parsed = new URL(target); } catch { throw new Error("Invalid disposable PostgreSQL test URL."); }
  if (!["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname) || !/^bundleen_issue18_test(?:_[a-z0-9_-]+)?$/i.test(parsed.pathname.slice(1))) throw new Error("Refusing non-disposable PostgreSQL target.");
  first = client("first", target); second = client("second", target);
  injected.current = () => connections.getStore() ?? first;
});
beforeEach(async () => { pause = null; pending.length = 0; observing = false; observed.length = 0; await seed(); });
afterEach(async () => { pause?.release.resolve(); await Promise.allSettled(pending); pause = null; });
afterAll(async () => {
  // Audit rows are append-only. Leave only this run's uniquely named fixtures
  // in the explicitly disposable database; its owner destroys the container.
  await Promise.all([first?.$disconnect(), second?.$disconnect()]);
});

describe("actual Prisma and full-schema PostgreSQL bid confirmation races", () => {
  it("uses independent PostgreSQL sessions with all branch migrations present", async () => {
    const [a, b] = await Promise.all([first.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`, second.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`]);
    expect(a[0].pid).not.toBe(b[0].pid);
    const rows = await first.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`;
    expect(Number(rows[0].count)).toBeGreaterThanOrEqual(21);
  });
  it("rejects a stale displayed version before making any award effects", async () => {
    await closeBidding();
    await second.serviceBid.update({ where: { id: fixture.bidId }, data: { version: { increment: 1 }, amountCents: 99999 } });
    await expect(run(first, () => awardBid(fixture.managerId, fixture.requestId, { bidId: fixture.bidId, expectedBidVersion: 1 }))).rejects.toMatchObject({ status: 409 });
    await noAwardEffects();
  });
  it("loses the actual award CAS when another connection changes the quote after its read", async () => {
    await closeBidding();
    const barrier = hold((name, args) => name === "first" && args.where?.id === fixture.bidId);
    const awarding = run(first, () => awardBid(fixture.managerId, fixture.requestId, { bidId: fixture.bidId, expectedBidVersion: 1 }));
    await barrier.reached.promise;
    await second.serviceBid.update({ where: { id: fixture.bidId }, data: { version: { increment: 1 }, amountCents: 99999 } });
    barrier.release.resolve(); await expect(awarding).rejects.toMatchObject({ status: 409 });
    expect(await first.serviceBid.findUnique({ where: { id: fixture.bidId } })).toMatchObject({ status: "submitted", version: 2, amountCents: 99999 }); await noAwardEffects();
  });
  it.each(["revision", "withdrawal"] as const)("a real paused %s cannot overwrite an award from another client", async (action) => {
    const barrier = hold((name, args) => name === "first" && args.where?.requestId_providerUserId?.providerUserId === fixture.providerId);
    const changing = action === "revision"
      ? run(first, () => submitBid(fixture.providerId, fixture.requestId, input))
      : run(first, () => withdrawBid(fixture.providerId, fixture.requestId));
    await barrier.reached.promise; await closeBidding();
    const agreementId = await run(second, () => awardBid(fixture.managerId, fixture.requestId, { bidId: fixture.bidId, expectedBidVersion: 1 }));
    barrier.release.resolve(); await expect(changing).rejects.toMatchObject({ status: 409 });
    expect(await first.serviceBid.findUnique({ where: { id: fixture.bidId } })).toMatchObject({ status: "accepted", amountCents: 12345, version: 1 });
    expect(await first.serviceAgreement.findUnique({ where: { id: agreementId } })).toMatchObject({ amountCents: 12345, currency: "eur" });
  });
  it("returns one agreement for two actual concurrent same-bid awards and subsequent stale retries", async () => {
    await closeBidding();
    const barrier = hold((_name, args) => args.where?.id === fixture.bidId, 2);
    const one = run(first, () => awardBid(fixture.managerId, fixture.requestId, { bidId: fixture.bidId, expectedBidVersion: 1 }));
    const two = run(second, () => awardBid(fixture.managerId, fixture.requestId, { bidId: fixture.bidId, expectedBidVersion: 1 }));
    await barrier.reached.promise; barrier.release.resolve();
    const [a, b] = await Promise.all([one, two]); expect(a).toBe(b);
    expect(await first.serviceAgreement.count({ where: { requestId: fixture.requestId } })).toBe(1);
    expect(await first.serviceOccurrence.count({ where: { agreementId: a } })).toBe(2);
    expect(await first.serviceVisit.count({ where: { occurrence: { agreementId: a } } })).toBe(2);
    expect(await first.adminAuditLog.count({ where: { communityId: fixture.communityId, action: "hoa_bid_awarded" } })).toBe(1);
    expect(await first.notification.count({ where: { userId: { in: [fixture.providerId, fixture.otherProviderId] } } })).toBe(2);
    expect(await first.outboxEvent.count({ where: { dedupeKey: { contains: fixture.requestId } } })).toBe(2);
    expect(await run(first, () => awardBid(fixture.managerId, fixture.requestId, { bidId: fixture.bidId, expectedBidVersion: 99 }))).toBe(a);
  });
  it("rolls back a successful quote claim when the real agreement unique constraint fails later", async () => {
    await closeBidding();
    const barrier = hold((name, args) => name === "first" && args.where?.id === fixture.bidId);
    const awarding = run(first, () => awardBid(fixture.managerId, fixture.requestId, { bidId: fixture.bidId, expectedBidVersion: 1 }));
    await barrier.reached.promise;
    // Deliberately physically valid but domain-inconsistent fault fixture:
    // agreement identity checks permit this while the other bid stays submitted.
    // Do not accept that bid: the one-accepted-bid index would fail the FIRST
    // claim and would not prove rollback after a later agreement insert.
    await second.serviceAgreement.create({ data: { requestId: fixture.requestId, bidId: fixture.otherBidId, communityId: fixture.communityId, providerUserId: fixture.otherProviderId, awardedByUserId: fixture.managerId, amountCents: 12345, currency: "eur", pricingBasis: "total", scope: "Intentional later-write fault fixture", lockedHomeCount: 1 } });
    observing = true;
    barrier.release.resolve(); await expect(awarding).rejects.toMatchObject({ status: 409 });
    expect(observed[0]).toEqual({ kind: "accepted-claim", rows: 1 });
    expect(observed).toContainEqual({ kind: "database-error", code: "23505", table: "ServiceAgreement", constraint: "ServiceAgreement_requestId_key" });
    console.info("[postgres-proof]", JSON.stringify(observed));
    expect(await first.serviceBid.findUnique({ where: { id: fixture.bidId } })).toMatchObject({ status: "submitted", version: 1 });
    expect(await first.serviceBid.findUnique({ where: { id: fixture.otherBidId } })).toMatchObject({ status: "submitted" });
    expect(await first.serviceAgreement.findUnique({ where: { requestId: fixture.requestId } })).toMatchObject({ bidId: fixture.otherBidId });
    expect(await first.adminAuditLog.count({ where: { communityId: fixture.communityId } })).toBe(0);
    expect(await first.notification.count({ where: { userId: { in: [fixture.providerId, fixture.otherProviderId] } } })).toBe(0);
    expect(await first.outboxEvent.count({ where: { dedupeKey: { contains: fixture.requestId } } })).toBe(0);
  });
  it.each(["revision", "withdrawal"] as const)("rechecks actual elapsed PostgreSQL deadline for a paused %s", async (action) => {
    const barrier = hold((name, args) => name === "first" && args.where?.requestId_providerUserId?.providerUserId === fixture.providerId);
    const changing = action === "revision"
      ? run(first, () => submitBid(fixture.providerId, fixture.requestId, input))
      : run(first, () => withdrawBid(fixture.providerId, fixture.requestId));
    await barrier.reached.promise;
    await second.hoaServiceRequest.update({ where: { id: fixture.requestId }, data: { biddingClosesAt: new Date(Date.now() - 1000) } });
    barrier.release.resolve(); await expect(changing).rejects.toMatchObject({ status: 409 });
    expect(await first.serviceBid.findUnique({ where: { id: fixture.bidId } })).toMatchObject({ status: "submitted", version: 1, amountCents: 12345 }); await noAwardEffects();
  });
});
