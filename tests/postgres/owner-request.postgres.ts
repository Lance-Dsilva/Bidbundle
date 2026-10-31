import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
const injection = vi.hoisted(() => ({ current: null as (() => PrismaClient) | null }));
// This is client routing, not simulated SQL or business behavior. Both clients
// connect to the identified disposable, fully migrated PostgreSQL database.
vi.mock("@/lib/server/db", () => ({ db: new Proxy({}, { get(_target, key) { const db = injection.current?.(); if (!db) throw new Error("Uninitialized isolated client"); const value = Reflect.get(db, key, db); return typeof value === "function" ? value.bind(db) : value; } }) }));
import { getNeighborhoodHub, getNeighborhoodRequest, mutateOwnedNeighborhoodRequest, respondToNeighborhoodRequest } from "@/lib/server/neighborhood-market";
import { createHomeownerRequest } from "@/lib/server/homeowner-requests";
import { transitionHoaRequest } from "@/lib/server/hoa-market";
const context = new AsyncLocalStorage<PrismaClient>();
function deferred() { let resolve!: () => void; let reject!: (error: unknown) => void; const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
let pause: { name: string; phase: "read" | "claim"; reached: ReturnType<typeof deferred>; release: ReturnType<typeof deferred>; seen: boolean } | null = null;
let first: PrismaClient; let second: PrismaClient;
const pending: Promise<unknown>[] = [];
let observing = false;
const observed: Array<{ kind: "claim" | "fault"; rows?: number; code?: string; constraint?: string }> = [];
let fixture: { requestId: string; ownerId: string; managerId: string; neighbourId: string; communityId: string; membershipId: string; providerId: string };
const edit = { action: "edit" as const, title: "Edited cleaning scope", category: "cleaning" as const, description: "Updated complete driveway scope", budgetMinCents: 12345, budgetMaxCents: 25000 };
function client(name: string, connectionString: string): PrismaClient {
  const pool = new Pool({ connectionString });
  pool.on("connect", (connection) => {
    const original = connection.query;
    connection.query = ((...args: unknown[]) => {
      const result = Reflect.apply(original, connection, args) as unknown;
      if (!(result instanceof Promise)) return result;
      const sql = args[0] as { text?: string; values?: unknown[] };
      return result.then((value: { rowCount?: number }) => {
        if (observing && name === "first" && /UPDATE\s+(?:"public"\.)?"HoaServiceRequest"/.test(sql.text ?? "") && sql.values?.includes(fixture.requestId)) observed.push({ kind: "claim", rows: value.rowCount });
        return value;
      }, (error: unknown) => {
        if (observing && name === "first") { const detail = error as { code?: string; constraint?: string }; observed.push({ kind: "fault", code: detail.code, constraint: detail.constraint }); }
        throw error;
      });
    }) as typeof connection.query;
  });
  const base = new PrismaClient({ adapter: new PrismaPg(pool, { disposeExternalPool: true }) });
  return base.$extends({ query: { hoaServiceRequest: { async findUnique({ args, query }) {
    const result = await query(args); const gate = pause;
    // Pause AFTER the real snapshot read. Never alter query arguments/results.
    if (gate?.name === name && gate.phase === "read" && !gate.seen && args.where.id === fixture?.requestId) { gate.seen = true; gate.reached.resolve(); await gate.release.promise; }
    return result;
  }, async update({ args, query }) {
    const gate = pause;
    if (gate?.name === name && gate.phase === "claim" && !gate.seen && args.where.id === fixture?.requestId) { gate.seen = true; gate.reached.resolve(); await gate.release.promise; }
    return query(args);
  } } } }) as unknown as PrismaClient;
}
function hold(name: string, phase: "read" | "claim" = "read") { pause = { name, phase, reached: deferred(), release: deferred(), seen: false }; return pause; }
function run<T>(db: PrismaClient, fn: () => Promise<T>) { const promise = context.run(db, fn); pending.push(promise); void promise.catch((error) => { if (pause && !pause.seen) pause.reached.reject(error); }); return promise; }
async function open(db = second) { return run(db, () => transitionHoaRequest(fixture.managerId, fixture.requestId, { action: "open_bidding", biddingClosesAt: new Date(Date.now() + 7 * 86400000).toISOString() })); }
async function counts() { return {
  audit: await first.adminAuditLog.count({ where: { targetId: fixture.requestId } }),
  notification: await first.notification.count({ where: { dedupeKey: { contains: fixture.requestId } } }),
  outbox: await first.outboxEvent.count({ where: { dedupeKey: { contains: fixture.requestId } } }),
}; }
async function row() { return first.hoaServiceRequest.findUniqueOrThrow({ where: { id: fixture.requestId } }); }
async function hoaManager(communityId: string) {
  const tag = randomUUID(); const staff = await first.user.create({ data: { clerkUserId: `hoa-staff-${tag}`, email: `hoa-staff-${tag}@example.invalid`, fullName: "Isolated HOA manager", role: "hoa_staff" } });
  await first.communityStaffAssignment.create({ data: { communityId, userId: staff.id, role: "hoa_manager", status: "active" } });
  return staff;
}
beforeAll(async () => {
  const target = process.env.TEST_DATABASE_URL; if (!target) throw new Error("Explicit disposable TEST_DATABASE_URL required.");
  let parsed: URL;
  try { parsed = new URL(target); } catch { throw new Error("Invalid disposable PostgreSQL test URL."); }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol) || !["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname) || !/^bundleen_issue10_test(?:_[a-z0-9_-]+)?$/i.test(parsed.pathname.slice(1))) throw new Error("Refusing a non-disposable issue10 database.");
  first = client("first", target); second = client("second", target); injection.current = () => context.getStore() ?? first;
});
beforeEach(async () => {
  pause = null; pending.length = 0; observing = false; observed.length = 0; const tag = `issue10-${randomUUID()}`;
  const users = [];
  for (const name of ["owner", "manager", "neighbour"]) users.push(await first.user.create({ data: { clerkUserId: `${tag}-${name}`, email: `${tag}-${name}@example.invalid`, fullName: `Isolated ${name}`, role: "homeowner", address: "1 Test St, Austin, TX 78758", latitude: 30.4, longitude: -97.7, homeownerProfile: { create: { notifyEmail: name !== "neighbour" } } } }));
  const community = await first.community.create({ data: { name: tag, type: "neighborhood", status: "active", centerLatitude: 30.4, centerLongitude: -97.7, radiusMiles: 10 } });
  const memberships = [];
  for (const user of users) memberships.push(await first.communityMembership.create({ data: { communityId: community.id, userId: user.id, status: "active" } }));
  await first.communityStaffAssignment.create({ data: { communityId: community.id, userId: users[1].id, role: "neighborhood_manager", status: "active" } });
  const provider = await first.user.create({ data: { clerkUserId: `${tag}-provider`, email: `${tag}-provider@example.invalid`, role: "provider", fullName: "Isolated Provider", providerProfile: { create: { companyName: "Isolated Provider Company", trades: ["cleaning"], accountStatus: "active", licenseNumber: "TEST-ONLY", insuranceProvider: "TEST-ONLY", licenseVerifiedAt: new Date(), insuranceVerifiedAt: new Date() } }, providerServiceAreas: { create: { label: "Owned test coverage", centerLatitude: 30.4, centerLongitude: -97.7, radiusMiles: 10, postalCodes: [] } } } });
  const request = await first.hoaServiceRequest.create({ data: { communityId: community.id, createdByUserId: users[0].id, title: "Original scope", category: "cleaning", description: "Owned isolated test request", kind: "optional_group", status: "collecting_interest", totalOccurrences: 1, minHomes: 1, budgetMinCents: 10000, budgetMaxCents: 20000, enrollmentClosesAt: new Date(Date.now() + 86400000) } });
  await first.hoaRequestParticipation.create({ data: { requestId: request.id, userId: users[0].id, response: "joined" } });
  fixture = { requestId: request.id, ownerId: users[0].id, managerId: users[1].id, neighbourId: users[2].id, communityId: community.id, membershipId: memberships[0].id, providerId: provider.id };
});
afterEach(async () => { pause?.release.resolve(); await Promise.allSettled(pending); pause = null; });
afterAll(async () => { await Promise.all([first?.$disconnect(), second?.$disconnect()]); });

describe("actual Prisma full-schema owner request lifecycle", () => {
  it("uses independent PostgreSQL sessions with all branch migrations", async () => {
    const [a, b] = await Promise.all([first.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`, second.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`]); expect(a[0].pid).not.toBe(b[0].pid);
    const migrations = await first.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`; expect(Number(migrations[0].count)).toBeGreaterThanOrEqual(22);
  });
  it("commits owner edit with audit and preference-aware notifications, preserving authority/participations", async () => {
    await run(first, () => mutateOwnedNeighborhoodRequest(fixture.ownerId, fixture.requestId, edit)); const saved = await row();
    expect(saved).toMatchObject({ title: edit.title, description: edit.description, category: edit.category, budgetMinCents: 12345, budgetMaxCents: 25000, createdByUserId: fixture.ownerId, communityId: fixture.communityId, status: "collecting_interest", participantsLockedAt: null });
    expect(await first.hoaRequestParticipation.count({ where: { requestId: fixture.requestId } })).toBe(1);
    expect(await counts()).toEqual({ audit: 1, notification: 2, outbox: 1 });
    expect(await first.outboxEvent.count({ where: { dedupeKey: { contains: fixture.neighbourId } } })).toBe(0);
    const audit = await first.adminAuditLog.findFirstOrThrow({ where: { targetId: fixture.requestId } }); expect(audit.metadata).toMatchObject({ via: "request_owner", reason: "owner_edit", previousStatus: "collecting_interest", nextStatus: "collecting_interest" });
  });
  it("cancels once, leaves participant history, and refuses repeated mutation without duplicate effects", async () => {
    await run(first, () => mutateOwnedNeighborhoodRequest(fixture.ownerId, fixture.requestId, { action: "cancel" })); expect((await row()).status).toBe("cancelled"); const after = await counts();
    expect(after).toEqual({ audit: 1, notification: 2, outbox: 1 }); expect(await first.hoaRequestParticipation.count({ where: { requestId: fixture.requestId } })).toBe(1);
    await expect(run(first, () => mutateOwnedNeighborhoodRequest(fixture.ownerId, fixture.requestId, { action: "cancel" }))).rejects.toMatchObject({ status: 409 }); expect(await counts()).toEqual(after);
  });
  it("refuses an active neighbour who does not own the request", async () => {
    await expect(run(first, () => mutateOwnedNeighborhoodRequest(fixture.neighbourId, fixture.requestId, edit))).rejects.toMatchObject({ status: 403 }); expect((await row()).title).toBe("Original scope"); expect(await counts()).toEqual({ audit: 0, notification: 0, outbox: 0 });
  });
  it.each(["edit", "cancel"] as const)("owner %s loses after manager opens bidding from a second real client", async (action) => {
    const gate = hold("first"); const changing = run(first, () => mutateOwnedNeighborhoodRequest(fixture.ownerId, fixture.requestId, action === "edit" ? edit : { action: "cancel" })); await gate.reached.promise;
    await open(); const before = await counts(); expect(await first.notification.count({ where: { userId: fixture.providerId, dedupeKey: { contains: fixture.requestId } } })).toBe(1); gate.release.resolve(); await expect(changing).rejects.toMatchObject({ status: 409 });
    const saved = await row(); expect(saved.status).toBe("open_for_bids"); expect(saved.title).toBe("Original scope"); expect(saved.participantsLockedAt).not.toBeNull(); expect(await counts()).toEqual(before);
  });
  it.each(["edit", "cancel"] as const)("stale manager open cannot overwrite owner %s or create stale provider intents", async (action) => {
    const gate = hold("first"); const opening = open(first); await gate.reached.promise;
    await run(second, () => mutateOwnedNeighborhoodRequest(fixture.ownerId, fixture.requestId, action === "edit" ? edit : { action: "cancel" })); const before = await counts(); gate.release.resolve(); await expect(opening).rejects.toMatchObject({ status: 409 });
    const saved = await row(); expect(saved.status).toBe(action === "edit" ? "collecting_interest" : "cancelled"); expect(saved.title).toBe(action === "edit" ? edit.title : "Original scope"); expect(saved.participantsLockedAt).toBeNull(); expect(await counts()).toEqual(before); expect(await first.notification.count({ where: { userId: fixture.providerId, dedupeKey: { contains: fixture.requestId } } })).toBe(0);
  });
  it("revoked membership between read and claim prevents all owner effects", async () => {
    const gate = hold("first", "claim"); const changing = run(first, () => mutateOwnedNeighborhoodRequest(fixture.ownerId, fixture.requestId, edit)); await gate.reached.promise;
    await second.communityMembership.update({ where: { id: fixture.membershipId }, data: { status: "removed" } }); gate.release.resolve(); await expect(changing).rejects.toMatchObject({ status: 409 });
    expect((await row()).title).toBe("Original scope"); expect(await counts()).toEqual({ audit: 0, notification: 0, outbox: 0 });
  });
  it("a competing owner edit wins exactly once and the stale write leaves no effects", async () => {
    const gate = hold("first"); const stale = run(first, () => mutateOwnedNeighborhoodRequest(fixture.ownerId, fixture.requestId, edit)); await gate.reached.promise;
    await run(second, () => mutateOwnedNeighborhoodRequest(fixture.ownerId, fixture.requestId, { ...edit, title: "Winning edit" })); const before = await counts(); gate.release.resolve(); await expect(stale).rejects.toMatchObject({ status: 409 });
    expect((await row()).title).toBe("Winning edit"); expect(await counts()).toEqual(before);
  });
  it("rolls back a successful owner claim when a controlled later PostgreSQL audit fault occurs", async () => {
    // Fault injection into ONE owned request in the explicitly disposable DB.
    // Existing validation/append-only triggers stay enabled and unchanged.
    const name = `issue10_audit_fault_${randomUUID().replaceAll("-", "")}`;
    if (!/^[a-zA-Z0-9_-]+$/.test(fixture.requestId)) throw new Error("Unexpected fixture identifier");
    await first.$executeRawUnsafe(`CREATE FUNCTION "${name}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'controlled isolated audit fault' USING ERRCODE = '23514', CONSTRAINT = 'issue10_owned_audit_fault'; END; $$`);
    try {
      await first.$executeRawUnsafe(`CREATE TRIGGER "${name}" BEFORE INSERT ON "AdminAuditLog" FOR EACH ROW WHEN (NEW."targetId" = '${fixture.requestId}') EXECUTE FUNCTION "${name}"()`);
      const before = await row(); observing = true;
      await expect(run(first, () => mutateOwnedNeighborhoodRequest(fixture.ownerId, fixture.requestId, edit))).rejects.toBeDefined(); observing = false;
      expect(observed).toEqual([{ kind: "claim", rows: 1 }, { kind: "fault", code: "23514", constraint: "issue10_owned_audit_fault" }]);
      const after = await row(); expect(after.title).toBe(before.title); expect(after.updatedAt).toEqual(before.updatedAt); expect(await counts()).toEqual({ audit: 0, notification: 0, outbox: 0 });
    } finally {
      observing = false; await first.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${name}" ON "AdminAuditLog"`); await first.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${name}"()`);
    }
  });

  it.each(["edit", "cancel"] as const)("stale draft publication cannot overwrite owner %s", async (action) => {
    await first.hoaServiceRequest.update({ where: { id: fixture.requestId }, data: { status: "draft" } });
    const gate = hold("first"); const publishing = run(first, () => transitionHoaRequest(fixture.managerId, fixture.requestId, { action: "publish" })); await gate.reached.promise;
    await run(second, () => mutateOwnedNeighborhoodRequest(fixture.ownerId, fixture.requestId, action === "edit" ? edit : { action: "cancel" })); const before = await counts(); gate.release.resolve(); await expect(publishing).rejects.toMatchObject({ status: 409 });
    expect((await row()).status).toBe(action === "edit" ? "draft" : "cancelled"); expect(await counts()).toEqual(before);
  });
  it.each(["edit", "cancel"] as const)("owner draft %s loses to publication instead of overwriting its snapshot", async (action) => {
    await first.hoaServiceRequest.update({ where: { id: fixture.requestId }, data: { status: "draft" } });
    const gate = hold("first"); const changing = run(first, () => mutateOwnedNeighborhoodRequest(fixture.ownerId, fixture.requestId, action === "edit" ? edit : { action: "cancel" })); await gate.reached.promise;
    await run(second, () => transitionHoaRequest(fixture.managerId, fixture.requestId, { action: "publish" })); const before = await counts(); gate.release.resolve(); await expect(changing).rejects.toMatchObject({ status: 409 });
    const saved = await row(); expect(saved.status).toBe("collecting_interest"); expect(saved.title).toBe("Original scope"); expect(await counts()).toEqual(before);
  });

  it("preserves HOA-only survey creation while accepting legitimate neighbourhood requests", async () => {
    expect((await row()).communityId).toBe(fixture.communityId);
    await expect(first.hoaSurvey.create({ data: { communityId: fixture.communityId, createdByUserId: fixture.ownerId, monthKey: "2026-11", question: "Test survey", options: ["One", "Two"] } })).rejects.toThrow(/active HOA/);
    expect(await first.hoaSurvey.count({ where: { communityId: fixture.communityId } })).toBe(0);
  });
  it.each(["outsider", "wrong-role", "removed-member", "archived-community", "wrong-kind"] as const)("database creator guard rejects neighbourhood %s without weakening existing constraints", async (caseName) => {
    let creator = fixture.ownerId;
    if (caseName === "outsider") { const user = await first.user.create({ data: { clerkUserId: `outside-${randomUUID()}`, email: `outside-${randomUUID()}@example.invalid`, fullName: "Isolated Outsider", role: "homeowner" } }); creator = user.id; }
    if (caseName === "wrong-role") await first.user.update({ where: { id: creator }, data: { role: "provider" } });
    if (caseName === "removed-member") await first.communityMembership.update({ where: { id: fixture.membershipId }, data: { status: "removed" } });
    if (caseName === "archived-community") await first.community.update({ where: { id: fixture.communityId }, data: { status: "archived" } });
    const count = await first.hoaServiceRequest.count({ where: { communityId: fixture.communityId } });
    await expect(first.hoaServiceRequest.create({ data: { communityId: fixture.communityId, createdByUserId: creator, title: "Invalid guard probe", description: "Physically valid fields, unauthorized creator or context", category: "cleaning", kind: caseName === "wrong-kind" ? "compulsory_recurring" : "optional_group", recurrenceLabel: caseName === "wrong-kind" ? "Daily" : null, recurrenceIntervalDays: caseName === "wrong-kind" ? 1 : null, status: "draft" } })).rejects.toThrow();
    expect(await first.hoaServiceRequest.count({ where: { communityId: fixture.communityId } })).toBe(count);
  });
  it("database retains the original active HOA manager creator rule", async () => {
    const community = await first.community.create({ data: { name: `hoa-${randomUUID()}`, type: "hoa", status: "active" } });
    await expect(first.hoaServiceRequest.create({ data: { communityId: community.id, createdByUserId: fixture.ownerId, title: "Wrong HOA creator", category: "cleaning", description: "No manager assignment", kind: "optional_group", status: "draft" } })).rejects.toThrow(/manager/);
    const staff = await hoaManager(community.id);
    const good = await first.hoaServiceRequest.create({ data: { communityId: community.id, createdByUserId: staff.id, title: "Authorized HOA creator", category: "cleaning", description: "Existing manager assignment remains sufficient", kind: "optional_group", status: "draft" } });
    expect(good.communityId).toBe(community.id);
    await expect(run(first, () => mutateOwnedNeighborhoodRequest(staff.id, good.id, edit))).rejects.toMatchObject({ status: 404 });
    await first.communityStaffAssignment.updateMany({ where: { communityId: community.id, userId: staff.id }, data: { status: "revoked", revokedAt: new Date() } });
    await expect(first.hoaServiceRequest.create({ data: { communityId: community.id, createdByUserId: staff.id, title: "Revoked HOA creator", category: "cleaning", description: "Revoked assignment", kind: "optional_group", status: "draft" } })).rejects.toThrow(/manager/);
  });

  it("keeps draft owner controls reachable without revealing the draft to neighbours", async () => {
    await first.hoaServiceRequest.update({ where: { id: fixture.requestId }, data: { status: "draft" } });
    const ownHub = await run(first, () => getNeighborhoodHub(fixture.ownerId)); expect(ownHub?.requests.some((item) => item.id === fixture.requestId && item.permissions.canEdit)).toBe(true);
    expect((await run(first, () => getNeighborhoodRequest(fixture.ownerId, fixture.requestId))).status).toBe("draft");
    const neighbourHub = await run(second, () => getNeighborhoodHub(fixture.neighbourId)); expect(neighbourHub?.requests.some((item) => item.id === fixture.requestId)).toBe(false);
    await expect(run(second, () => getNeighborhoodRequest(fixture.neighbourId, fixture.requestId))).rejects.toMatchObject({ status: 404 });
  });

  it.each(["outsider", "wrong-role", "locked", "wrong-state"] as const)("database neighbourhood participation rejects %s without inventing HOA units", async (caseName) => {
    let resident = fixture.neighbourId;
    if (caseName === "outsider") resident = (await first.user.create({ data: { clerkUserId: `join-outside-${randomUUID()}`, email: `join-outside-${randomUUID()}@example.invalid`, fullName: "Isolated outsider", role: "homeowner" } })).id;
    if (caseName === "wrong-role") await first.user.update({ where: { id: resident }, data: { role: "provider" } });
    if (caseName === "locked") await first.hoaServiceRequest.update({ where: { id: fixture.requestId }, data: { participantsLockedAt: new Date() } });
    if (caseName === "wrong-state") await first.hoaServiceRequest.update({ where: { id: fixture.requestId }, data: { status: "cancelled" } });
    await expect(first.hoaRequestParticipation.create({ data: { requestId: fixture.requestId, userId: resident, unitId: null, response: "joined" } })).rejects.toThrow();
    expect(await first.hoaRequestParticipation.count({ where: { requestId: fixture.requestId } })).toBe(1);
  });
  it("retains HOA optional resident/unit and compulsory unit-snapshot constraints", async () => {
    const tag = randomUUID(); const community = await first.community.create({ data: { name: `hoa-participation-${tag}`, type: "hoa", status: "active" } });
    const staff = await hoaManager(community.id);
    const unit = await first.communityUnit.create({ data: { communityId: community.id, label: "Owned unit" } });
    const resident = await first.user.create({ data: { clerkUserId: `hoa-member-${tag}`, email: `hoa-member-${tag}@example.invalid`, fullName: "Isolated HOA resident", role: "homeowner" } });
    await first.communityMembership.create({ data: { communityId: community.id, userId: resident.id, unitId: unit.id, status: "active" } });
    const optional = await first.hoaServiceRequest.create({ data: { communityId: community.id, createdByUserId: staff.id, title: "Owned HOA optional", category: "cleaning", description: "HOA unit semantics", kind: "optional_group", status: "collecting_interest" } });
    await first.hoaRequestParticipation.create({ data: { requestId: optional.id, userId: resident.id, unitId: unit.id, response: "joined" } });
    await expect(first.hoaRequestParticipation.create({ data: { requestId: optional.id, userId: fixture.ownerId, unitId: null, response: "joined" } })).rejects.toThrow(/unit/);
    // A neighbourhood's homeowner row must never borrow an HOA unit.
    await expect(first.hoaRequestParticipation.create({ data: { requestId: fixture.requestId, userId: fixture.neighbourId, unitId: unit.id, response: "joined" } })).rejects.toThrow();
    const compulsory = await first.hoaServiceRequest.create({ data: { communityId: community.id, createdByUserId: staff.id, title: "Owned HOA recurring", category: "cleaning", description: "Preserve unit snapshots", kind: "compulsory_recurring", recurrenceLabel: "Daily", recurrenceIntervalDays: 1, status: "draft" } });
    await first.hoaRequestParticipation.create({ data: { requestId: compulsory.id, userId: null, unitId: unit.id, response: "joined" } });
    expect(await first.hoaRequestParticipation.count({ where: { requestId: compulsory.id } })).toBe(1);
  });

  it("executes the actual homeowner create/autojoin/read/edit/cancel path against the migrated database", async () => {
    const created = await run(first, () => createHomeownerRequest({ id: fixture.ownerId, role: "homeowner" }, { title: "Actual creator flow", category: "cleaning", description: "Actual service creation and owner controls", budgetMinCents: 1000, budgetMaxCents: 9000 }));
    expect(created.status).toBe("collecting_interest"); expect(created.context).toBe("neighborhood");
    const participation = await first.hoaRequestParticipation.findFirstOrThrow({ where: { requestId: created.id, userId: fixture.ownerId } }); expect(participation.unitId).toBeNull(); expect(participation.response).toBe("joined");
    const hub = await run(first, () => getNeighborhoodHub(fixture.ownerId)); expect(hub?.requests.some((item) => item.id === created.id && item.permissions.canEdit)).toBe(true);
    expect((await run(first, () => getNeighborhoodRequest(fixture.ownerId, created.id))).isOwner).toBe(true);
    await run(first, () => mutateOwnedNeighborhoodRequest(fixture.ownerId, created.id, edit)); expect((await first.hoaServiceRequest.findUniqueOrThrow({ where: { id: created.id } })).title).toBe(edit.title);
    await run(first, () => mutateOwnedNeighborhoodRequest(fixture.ownerId, created.id, { action: "cancel" })); const cancelled = await run(first, () => getNeighborhoodRequest(fixture.ownerId, created.id)); expect(cancelled.status).toBe("cancelled"); expect(cancelled.permissions.canEdit).toBe(false);
    expect(await first.adminAuditLog.count({ where: { targetId: created.id } })).toBe(3);
  });

  it("refuses editing a physically valid but inconsistent pre-bidding row that already has a quote", async () => {
    await open();
    await first.serviceBid.create({ data: { requestId: fixture.requestId, providerUserId: fixture.providerId, amountCents: 12000, pricingBasis: "total", scope: "Full quote", status: "submitted" } });
    // Deliberate guard probe, not a legitimate lifecycle transition. It must
    // not make quoted scope editable even when old status/lock data is wrong.
    await first.hoaServiceRequest.update({ where: { id: fixture.requestId }, data: { status: "collecting_interest", participantsLockedAt: null } });
    const before = await counts(); await expect(run(first, () => mutateOwnedNeighborhoodRequest(fixture.ownerId, fixture.requestId, edit))).rejects.toMatchObject({ status: 409 });
    expect((await row()).title).toBe("Original scope"); expect(await counts()).toEqual(before);
  });

  it("a real new neighbour join invalidates stale bidding scope, then a fresh open locks the new count", async () => {
    const beforeRow = await row(); const gate = hold("first"); const opening = open(first); await gate.reached.promise;
    await run(second, () => respondToNeighborhoodRequest(fixture.neighbourId, fixture.requestId, "joined")); const joined = await row(); expect(joined.updatedAt.getTime()).toBeGreaterThan(beforeRow.updatedAt.getTime()); const beforeEffects = await counts();
    gate.release.resolve(); await expect(opening).rejects.toMatchObject({ status: 409 }); expect((await row()).status).toBe("collecting_interest"); expect(await counts()).toEqual(beforeEffects);
    expect(await first.notification.count({ where: { userId: fixture.providerId, dedupeKey: { contains: fixture.requestId } } })).toBe(0);
    await open(); const audit = await first.adminAuditLog.findFirstOrThrow({ where: { targetId: fixture.requestId, action: "hoa_participants_locked" } }); expect(audit.metadata).toMatchObject({ lockedHomeCount: 2 }); expect((await row()).status).toBe("open_for_bids");
  });
  it("a real neighbour join prevents an owner edit from committing against an older audience snapshot", async () => {
    const gate = hold("first"); const changing = run(first, () => mutateOwnedNeighborhoodRequest(fixture.ownerId, fixture.requestId, edit)); await gate.reached.promise;
    await run(second, () => respondToNeighborhoodRequest(fixture.neighbourId, fixture.requestId, "joined")); const before = await counts(); gate.release.resolve(); await expect(changing).rejects.toMatchObject({ status: 409 });
    expect((await row()).title).toBe("Original scope"); expect(await counts()).toEqual(before); expect(await first.hoaRequestParticipation.count({ where: { requestId: fixture.requestId, response: "joined" } })).toBe(2);
  });
  it("idempotent answers and skipped duplicate inserts preserve a still-valid request snapshot", async () => {
    const before = await row(); const participation = await first.hoaRequestParticipation.findFirstOrThrow({ where: { requestId: fixture.requestId, userId: fixture.ownerId } });
    await run(first, () => respondToNeighborhoodRequest(fixture.ownerId, fixture.requestId, "joined"));
    await first.hoaRequestParticipation.update({ where: { id: participation.id }, data: { response: "joined" } });
    const skipped = await first.hoaRequestParticipation.createMany({ data: [{ requestId: fixture.requestId, userId: fixture.ownerId, unitId: null, response: "joined" }], skipDuplicates: true }); expect(skipped.count).toBe(0);
    expect((await row()).updatedAt).toEqual(before.updatedAt); expect(await counts()).toEqual({ audit: 0, notification: 0, outbox: 0 });
    // A real audience change advances the stamp, unlike these no-ops.
    await run(second, () => respondToNeighborhoodRequest(fixture.neighbourId, fixture.requestId, "joined")); expect((await row()).updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());
  });

  it("a valid participation move invalidates both affected request audience snapshots", async () => {
    const created = await run(first, () => createHomeownerRequest({ id: fixture.ownerId, role: "homeowner" }, { title: "Audience move target", category: "cleaning", description: "Independent collecting request", budgetMinCents: 1000, budgetMaxCents: 3000 }));
    await run(first, () => respondToNeighborhoodRequest(fixture.neighbourId, fixture.requestId, "joined"));
    const participation = await first.hoaRequestParticipation.findFirstOrThrow({ where: { requestId: fixture.requestId, userId: fixture.neighbourId } });
    const beforeOld = await row(); const beforeNew = await first.hoaServiceRequest.findUniqueOrThrow({ where: { id: created.id } });
    // Direct SQL-model move exercises the newly introduced trigger boundary;
    // this does not add or claim a user-facing move endpoint.
    await first.hoaRequestParticipation.update({ where: { id: participation.id }, data: { requestId: created.id } });
    expect((await row()).updatedAt.getTime()).toBeGreaterThan(beforeOld.updatedAt.getTime()); expect((await first.hoaServiceRequest.findUniqueOrThrow({ where: { id: created.id } })).updatedAt.getTime()).toBeGreaterThan(beforeNew.updatedAt.getTime());
    expect(await first.hoaRequestParticipation.count({ where: { requestId: fixture.requestId, response: "joined" } })).toBe(1); expect(await first.hoaRequestParticipation.count({ where: { requestId: created.id, response: "joined" } })).toBe(2);
  });

});
