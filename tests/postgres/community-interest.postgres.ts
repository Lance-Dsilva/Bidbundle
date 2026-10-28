import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
const injection = vi.hoisted(() => ({ current: null as (() => PrismaClient) | null }));
// Only real-client routing is substituted. All persistence and duplicate/error
// classification below uses actual Prisma/PostgreSQL; no SQL result is faked.
vi.mock("@/lib/server/db", () => ({ db: new Proxy({}, { get(_target, key) { const db = injection.current?.(); if (!db) throw new Error("Isolated PostgreSQL client unavailable"); const value = Reflect.get(db, key, db); return typeof value === "function" ? value.bind(db) : value; } }) }));
// Abuse protection is independently unit-tested. This isolated route/database
// suite bypasses only the external Redis boundary, never the real lead service.
vi.mock("@/lib/server/community-interest-guard", async (original) => ({ ...await original<typeof import("@/lib/server/community-interest-guard")>(), guardCommunityInterest: async () => null }));
import { submitCommunityInterest, listCommunityInterest } from "@/lib/server/community-interest";
import { POST } from "@/app/api/community-interest/route";
import { communityInterestSchema, communityInterestKey } from "@/lib/validation/community-interest";
const context = new AsyncLocalStorage<PrismaClient>();
let first: PrismaClient; let second: PrismaClient; let tag: string;
const observed: Array<{ code?: string; constraint?: string }> = [];
const prismaErrorMessages: string[] = [];
function client(connectionString: string) {
  const pool = new Pool({ connectionString });
  pool.on("connect", (connection) => {
    const original = connection.query;
    const observe = (error: unknown) => { const detail = error as { code?: string; constraint?: string } | null; if (detail?.code === "23505") observed.push({ code: detail.code, constraint: detail.constraint }); };
    connection.query = ((...args: unknown[]) => {
      // pg Pool.query uses a callback on its checked-out connection, whereas
      // interactive clients may return promises. Observe either API unchanged.
      const last = args.length - 1; const callback = args[last];
      if (typeof callback === "function") {
        args[last] = function (this: unknown, ...values: unknown[]) { observe(values[0]); return Reflect.apply(callback, this, values); };
        return Reflect.apply(original, connection, args);
      }
      const result = Reflect.apply(original, connection, args) as unknown;
      if (!result || typeof (result as Promise<unknown>).then !== "function") return result;
      return (result as Promise<unknown>).catch((error: unknown) => { observe(error); throw error; });
    }) as typeof connection.query;
  });
  const real = new PrismaClient({ adapter: new PrismaPg(pool, { disposeExternalPool: true }), log: [{ level: "error", emit: "event" }] });
  real.$on("error", (event) => { prismaErrorMessages.push(event.message); });
  return real;
}
function run<T>(db: PrismaClient, fn: () => Promise<T>) { return context.run(db, fn); }
function input(overrides: Record<string, unknown> = {}) { return communityInterestSchema.parse({ contactName: "Isolated Contact", contactRole: "community_manager", communityName: `Owned Community ${tag}`, numberOfHomes: 75, email: `${tag}@example.invalid`, phone: null, ...overrides }); }
function request(value: unknown) { return new Request("https://bundleen.test/api/community-interest", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) }); }
async function authorityCounts() { return { users: await first.user.count(), communities: await first.community.count(), invitations: await first.communityInvitation.count(), grants: await first.adminAccessGrant.count() }; }
beforeAll(async () => { const target = process.env.TEST_DATABASE_URL; if (!target) throw new Error("Explicit disposable issue4 PostgreSQL URL required"); let parsed: URL; try { parsed = new URL(target); } catch { throw new Error("Invalid disposable PostgreSQL test URL"); } if (!["postgres:", "postgresql:"].includes(parsed.protocol) || !["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname) || !/^bundleen_issue4_test(?:_[a-z0-9_-]+)?$/i.test(parsed.pathname.slice(1))) throw new Error("Refusing non-disposable issue4 database"); first = client(target); second = client(target); injection.current = () => context.getStore() ?? first; });
beforeEach(() => { tag = `issue4-${randomUUID()}`; observed.length = 0; prismaErrorMessages.length = 0; });
afterAll(async () => { await Promise.all([first?.$disconnect(), second?.$disconnect()]); });
describe("actual community interest persistence and receipt", () => {
  it("uses independent PostgreSQL sessions and the full migrated schema", async () => { const [a, b] = await Promise.all([first.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`, second.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`]); expect(a[0].pid).not.toBe(b[0].pid); const rows = await first.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`; expect(Number(rows[0].count)).toBeGreaterThanOrEqual(22); });
  it("persists normalized contact data without creating accounts, roles, communities, invites or grants", async () => { const before = await authorityCounts(); const value = input({ email: ` ${tag.toUpperCase()}@EXAMPLE.INVALID `, communityName: `  Owned  Community ${tag} ` }); await run(first, () => submitCommunityInterest(value)); const row = await first.communityInterest.findFirstOrThrow({ where: { email: value.email } }); expect(row).toMatchObject({ ...value, communityKey: communityInterestKey(value.communityName) }); expect(await authorityCounts()).toEqual(before); });
  it("accepts actual concurrent duplicate submissions once and never overwrites the winning contact", async () => { const one = input({ contactName: "First Contact" }); const two = input({ contactName: "Other Contact", phone: "555-0102", communityName: ` ${one.communityName.toUpperCase()} ` }); const results = await Promise.allSettled([run(first, () => submitCommunityInterest(one)), run(second, () => submitCommunityInterest(two))]); expect(results.map((result) => result.status)).toEqual(["fulfilled", "fulfilled"]); expect(await first.communityInterest.count({ where: { email: one.email, communityKey: communityInterestKey(one.communityName) } })).toBe(1); const winner = await first.communityInterest.findFirstOrThrow({ where: { email: one.email } }); await run(second, () => submitCommunityInterest(input({ contactName: "Anonymous overwrite attempt", phone: "555-0999" }))); const after = await first.communityInterest.findUniqueOrThrow({ where: { id: winner.id } }); expect(after).toEqual(winner); expect(observed).toContainEqual({ code: "23505", constraint: "CommunityInterest_email_communityKey_key" }); });
  it("keeps distinct email/community pairs as distinct leads", async () => { await run(first, () => submitCommunityInterest(input())); await run(first, () => submitCommunityInterest(input({ communityName: `Different ${tag}` }))); await run(second, () => submitCommunityInterest(input({ email: `other-${tag}@example.invalid` }))); expect(await first.communityInterest.count({ where: { email: { in: [`${tag}@example.invalid`, `other-${tag}@example.invalid`] } } })).toBe(3); });
  it("returns the identical public201 receipt for new and duplicate data with no identifier or existence leak", async () => { const value = input(); const before = await authorityCounts(); const one = await run(first, () => POST(request(value))); const two = await run(second, () => POST(request({ ...value, contactName: "Untrusted update" }))); expect(one.status).toBe(201); expect(two.status).toBe(201); expect(await one.json()).toEqual({ received: true }); expect(await two.json()).toEqual({ received: true }); expect((await first.communityInterest.findFirstOrThrow({ where: { email: value.email } })).contactName).toBe(value.contactName); expect(await authorityCounts()).toEqual(before); });
  it("does not disguise a real unrelated primary-key violation as received interest", async () => { const existing = await first.communityInterest.create({ data: { ...input(), communityKey: communityInterestKey(input().communityName) } }); const probe = input({ email: `fault-${tag}@example.invalid` }); const name = `issue4_fault_${randomUUID().replaceAll("-", "")}`; if (!/^[a-zA-Z0-9-]+$/.test(existing.id) || !/^[a-zA-Z0-9@._-]+$/.test(probe.email)) throw new Error("Unexpected owned fixture identifier");
    // Fault injection on ONE synthetic email in the disposable DB. Existing
    // schema constraints remain enabled; no legitimate workflow changes IDs.
    await first.$executeRawUnsafe(`CREATE FUNCTION "${name}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW."id" := '${existing.id}'; RETURN NEW; END; $$`);
    try { await first.$executeRawUnsafe(`CREATE TRIGGER "${name}" BEFORE INSERT ON "CommunityInterest" FOR EACH ROW WHEN (NEW."email" = '${probe.email}') EXECUTE FUNCTION "${name}"()`); await expect(run(first, () => submitCommunityInterest(probe))).rejects.toMatchObject({ code: "P2002" }); const response = await run(second, () => POST(request(probe))); expect(response.status).toBe(503); expect(JSON.stringify(await response.json())).not.toMatch(new RegExp(tag)); expect(observed).toContainEqual({ code: "23505", constraint: "CommunityInterest_pkey" }); expect(prismaErrorMessages.some((message) => [probe.email, probe.contactName, probe.communityName].some((value) => message.includes(value)))).toBe(false); expect(await first.communityInterest.count({ where: { email: probe.email } })).toBe(0); expect(await first.communityInterest.findUniqueOrThrow({ where: { id: existing.id } })).toEqual(existing); } finally { await first.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${name}" ON "CommunityInterest"`); await first.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${name}"()`); }
  });
  it.each([{ numberOfHomes: 0 }, { numberOfHomes: 10001 }, { contactName: " " }, { email: "UPPER@EXAMPLE.INVALID" }, { phone: "x".repeat(33) }])("database rejects invalid persisted bounds: %j", async (invalid) => { const value = input(); await expect(first.communityInterest.create({ data: { ...value, communityKey: communityInterestKey(value.communityName), ...invalid } })).rejects.toThrow(); expect(prismaErrorMessages.some((message) => [value.email, value.contactName, value.communityName].some((part) => message.includes(part)))).toBe(false); expect(await first.communityInterest.count({ where: { email: value.email } })).toBe(0); });
  it("lists records with bounded stable pagination and ISO timestamps", async () => { const latest = await first.communityInterest.findFirst({ orderBy: { createdAt: "desc" }, select: { createdAt: true } }); const sameDate = new Date(Math.max(Date.now(), (latest?.createdAt.getTime() ?? 0) + 1000)); const prefix = `page-${tag}`; for (let i = 0; i < 3; i++) await first.communityInterest.create({ data: { ...input({ email: `${prefix}-${i}@example.invalid` }), communityKey: `${prefix}-${i}`, createdAt: sameDate } }); const firstPage = await run(first, () => listCommunityInterest({ page: 1, pageSize: 2 })); const secondPage = await run(second, () => listCommunityInterest({ page: 2, pageSize: 2 })); const expected = await first.communityInterest.findMany({ where: { email: { startsWith: prefix } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] }); expect(firstPage.items.map((item) => item.id)).toEqual(expected.slice(0, 2).map((item) => item.id)); expect(secondPage.items[0].id).toBe(expected[2].id); expect(firstPage.items[0].createdAt).toBe(sameDate.toISOString()); expect(firstPage.items[0]).not.toHaveProperty("communityKey"); });
  it("does not expose contact data through runtime-equivalent Prisma error events", async () => {
    const value = input({ contactName: `PrivateContact-${tag}`, phone: "555-0112" }); await run(first, () => submitCommunityInterest(value)); await run(second, () => submitCommunityInterest(value));
    expect(prismaErrorMessages.length).toBeGreaterThan(0);
    const privateValues = [value.email, value.contactName, value.communityName, value.phone].filter((value): value is string => Boolean(value));
    // Never print raw Prisma messages, even when the assertion finds a leak.
    const leaked = prismaErrorMessages.some((message) => privateValues.some((value) => message.includes(value))); expect(leaked).toBe(false);
  });

  it("does not promote or alter an existing account whose email matches an anonymous manager contact", async () => {
    const value = input(); const user = await first.user.create({ data: { clerkUserId: `existing-${tag}`, email: value.email, fullName: "Existing homeowner", role: "homeowner", isVerified: true } });
    const before = await authorityCounts(); await run(first, () => submitCommunityInterest(value));
    expect(await first.user.findUniqueOrThrow({ where: { id: user.id } })).toEqual(user); expect(await authorityCounts()).toEqual(before);
    expect(await first.communityMembership.count({ where: { userId: user.id } })).toBe(0); expect(await first.communityStaffAssignment.count({ where: { userId: user.id } })).toBe(0);
  });

});
