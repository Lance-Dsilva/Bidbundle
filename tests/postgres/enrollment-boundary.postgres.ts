import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

const injection = vi.hoisted(() => ({ current: null as (() => PrismaClient) | null }));
// Select an actual client per workflow; authorization, SQL and transactions remain real.
vi.mock("@/lib/server/db", () => ({ db: new Proxy({}, {
  get(_target, key) {
    const client = injection.current?.();
    if (!client) throw new Error("Uninitialized isolated PostgreSQL client");
    const value = Reflect.get(client, key, client);
    return typeof value === "function" ? value.bind(client) : value;
  },
}) }));
import { respondToNeighborhoodRequest } from "@/lib/server/neighborhood-market";

const context = new AsyncLocalStorage<PrismaClient>();
const applicationName = `enrollment-boundary-${randomUUID()}`;
const boundary = "HoaRequestParticipation_enrollment_open_required";
const rawErrors: Array<{ code?: string; constraint?: string; detail?: string }> = [];
let first: PrismaClient;
let second: PrismaClient;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function client(target: string, name: string) {
  const pool = new Pool({ connectionString: target, application_name: name });
  pool.on("connect", (connection) => {
    const original = connection.query;
    connection.query = ((...args: unknown[]) => {
      const record = (error: unknown) => {
        if (error) {
          const detail = error as { code?: string; constraint?: string; detail?: string };
          rawErrors.push({ code: detail.code, constraint: detail.constraint, detail: detail.detail });
        }
      };
      const callback = args[args.length - 1];
      if (typeof callback === "function") {
        args[args.length - 1] = function (this: unknown, ...values: unknown[]) {
          record(values[0]);
          return Reflect.apply(callback, this, values);
        };
        return Reflect.apply(original, connection, args);
      }
      const result = Reflect.apply(original, connection, args) as unknown;
      return result instanceof Promise ? result.catch((error: unknown) => { record(error); throw error; }) : result;
    }) as typeof connection.query;
  });
  return new PrismaClient({ adapter: new PrismaPg(pool, { disposeExternalPool: true }) });
}

async function fixture(deadline: "elapsed" | "future" | "none" = "future") {
  const tag = `enrollment-${randomUUID()}`;
  const owner = await first.user.create({ data: {
    clerkUserId: `${tag}-owner`, email: `${tag}-owner@example.invalid`, role: "homeowner", fullName: "Isolated owner",
    address: "1 Test St, Austin, TX 78758", latitude: 30.4, longitude: -97.7,
  } });
  const neighbour = await first.user.create({ data: {
    clerkUserId: `${tag}-neighbour`, email: `${tag}-neighbour@example.invalid`, role: "homeowner", fullName: "Isolated neighbour",
    address: "2 Test St, Austin, TX 78758", latitude: 30.4, longitude: -97.7,
  } });
  const community = await first.community.create({ data: {
    name: tag, type: "neighborhood", status: "active", centerLatitude: 30.4, centerLongitude: -97.7, radiusMiles: 10,
  } });
  await first.communityMembership.createMany({ data: [owner, neighbour].map((user) => ({
    communityId: community.id, userId: user.id, status: "active" as const,
  })) });
  const clock = await first.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
  const enrollmentClosesAt = deadline === "none" ? null : new Date(clock[0].now.getTime() + (deadline === "elapsed" ? -1000 : 60_000));
  const request = await first.hoaServiceRequest.create({ data: {
    communityId: community.id, createdByUserId: owner.id, title: tag, category: "cleaning", description: "Owned enrollment boundary regression",
    kind: "optional_group", status: "collecting_interest", minHomes: 1, totalOccurrences: 1, enrollmentClosesAt,
  } });
  return { owner, neighbour, community, request };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;

async function snapshot(f: Fixture) {
  return {
    request: await first.hoaServiceRequest.findUniqueOrThrow({ where: { id: f.request.id } }),
    children: await first.hoaRequestParticipation.findMany({ where: { requestId: f.request.id }, orderBy: { id: "asc" } }),
    audit: await first.adminAuditLog.count({ where: { targetId: f.request.id } }),
    notifications: await first.notification.count({ where: { userId: { in: [f.owner.id, f.neighbour.id] } } }),
    outbox: await first.outboxEvent.count({ where: { dedupeKey: { contains: f.request.id } } }),
  };
}

function insert(f: Fixture) {
  return first.hoaRequestParticipation.create({ data: {
    requestId: f.request.id, userId: f.neighbour.id, unitId: null, response: "joined",
  } });
}

function expectBoundaryError() {
  expect(rawErrors).toContainEqual({ code: "23514", constraint: boundary, detail: boundary });
}

// Observe actual PostgreSQL lock waiting and clock expiry before releasing our lock.
// No query result, transaction, trigger or database clock is substituted.
async function acrossDeadline<T>(f: Fixture, action: () => Promise<T>, lockTarget: "parent" | "authority" = "parent") {
  const clock = await first.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
  const deadline = new Date(clock[0].now.getTime() + 4000);
  await first.hoaServiceRequest.update({ where: { id: f.request.id }, data: { enrollmentClosesAt: deadline } });
  const before = await snapshot(f);
  const ready = deferred<number>();
  const release = deferred<void>();
  const locking = second.$transaction(async (tx) => {
    const rows = lockTarget === "parent"
      ? await tx.$queryRaw<Array<{ pid: number }>>`
        SELECT pg_backend_pid() AS pid FROM "HoaServiceRequest" WHERE "id" = ${f.request.id} FOR UPDATE`
      : await tx.$queryRaw<Array<{ pid: number }>>`
        SELECT pg_backend_pid() AS pid FROM "User" WHERE "id" = ${f.neighbour.id} FOR UPDATE`;
    ready.resolve(rows[0].pid);
    await release.promise;
  }, { timeout: 20_000 });
  void locking.catch(ready.reject);
  let operation: Promise<{ ok: true; value: T } | { ok: false; error: unknown }> | undefined;
  let observedWait = false;
  let releasedAfterDeadline = false;
  try {
    const blockerPid = await ready.promise;
    operation = action().then((value) => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
    const limit = Date.now() + 8000;
    while (Date.now() < limit) {
      const rows = await first.$queryRaw<Array<{ waiting: boolean; elapsed: boolean; startedBeforeDeadline: boolean }>>`
        SELECT (clock_timestamp() AT TIME ZONE 'UTC') >= ${deadline}::timestamp AS elapsed,
          EXISTS (SELECT 1 FROM pg_stat_activity a WHERE a.datname = current_database()
            AND a.application_name = ${applicationName} AND ${blockerPid} = ANY(pg_blocking_pids(a.pid))) AS waiting,
          EXISTS (SELECT 1 FROM pg_stat_activity a WHERE a.datname = current_database()
            AND a.application_name = ${applicationName} AND ${blockerPid} = ANY(pg_blocking_pids(a.pid))
            AND (a.xact_start AT TIME ZONE 'UTC') < ${deadline}::timestamp) AS "startedBeforeDeadline"`;
      if (rows[0].waiting) {
        observedWait = true;
        expect(rows[0].startedBeforeDeadline).toBe(true);
      }
      if (rows[0].elapsed) {
        releasedAfterDeadline = true;
        break;
      }
      await new Promise((done) => setTimeout(done, 35));
    }
  } finally {
    release.resolve();
    await locking;
  }
  const outcome = await operation;
  expect(observedWait).toBe(true);
  expect(releasedAfterDeadline).toBe(true);
  if (!outcome) throw new Error("Enrollment operation never started");
  return { outcome, before };
}

beforeAll(() => {
  const target = process.env.TEST_DATABASE_URL;
  if (!target) throw new Error("Explicit disposable issue10 PostgreSQL URL required");
  let url: URL;
  try { url = new URL(target); } catch { throw new Error("Invalid disposable PostgreSQL URL"); }
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
      url.pathname !== "/bundleen_issue10_test" || url.search || url.hash) throw new Error("Refusing non-disposable enrollment target");
  first = client(target, applicationName);
  second = client(target, `${applicationName}-lock`);
  injection.current = () => context.getStore() ?? first;
});
beforeEach(() => { rawErrors.length = 0; });
afterAll(async () => { await Promise.all([first?.$disconnect(), second?.$disconnect()]); });

describe("actual PostgreSQL neighborhood enrollment deadline boundary", () => {
  it("accepts a legitimate unitless homeowner response and advances its parent snapshot", async () => {
    const f = await fixture("none");
    const before = await snapshot(f);
    await insert(f);
    const after = await snapshot(f);
    expect(after.children).toHaveLength(1);
    expect(after.children[0]).toMatchObject({ userId: f.neighbour.id, unitId: null, response: "joined" });
    expect(after.request.updatedAt.getTime()).toBeGreaterThan(before.request.updatedAt.getTime());
  });

  it("rejects a direct late INSERT with the recognized constraint detail and no child or stamp", async () => {
    const f = await fixture("elapsed");
    const before = await snapshot(f);
    await expect(insert(f)).rejects.toThrow();
    expectBoundaryError();
    expect(await snapshot(f)).toEqual(before);
  });

  it("rejects a direct late response UPDATE without changing its existing child or parent stamp", async () => {
    const f = await fixture();
    const child = await insert(f);
    await first.hoaServiceRequest.update({ where: { id: f.request.id }, data: { enrollmentClosesAt: new Date(Date.now() - 1000) } });
    const before = await snapshot(f);
    await expect(first.hoaRequestParticipation.update({ where: { id: child.id }, data: { response: "declined" } })).rejects.toThrow();
    expectBoundaryError();
    expect(await snapshot(f)).toEqual(before);
  });

  it("uses the live database clock after an INSERT waits on its parent across enrollment expiry", async () => {
    const f = await fixture();
    const { outcome, before } = await acrossDeadline(f, () => insert(f));
    expect(outcome.ok).toBe(false);
    expectBoundaryError();
    expect(await snapshot(f)).toEqual(before);
  });

  it("returns409 and rolls back the real response parent claim when a lock wait crosses enrollment expiry", async () => {
    const f = await fixture();
    const { outcome, before } = await acrossDeadline(f, () => context.run(first,
      () => respondToNeighborhoodRequest(f.neighbour.id, f.request.id, "joined")));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toMatchObject({ status: 409 });
    expectBoundaryError();
    expect(await snapshot(f)).toEqual(before);
  });

  it("rechecks expiry after the real response waits for homeowner authority with its parent already claimed", async () => {
    const f = await fixture();
    const { outcome, before } = await acrossDeadline(f, () => context.run(first,
      () => respondToNeighborhoodRequest(f.neighbour.id, f.request.id, "joined")), "authority");
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toMatchObject({ status: 409 });
    expectBoundaryError();
    expect(await snapshot(f)).toEqual(before);
  });
});
