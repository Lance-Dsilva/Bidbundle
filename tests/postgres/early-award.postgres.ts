import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
const injection = vi.hoisted(() => ({ current: null as (() => PrismaClient) | null }));
// Only routes the actual Prisma client; no SQL, authority, or domain result mocks.
vi.mock("@/lib/server/db", () => ({ db: new Proxy({}, { get(_target, key) { const db = injection.current?.(); if (!db) throw new Error("Uninitialized isolated client"); const value = Reflect.get(db, key, db); return typeof value === "function" ? value.bind(db) : value; } }) }));
import { awardBid, submitBid, transitionHoaRequest, withdrawBid } from "@/lib/server/hoa-market";
const context = new AsyncLocalStorage<PrismaClient>();
let first: PrismaClient;
let second: PrismaClient;
function deferred() { let resolve!: () => void; let reject!: (error: unknown) => void; const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
type ReadArgs = { where?: { id?: string; requestId?: string; requestId_providerUserId?: { requestId: string; providerUserId: string } } };
let pause: { client: string; model: string; operation: string; match: (args: ReadArgs) => boolean; count: number; seen: number; reached: ReturnType<typeof deferred>; release: ReturnType<typeof deferred> } | null = null;
const pending: Promise<unknown>[] = [];
function hold(model: string, operation: string, match: (args: ReadArgs) => boolean, name = "first", count = 1) { pause = { client: name, model, operation, match, count, seen: 0, reached: deferred(), release: deferred() }; return pause; }
const databaseFailures: Array<{ code?: string; constraint?: string }> = [];
let observing = false;
const trace: Array<{ kind: "parent-claim" | "bid-claim" | "fault"; rows?: number; code?: string; constraint?: string }> = [];
function client(name: string, target: string): PrismaClient {
  const pool = new Pool({ connectionString: target });
  pool.on("connect", (connection) => {
    const original = connection.query;
    connection.query = ((...args: unknown[]) => {
      const query = args[0] as { text?: string; values?: unknown[] };
      const text = typeof args[0] === "string" ? args[0] : query.text ?? "";
      const values = query.values ?? (Array.isArray(args[1]) ? args[1] : []);
      const record = (error: unknown, result?: { rowCount?: number }) => {
        if (error) { const detail = error as { code?: string; constraint?: string }; databaseFailures.push({ code: detail.code, constraint: detail.constraint }); if (observing && name === "first") trace.push({ kind: "fault", code: detail.code, constraint: detail.constraint }); }
        else if (observing && name === "first") {
          if (/UPDATE\s+(?:"public"\.)?"HoaServiceRequest"/.test(text) && (values.includes("awarded") || /'awarded'/.test(text))) trace.push({ kind: "parent-claim", rows: result?.rowCount });
          if (/UPDATE\s+(?:"public"\.)?"ServiceBid"/.test(text) && (values.includes("accepted") || /'accepted'/.test(text))) trace.push({ kind: "bid-claim", rows: result?.rowCount });
        }
      };
      const callback = args[args.length - 1];
      if (typeof callback === "function") {
        args[args.length - 1] = function (this: unknown, ...values: unknown[]) { record(values[0], values[1] as { rowCount?: number }); return Reflect.apply(callback, this, values); };
        return Reflect.apply(original, connection, args);
      }
      const result = Reflect.apply(original, connection, args) as unknown;
      return result instanceof Promise ? result.then((value: { rowCount?: number }) => { record(null, value); return value; }, (error: unknown) => { record(error); throw error; }) : result;
    }) as typeof connection.query;
  });
  const base = new PrismaClient({ adapter: new PrismaPg(pool, { disposeExternalPool: true }) });
  return base.$extends({ query: { $allModels: { async $allOperations({ model, operation, args, query }) {
    const result = await query(args);
    const gate = pause;
    if (gate && (gate.client === name || gate.client === "both") && gate.model === model && gate.operation === operation && gate.match(args as ReadArgs)) {
      gate.seen++; if (gate.seen >= gate.count) gate.reached.resolve(); await gate.release.promise;
    }
    return result;
  } } } }) as unknown as PrismaClient;
}
const quote = { amountCents: 12345, pricingBasis: "total" as const, perHomeCents: null, scope: "Complete cleaning job", proposedStartDate: null, estimatedDurationLabel: null, exclusions: null, cadenceLabel: null, validUntil: null };
function run<T>(client: PrismaClient, action: () => Promise<T>) { const result = context.run(client, action); pending.push(result); void result.catch((error) => { if (pause && pause.seen < pause.count) pause.reached.reject(error); }); return result; }
async function provider(tag: string) { return first.user.create({ data: { clerkUserId: `${tag}-provider`, email: `${tag}-provider@example.invalid`, fullName: "Isolated provider", role: "provider", providerProfile: { create: { companyName: "Isolated Company", trades: ["cleaning"], accountStatus: "active", licenseNumber: "TEST", insuranceProvider: "TEST", licenseVerifiedAt: new Date(), insuranceVerifiedAt: new Date() } }, providerServiceAreas: { create: { label: "Isolated coverage", centerLatitude: 30.4, centerLongitude: -97.7, radiusMiles: 10, postalCodes: [] } } } }); }
async function seed(type: "hoa" | "neighborhood") {
  const tag = `issue17-${randomUUID()}`;
  const resident = await first.user.create({ data: { clerkUserId: `${tag}-resident`, email: `${tag}-resident@example.invalid`, fullName: "Isolated homeowner", role: "homeowner", address: "1 Test St, Austin, TX 78758", latitude: 30.4, longitude: -97.7, homeownerProfile: { create: {} } } });
  const manager = await first.user.create({ data: { clerkUserId: `${tag}-manager`, email: `${tag}-manager@example.invalid`, fullName: "Isolated manager", role: type === "hoa" ? "hoa_staff" : "homeowner" } });
  const serviceProvider = await provider(tag);
  const community = await first.community.create({ data: { name: tag, type, status: "active", centerLatitude: 30.4, centerLongitude: -97.7, radiusMiles: 10, ...(type === "hoa" ? { hoaProfile: { create: { legalName: "Isolated HOA", addressLine1: "1 Test St", locality: "Austin", region: "TX", postalCode: "78758", latitude: 30.4, longitude: -97.7, totalHomes: 1, addressVerificationStatus: "verified" } } } : {}) } });
  if (type === "neighborhood") await first.communityMembership.create({ data: { communityId: community.id, userId: manager.id, status: "active" } });
  await first.communityStaffAssignment.create({ data: { communityId: community.id, userId: manager.id, role: type === "hoa" ? "hoa_manager" : "neighborhood_manager", status: "active" } });
  const unit = type === "hoa" ? await first.communityUnit.create({ data: { communityId: community.id, label: "Owned unit" } }) : null;
  await first.communityMembership.create({ data: { communityId: community.id, userId: resident.id, unitId: unit?.id ?? null, status: "active" } });
  const request = await first.hoaServiceRequest.create({ data: { communityId: community.id, createdByUserId: type === "hoa" ? manager.id : resident.id, title: tag, category: "cleaning", description: "Legitimate isolated lifecycle", kind: "optional_group", status: "collecting_interest", minHomes: 1, totalOccurrences: 1 } });
  await first.hoaRequestParticipation.create({ data: { requestId: request.id, userId: resident.id, unitId: unit?.id ?? null, response: "joined" } });
  await run(first, () => transitionHoaRequest(manager.id, request.id, { action: "open_bidding", biddingClosesAt: new Date(Date.now() + 3600000).toISOString() }));
  const bid = await run(first, () => submitBid(serviceProvider.id, request.id, quote));
  return { request, bid, manager, resident, provider: serviceProvider, community, unit };
}
type Fixture = Awaited<ReturnType<typeof seed>>;
function award(f: Fixture, db = first, bidId = f.bid.id, expectedBidVersion = f.bid.version) { return run(db, () => awardBid(f.manager.id, f.request.id, { bidId, expectedBidVersion })); }
async function effects(f: Fixture) { return {
  agreements: await first.serviceAgreement.count({ where: { requestId: f.request.id } }),
  audits: await first.adminAuditLog.count({ where: { communityId: f.community.id } }),
  notifications: await first.notification.count({ where: { OR: [{ dedupeKey: { contains: f.request.id } }, { userId: { in: [f.manager.id, f.resident.id, f.provider.id] } }] } }),
  outbox: await first.outboxEvent.count({ where: { OR: [{ dedupeKey: { contains: f.request.id } }, ...[f.manager.id, f.resident.id, f.provider.id].map((id) => ({ dedupeKey: { endsWith: `:${id}` } }))] } }),
}; }
async function saved(f: Fixture) { return first.hoaServiceRequest.findUniqueOrThrow({ where: { id: f.request.id } }); }
beforeAll(async () => {
  const target = process.env.TEST_DATABASE_URL;
  if (!target) throw new Error("Explicit disposable issue17 TEST_DATABASE_URL required.");
  let url: URL;
  try { url = new URL(target); } catch { throw new Error("Invalid disposable PostgreSQL test URL."); }
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || !/^bundleen_issue17_test(?:_[a-z0-9_-]+)?$/i.test(url.pathname.slice(1))) throw new Error("Refusing non-disposable issue17 database.");
  first = client("first", target);
  second = client("second", target);
  injection.current = () => context.getStore() ?? first;
});
afterEach(async () => { observing = false; trace.length = 0; pause?.release.resolve(); await Promise.allSettled(pending); pending.length = 0; pause = null; });
afterAll(async () => { if (databaseFailures.length) console.info("[isolated database failures]", JSON.stringify(databaseFailures)); await Promise.all([first?.$disconnect(), second?.$disconnect()]); });
describe("actual full-schema award lifecycle", () => {
  it("uses independent actual sessions and the full migrated schema", async () => {
    const [a, b] = await Promise.all([first.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`, second.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`]);
    expect(a[0].pid).not.toBe(b[0].pid);
    const rows = await first.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`;
    expect(Number(rows[0].count)).toBeGreaterThanOrEqual(23);
    const correction = await first.$queryRaw<Array<{ migration_name: string }>>`SELECT migration_name FROM "_prisma_migrations" WHERE migration_name = '20261028190000_early_award_bid_and_visit_guards' AND finished_at IS NOT NULL AND rolled_back_at IS NULL`;
    expect(correction).toHaveLength(1);
  });
  it("retains successful closed HOA awards as the control", async () => {
    const f = await seed("hoa");
    await run(first, () => transitionHoaRequest(f.manager.id, f.request.id, { action: "close_bidding" }));
    const id = await run(first, () => awardBid(f.manager.id, f.request.id, { bidId: f.bid.id, expectedBidVersion: f.bid.version }));
    expect(await first.serviceVisit.count({ where: { occurrence: { agreementId: id } } })).toBe(1);
  });
  it("allows an authorized HOA manager to award while bidding is open", async () => {
    const f = await seed("hoa");
    const id = await run(first, () => awardBid(f.manager.id, f.request.id, { bidId: f.bid.id, expectedBidVersion: f.bid.version }));
    expect(await first.serviceAgreement.findUniqueOrThrow({ where: { id } })).toMatchObject({ requestId: f.request.id, amountCents: quote.amountCents, lockedHomeCount: 1 });
    expect(await first.hoaServiceRequest.findUniqueOrThrow({ where: { id: f.request.id } })).toMatchObject({ status: "awarded" });
  });
  it("retains compulsory HOA unit snapshots, all recurrence visits, whole-job price and original currency", async () => {
    const f = await seed("hoa"); const vacant = await first.communityUnit.create({ data: { communityId: f.community.id, label: "Owned vacant unit" } });
    const request = await first.hoaServiceRequest.create({ data: { communityId: f.community.id, createdByUserId: f.manager.id, title: `recurring-${randomUUID()}`, category: "cleaning", description: "Full recurring job", kind: "compulsory_recurring", recurrenceLabel: "Every other day", recurrenceIntervalDays: 2, totalOccurrences: 3, status: "draft" } });
    await run(first, () => transitionHoaRequest(f.manager.id, request.id, { action: "publish", biddingClosesAt: new Date(Date.now() + 3600000).toISOString() }));
    const bid = await run(first, () => submitBid(f.provider.id, request.id, { ...quote, amountCents: 34567 }));
    // Existing persisted currency is authoritative; awarding must not convert it.
    await first.serviceBid.update({ where: { id: bid.id }, data: { currency: "eur" } });
    const id = await run(first, () => awardBid(f.manager.id, request.id, { bidId: bid.id, expectedBidVersion: bid.version }));
    expect(await first.serviceAgreement.findUniqueOrThrow({ where: { id } })).toMatchObject({ amountCents: 34567, currency: "eur", pricingBasis: "total", lockedHomeCount: 2 });
    const occurrences = await first.serviceOccurrence.findMany({ where: { agreementId: id }, orderBy: { sequence: "asc" } }); expect(occurrences).toHaveLength(3);
    expect(+occurrences[1].serviceDate - +occurrences[0].serviceDate).toBe(2 * 86400000);
    const visits = await first.serviceVisit.findMany({ where: { occurrence: { agreementId: id } } }); expect(visits).toHaveLength(6);
    expect(new Set(visits.map((visit) => visit.unitId))).toEqual(new Set([f.unit!.id, vacant.id])); expect(visits.every((visit) => visit.homeownerUserId === null && visit.serviceAddressLine1 === null)).toBe(true);
  });
  it("awards a legitimate closed neighborhood request with a unitless homeowner visit", async () => {
    const f = await seed("neighborhood");
    expect(f.unit).toBeNull();
    await run(first, () => transitionHoaRequest(f.manager.id, f.request.id, { action: "close_bidding" }));
    const id = await run(first, () => awardBid(f.manager.id, f.request.id, { bidId: f.bid.id, expectedBidVersion: f.bid.version }));
    const visits = await first.serviceVisit.findMany({ where: { occurrence: { agreementId: id } } });
    expect(visits).toHaveLength(1);
    expect(visits[0]).toMatchObject({ unitId: null, homeownerUserId: f.resident.id, serviceAddressLine1: "1 Test St", serviceLatitude: 30.4, serviceLongitude: -97.7 });
  });
  it("awards an open neighborhood job, truthfully closes bidding, and preserves the frozen address", async () => {
    const f = await seed("neighborhood"); const before = new Date(); const id = await award(f); const after = new Date();
    const row = await saved(f); expect(row.status).toBe("awarded"); expect(row.biddingClosesAt!.getTime()).toBeGreaterThanOrEqual(before.getTime()); expect(row.biddingClosesAt!.getTime()).toBeLessThanOrEqual(after.getTime());
    await first.user.update({ where: { id: f.resident.id }, data: { address: "99 Moved St", latitude: 31, longitude: -96 } });
    const visit = await first.serviceVisit.findFirstOrThrow({ where: { occurrence: { agreementId: id } } });
    expect(visit).toMatchObject({ unitId: null, homeownerUserId: f.resident.id, serviceAddressLine1: "1 Test St", serviceLatitude: 30.4, serviceLongitude: -97.7 });
    const snapshot = await effects(f); expect(await award(f, second, f.bid.id, 999)).toBe(id); expect(await effects(f)).toEqual(snapshot);
  });
  it("never extends an already elapsed bidding deadline when awarding a valid quote", async () => {
    const f = await seed("hoa"); const elapsed = new Date(Date.now() - 10000);
    await first.hoaServiceRequest.update({ where: { id: f.request.id }, data: { biddingClosesAt: elapsed } });
    await award(f); expect((await saved(f)).biddingClosesAt).toEqual(elapsed);
  });
  it("refuses a real quote validity deadline that elapses after its snapshot but before claiming", async () => {
    const f = await seed("hoa"); await first.serviceBid.update({ where: { id: f.bid.id }, data: { validUntil: new Date(Date.now() + 1000) } });
    const gate = hold("ServiceBid", "findMany", (args) => args.where?.requestId === f.request.id); const awarding = award(f); await gate.reached.promise;
    const baseline = await effects(f); await new Promise((resolve) => setTimeout(resolve, 1100)); gate.release.resolve(); await expect(awarding).rejects.toBeDefined();
    expect(await effects(f)).toEqual(baseline); expect((await saved(f)).status).toBe("open_for_bids");
    expect((await first.serviceBid.findUniqueOrThrow({ where: { id: f.bid.id } })).status).toBe("submitted");
  });
  it.each(["participant", "provider", "other-manager", "revoked-manager"] as const)("denies an unauthorized %s without award effects", async (kind) => {
    const f = await seed("neighborhood");
    let userId = kind === "provider" ? f.provider.id : f.resident.id;
    if (kind === "other-manager") userId = (await seed("neighborhood")).manager.id;
    if (kind === "revoked-manager") { userId = f.manager.id; await first.communityStaffAssignment.updateMany({ where: { communityId: f.community.id, userId }, data: { status: "revoked", revokedAt: new Date() } }); }
    // Seeding another real request legitimately notifies eligible providers;
    // measure only the unauthorized operation after all fixture setup.
    const baseline = await effects(f);
    await expect(run(first, () => awardBid(userId, f.request.id, { bidId: f.bid.id, expectedBidVersion: f.bid.version }))).rejects.toMatchObject({ status: 403 });
    expect(await effects(f)).toEqual(baseline); expect((await saved(f)).status).toBe("open_for_bids");
  });
  it.each(["version", "expired", "inactive-provider", "legacy-price", "missing-address", "foreign-bid"] as const)("preserves %s refusal without partial effects", async (kind) => {
    const f = await seed("neighborhood"); let bidId = f.bid.id; let version = f.bid.version;
    if (kind === "version") version++;
    if (kind === "expired") await first.serviceBid.update({ where: { id: bidId }, data: { validUntil: new Date(Date.now() - 1000) } });
    if (kind === "inactive-provider") await first.providerProfile.update({ where: { userId: f.provider.id }, data: { accountStatus: "suspended" } });
    if (kind === "legacy-price") await first.serviceBid.update({ where: { id: bidId }, data: { pricingBasis: "per_home", perHomeCents: 12345 } });
    if (kind === "missing-address") await first.user.update({ where: { id: f.resident.id }, data: { address: null, latitude: null, longitude: null } });
    if (kind === "foreign-bid") bidId = (await seed("hoa")).bid.id;
    const baseline = await effects(f); const row = await saved(f);
    let failure: unknown; try { await award(f, first, bidId, version); } catch (error) { failure = error; }
    expect(failure).toBeDefined();
    if (kind === "legacy-price") expect((failure as Error).message).not.toMatch(/Bidding has closed/);
    expect(await effects(f)).toEqual(baseline); expect(await saved(f)).toEqual(row);
    expect((await first.serviceBid.findUniqueOrThrow({ where: { id: f.bid.id } })).status).toBe("submitted");
  });
  it.each(["revision", "withdrawal"] as const)("refuses stale award after a real provider %s wins", async (action) => {
    const f = await seed("hoa"); const gate = hold("ServiceBid", "findUnique", (args) => args.where?.id === f.bid.id);
    const awarding = award(f); await gate.reached.promise;
    if (action === "revision") await run(second, () => submitBid(f.provider.id, f.request.id, { ...quote, amountCents: 22222 }));
    else await run(second, () => withdrawBid(f.provider.id, f.request.id));
    const baseline = await effects(f); gate.release.resolve(); await expect(awarding).rejects.toMatchObject({ status: 409 }); expect(await effects(f)).toEqual(baseline);
    expect((await saved(f)).status).toBe("open_for_bids");
    expect(await first.serviceBid.findUniqueOrThrow({ where: { id: f.bid.id } })).toMatchObject(action === "revision" ? { status: "submitted", amountCents: 22222, version: 2 } : { status: "withdrawn" });
  });
  it.each(["revision", "withdrawal"] as const)("prevents a paused provider %s from overwriting a winning early award", async (action) => {
    const f = await seed("hoa"); const gate = hold("ServiceBid", "findUnique", (args) => args.where?.requestId_providerUserId?.providerUserId === f.provider.id);
    const changing = run<unknown>(first, () => action === "revision" ? submitBid(f.provider.id, f.request.id, { ...quote, amountCents: 22222 }) : withdrawBid(f.provider.id, f.request.id));
    await gate.reached.promise; const id = await award(f, second); const baseline = await effects(f); gate.release.resolve(); await expect(changing).rejects.toMatchObject({ status: 409 });
    expect(await effects(f)).toEqual(baseline); expect(await first.serviceBid.findUniqueOrThrow({ where: { id: f.bid.id } })).toMatchObject({ status: "accepted", version: f.bid.version, amountCents: quote.amountCents });
    expect(await first.serviceAgreement.findUniqueOrThrow({ where: { id } })).toMatchObject({ amountCents: quote.amountCents, currency: "usd" });
  });
  it.each(["cancel", "close_bidding"] as const)("does not overwrite a real %s that wins after the award snapshot", async (action) => {
    const f = await seed("hoa"); const gate = hold("ServiceBid", "findUnique", (args) => args.where?.id === f.bid.id); const awarding = award(f); await gate.reached.promise;
    await run(second, () => transitionHoaRequest(f.manager.id, f.request.id, { action })); const baseline = await effects(f); gate.release.resolve(); await expect(awarding).rejects.toMatchObject({ status: 409 });
    expect(await effects(f)).toEqual(baseline); expect((await saved(f)).status).toBe(action === "cancel" ? "cancelled" : "bidding_closed");
    if (action === "close_bidding") expect(await award(f)).toBeTypeOf("string");
  });
  it.each(["cancel", "close_bidding"] as const)("prevents a stale manager %s from overwriting an early award", async (action) => {
    const f = await seed("hoa"); const gate = hold("HoaServiceRequest", "findUnique", (args) => args.where?.id === f.request.id);
    const changing = run(first, () => transitionHoaRequest(f.manager.id, f.request.id, { action })); await gate.reached.promise;
    await award(f, second); const baseline = await effects(f); gate.release.resolve(); await expect(changing).rejects.toMatchObject({ status: 409 }); expect(await effects(f)).toEqual(baseline); expect((await saved(f)).status).toBe("awarded");
  });
  it("returns one agreement and one set of effects for concurrent same-bid early awards", async () => {
    const f = await seed("hoa"); const gate = hold("ServiceBid", "findUnique", (args) => args.where?.id === f.bid.id, "both", 2);
    const one = award(f); const two = award(f, second); await gate.reached.promise; gate.release.resolve();
    const [a, b] = await Promise.all([one, two]); expect(a).toBe(b);
    expect(await first.serviceAgreement.count({ where: { requestId: f.request.id } })).toBe(1);
    expect(await first.adminAuditLog.count({ where: { communityId: f.community.id, action: "hoa_bid_awarded" } })).toBe(1);
    expect(await first.serviceVisit.count({ where: { occurrence: { agreementId: a } } })).toBe(1);
  });
  it("allows independent providers to submit concurrently without a false parent-version conflict", async () => {
    const f = await seed("hoa"); const a = await provider(`parallel-a-${randomUUID()}`); const b = await provider(`parallel-b-${randomUUID()}`);
    const gate = hold("ServiceBid", "findUnique", (args) => [a.id, b.id].includes(args.where?.requestId_providerUserId?.providerUserId ?? ""), "both", 2);
    const one = run(first, () => submitBid(a.id, f.request.id, { ...quote, amountCents: 20000 })); const two = run(second, () => submitBid(b.id, f.request.id, { ...quote, amountCents: 30000 }));
    await gate.reached.promise; gate.release.resolve(); const bids = await Promise.all([one, two]);
    expect(bids.map((bid) => bid.amountCents).sort()).toEqual([20000, 30000]); expect(bids.every((bid) => bid.version === 1 && bid.status === "submitted")).toBe(true);
    expect(await first.serviceBid.count({ where: { requestId: f.request.id, status: "submitted" } })).toBe(3); expect((await saved(f)).status).toBe("open_for_bids");
  });
  it("does not invalidate an award snapshot for a no-op quote update or ignored duplicate insert", async () => {
    const f = await seed("hoa"); const gate = hold("ServiceBid", "findMany", (args) => args.where?.requestId === f.request.id); const awarding = award(f); await gate.reached.promise;
    const stamp = (await saved(f)).updatedAt;
    await second.serviceBid.update({ where: { id: f.bid.id }, data: { amountCents: f.bid.amountCents } });
    const ignored = await second.serviceBid.createMany({ data: [{ requestId: f.request.id, providerUserId: f.provider.id, amountCents: quote.amountCents, pricingBasis: "total", scope: quote.scope }], skipDuplicates: true });
    expect(ignored.count).toBe(0); expect((await saved(f)).updatedAt).toEqual(stamp); gate.release.resolve(); await expect(awarding).resolves.toBeTypeOf("string");
  });
  it("allows exactly one of two competing providers to be awarded", async () => {
    const f = await seed("hoa"); const other = await provider(`other-${randomUUID()}`); const otherBid = await run(second, () => submitBid(other.id, f.request.id, { ...quote, amountCents: 22222 }));
    const gate = hold("ServiceBid", "findUnique", (args) => [f.bid.id, otherBid.id].includes(args.where?.id ?? ""), "both", 2);
    const one = award(f); const two = award(f, second, otherBid.id, otherBid.version); await gate.reached.promise; gate.release.resolve();
    const results = await Promise.allSettled([one, two]); expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1); expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(await first.serviceAgreement.count({ where: { requestId: f.request.id } })).toBe(1);
    expect(await first.serviceBid.count({ where: { requestId: f.request.id, status: "accepted" } })).toBe(1); expect(await first.serviceBid.count({ where: { requestId: f.request.id, status: "rejected" } })).toBe(1);
    expect(await first.notification.count({ where: { userId: { in: [f.provider.id, other.id] }, dedupeKey: { startsWith: "award" , contains: f.request.id } } })).toBe(2);
  });
  it.each(["first-bid", "resubmission"] as const)("refuses an award with stale losing-provider audience after a real %s", async (kind) => {
    const f = await seed("hoa"); const other = await provider(`audience-${randomUUID()}`);
    if (kind === "resubmission") { await run(second, () => submitBid(other.id, f.request.id, quote)); await run(second, () => withdrawBid(other.id, f.request.id)); }
    const gate = hold("ServiceBid", "findMany", (args) => args.where?.requestId === f.request.id); const awarding = award(f); await gate.reached.promise;
    const added = await run(second, () => submitBid(other.id, f.request.id, { ...quote, amountCents: 22222 })); const baseline = await effects(f);
    gate.release.resolve(); await expect(awarding).rejects.toMatchObject({ status: 409 }); expect(await effects(f)).toEqual(baseline);
    expect(await first.serviceBid.findUniqueOrThrow({ where: { id: added.id } })).toMatchObject({ status: "submitted", amountCents: 22222 });
    expect(await first.serviceAgreement.count({ where: { requestId: f.request.id } })).toBe(0);
    await award(f); expect((await first.serviceBid.findUniqueOrThrow({ where: { id: added.id } })).status).toBe("rejected");
    expect(await first.notification.count({ where: { userId: other.id, dedupeKey: `award-rejected:${f.request.id}:${other.id}` } })).toBe(1);
  });
  it.each(["first-bid", "resubmission"] as const)("prevents late %s and its notifications after an award wins", async (kind) => {
    const f = await seed("hoa"); const other = await provider(`late-${randomUUID()}`);
    let oldBidId: string | null = null;
    if (kind === "resubmission") { oldBidId = (await run(second, () => submitBid(other.id, f.request.id, quote))).id; await run(second, () => withdrawBid(other.id, f.request.id)); }
    const gate = hold("ServiceBid", "findUnique", (args) => args.where?.requestId_providerUserId?.providerUserId === other.id);
    const submitting = run(first, () => submitBid(other.id, f.request.id, { ...quote, amountCents: 22222 })); await gate.reached.promise;
    await award(f, second); const baseline = await effects(f); gate.release.resolve(); await expect(submitting).rejects.toMatchObject({ status: 409 });
    expect(await effects(f)).toEqual(baseline); expect((await saved(f)).status).toBe("awarded");
    if (oldBidId) expect(await first.serviceBid.findUniqueOrThrow({ where: { id: oldBidId } })).toMatchObject({ status: "withdrawn", version: 1 });
    else expect(await first.serviceBid.count({ where: { requestId: f.request.id, providerUserId: other.id } })).toBe(0);
  });
  it("preserves HOA unit scope and forbids transplanting a visit to another HOA", async () => {
    const f = await seed("hoa"); const id = await award(f); const foreign = await seed("hoa");
    const visit = await first.serviceVisit.findFirstOrThrow({ where: { occurrence: { agreementId: id } } });
    expect(visit).toMatchObject({ unitId: f.unit!.id, homeownerUserId: null });
    await expect(first.serviceVisit.update({ where: { id: visit.id }, data: { unitId: foreign.unit!.id } })).rejects.toBeDefined();
    expect((await first.serviceVisit.findUniqueOrThrow({ where: { id: visit.id } })).unitId).toBe(f.unit!.id);
  });
  it("validates homeowner identity updates against the locked joined neighborhood targets", async () => {
    const f = await seed("neighborhood"); const id = await award(f); const visit = await first.serviceVisit.findFirstOrThrow({ where: { occurrence: { agreementId: id } } });
    // Manager is an active homeowner member but did not join this request.
    await expect(first.serviceVisit.update({ where: { id: visit.id }, data: { homeownerUserId: f.manager.id } })).rejects.toBeDefined();
    const outsider = (await seed("neighborhood")).resident;
    await expect(first.serviceVisit.update({ where: { id: visit.id }, data: { homeownerUserId: outsider.id } })).rejects.toBeDefined();
    expect((await first.serviceVisit.findUniqueOrThrow({ where: { id: visit.id } })).homeownerUserId).toBe(f.resident.id);
    await expect(first.serviceVisit.update({ where: { id: visit.id }, data: { serviceAddressLine1: "" } })).rejects.toBeDefined();
    await expect(first.serviceVisit.update({ where: { id: visit.id }, data: { serviceLatitude: 91 } })).rejects.toBeDefined();
  });
  it("rejects a manager assignment revoked after the read but before the parent award claim", async () => {
    const f = await seed("hoa"); const gate = hold("ServiceBid", "findUnique", (args) => args.where?.id === f.bid.id); const awarding = award(f); await gate.reached.promise;
    await second.communityStaffAssignment.updateMany({ where: { communityId: f.community.id, userId: f.manager.id }, data: { status: "revoked", revokedAt: new Date() } });
    const baseline = await effects(f); gate.release.resolve(); let failure: unknown; try { await awarding; } catch (error) { failure = error; }
    expect(failure).toBeDefined(); expect([403, 409]).toContain((failure as { status?: number }).status); expect(await effects(f)).toEqual(baseline); expect((await saved(f)).status).toBe("open_for_bids");
  });
  it("rejects a provider suspended after its quote snapshot without leaving a parent claim", async () => {
    const f = await seed("hoa"); const gate = hold("ServiceBid", "findMany", (args) => args.where?.requestId === f.request.id); const awarding = award(f); await gate.reached.promise;
    await second.providerProfile.update({ where: { userId: f.provider.id }, data: { accountStatus: "suspended" } }); const baseline = await effects(f); const row = await saved(f);
    gate.release.resolve(); await expect(awarding).rejects.toBeDefined(); expect(await effects(f)).toEqual(baseline); expect(await saved(f)).toEqual(row);
  });
  it("refuses a quote that expires while acceptance holds on a real provider profile lock", async () => {
    const f = await seed("hoa"); const expires = new Date(Date.now() + 2500);
    await first.serviceBid.update({ where: { id: f.bid.id }, data: { validUntil: expires } });
    const baseline = await effects(f); const row = await saved(f); const bid = await first.serviceBid.findUniqueOrThrow({ where: { id: f.bid.id } });
    const held = deferred(); const release = deferred(); let lockerPid = 0;
    const locker = run(second, () => second.$transaction(async (tx) => {
      lockerPid = (await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`)[0].pid;
      await tx.$queryRaw`SELECT "userId" FROM "ProviderProfile" WHERE "userId" = ${f.provider.id} FOR UPDATE`;
      held.resolve(); await release.promise;
    }, { timeout: 15000 }));
    void locker.catch((error) => held.reject(error));
    let awarding: Promise<string> | null = null;
    try {
      await held.promise; awarding = award(f);
      let blocked = false;
      for (let attempt = 0; attempt < 60; attempt++) {
        const waits = await first.$queryRaw<Array<{ wait_event_type: string; is_bid: boolean }>>`SELECT wait_event_type, position('ServiceBid' in query) > 0 AS is_bid FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid() AND ${lockerPid} = ANY(pg_blocking_pids(pid))`;
        if (waits.some((wait) => wait.wait_event_type === "Lock" && wait.is_bid)) { blocked = true; break; }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(blocked).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, Math.max(0, +expires - Date.now() + 100)));
      const databaseClock = await first.$queryRaw<Array<{ expired: boolean }>>`SELECT (clock_timestamp() AT TIME ZONE 'UTC') > ${expires}::timestamp AS expired`;
      expect(databaseClock[0].expired).toBe(true);
      release.resolve(); await locker;
      const result = await awarding.then(() => ({ accepted: true, status: null }), (error: { status?: number }) => ({ accepted: false, status: error.status ?? null }));
      console.info("[postgres-lock-proof]", JSON.stringify({ blockedOnSelectedProviderProfile: blocked, releasedAfterQuoteExpiry: databaseClock[0].expired, accepted: result.accepted, finalRequestStatus: (await saved(f)).status }));
      expect(result).toEqual({ accepted: false, status: 409 });
      expect(await effects(f)).toEqual(baseline); expect(await saved(f)).toEqual(row); expect(await first.serviceBid.findUniqueOrThrow({ where: { id: f.bid.id } })).toEqual(bid);
      expect(await first.serviceOccurrence.count({ where: { agreement: { requestId: f.request.id } } })).toBe(0); expect(await first.serviceVisit.count({ where: { occurrence: { agreement: { requestId: f.request.id } } } })).toBe(0);
    } finally { release.resolve(); await locker; if (awarding) await Promise.allSettled([awarding]); }
  });
  it("refuses a first bid when the bidding deadline expires during a real provider profile lock wait", async () => {
    const f = await seed("hoa"); const bidder = await provider(`deadline-lock-${randomUUID()}`); const expires = new Date(Date.now() + 2500);
    await first.hoaServiceRequest.update({ where: { id: f.request.id }, data: { biddingClosesAt: expires } });
    const baseline = await effects(f); const row = await saved(f); const bid = await first.serviceBid.findUniqueOrThrow({ where: { id: f.bid.id } });
    const held = deferred(); const release = deferred(); let lockerPid = 0;
    const locker = run(second, () => second.$transaction(async (tx) => {
      lockerPid = (await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`)[0].pid;
      await tx.$queryRaw`SELECT "userId" FROM "ProviderProfile" WHERE "userId" = ${bidder.id} FOR UPDATE`;
      held.resolve(); await release.promise;
    }, { timeout: 15000 }));
    void locker.catch((error) => held.reject(error));
    let submitting: ReturnType<typeof submitBid> | null = null;
    try {
      await held.promise; submitting = run(first, () => submitBid(bidder.id, f.request.id, quote));
      let blocked = false;
      for (let attempt = 0; attempt < 60; attempt++) {
        const waits = await first.$queryRaw<Array<{ wait_event_type: string; is_bid_insert: boolean }>>`SELECT wait_event_type, position('ServiceBid' in query) > 0 AND position('INSERT' in upper(query)) > 0 AS is_bid_insert FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid() AND ${lockerPid} = ANY(pg_blocking_pids(pid))`;
        if (waits.some((wait) => wait.wait_event_type === "Lock" && wait.is_bid_insert)) { blocked = true; break; }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(blocked).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, Math.max(0, +expires - Date.now() + 100)));
      const databaseClock = await first.$queryRaw<Array<{ expired: boolean }>>`SELECT (clock_timestamp() AT TIME ZONE 'UTC') > ${expires}::timestamp AS expired`; expect(databaseClock[0].expired).toBe(true);
      release.resolve(); await locker;
      const result = await submitting.then(() => ({ submitted: true, status: null }), (error: { status?: number }) => ({ submitted: false, status: error.status ?? null }));
      const lateBidCount = await first.serviceBid.count({ where: { requestId: f.request.id, providerUserId: bidder.id } });
      console.info("[postgres-deadline-lock-proof]", JSON.stringify({ blockedOnSelectedProviderProfile: blocked, releasedAfterBiddingDeadline: databaseClock[0].expired, submitted: result.submitted, lateBidCount }));
      expect(result).toEqual({ submitted: false, status: 409 }); expect(lateBidCount).toBe(0);
      expect(await effects(f)).toEqual(baseline); expect(await saved(f)).toEqual(row); expect(await first.serviceBid.findUniqueOrThrow({ where: { id: f.bid.id } })).toEqual(bid);
    } finally { release.resolve(); await locker; if (submitting) await Promise.allSettled([submitting]); }
  });
  it("rolls back successful parent and quote claims after a controlled later audit insertion fault", async () => {
    const f = await seed("neighborhood"); const name = `issue17_audit_fault_${randomUUID().replaceAll("-", "")}`;
    if (!/^[a-zA-Z0-9_-]+$/.test(f.community.id)) throw new Error("Unexpected fixture identifier");
    // Approved isolated fault injection, not a legitimate business scenario.
    // Existing validation and append-only triggers are never disabled.
    await first.$executeRawUnsafe(`CREATE FUNCTION "${name}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'controlled isolated award audit fault' USING ERRCODE = '23514', CONSTRAINT = 'issue17_owned_audit_fault'; END; $$`);
    try {
      await first.$executeRawUnsafe(`CREATE TRIGGER "${name}" BEFORE INSERT ON "AdminAuditLog" FOR EACH ROW WHEN (NEW."communityId" = '${f.community.id}' AND NEW."action" = 'hoa_bid_awarded') EXECUTE FUNCTION "${name}"()`);
      const baseline = await effects(f); const row = await saved(f); const bid = await first.serviceBid.findUniqueOrThrow({ where: { id: f.bid.id } });
      trace.length = 0; observing = true; await expect(award(f)).rejects.toBeDefined(); observing = false;
      expect(trace).toContainEqual({ kind: "parent-claim", rows: 1 }); expect(trace).toContainEqual({ kind: "bid-claim", rows: 1 });
      const fault = trace.findIndex((event) => event.kind === "fault" && event.code === "23514" && event.constraint === "issue17_owned_audit_fault");
      expect(fault).toBeGreaterThan(trace.findIndex((event) => event.kind === "parent-claim")); expect(fault).toBeGreaterThan(trace.findIndex((event) => event.kind === "bid-claim"));
      console.info("[postgres-proof]", JSON.stringify(trace));
      expect(await saved(f)).toEqual(row); expect(await first.serviceBid.findUniqueOrThrow({ where: { id: f.bid.id } })).toEqual(bid); expect(await effects(f)).toEqual(baseline);
      expect(await first.serviceOccurrence.count({ where: { agreement: { requestId: f.request.id } } })).toBe(0); expect(await first.serviceVisit.count({ where: { occurrence: { agreement: { requestId: f.request.id } } } })).toBe(0);
    } finally {
      observing = false; await first.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${name}" ON "AdminAuditLog"`); await first.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${name}"()`);
    }
  });
});
