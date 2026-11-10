import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { Client as PgClient, Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { hoaRequestCreateSchema, bidSubmitSchema } from "@/lib/validation/hoa";
import sharp from "sharp";

const injection = vi.hoisted(() => ({ current: null as (() => PrismaClient) | null }));
const external = vi.hoisted(() => ({ drain: vi.fn(), after: vi.fn(), put: vi.fn(async () => ({})), del: vi.fn(async () => undefined), get: vi.fn() }));
// Only client routing and external delivery/storage transport are substituted.
// SQL, authorization, locks, proof ownership, completion and notification rows are real.
vi.mock("@/lib/server/db", () => ({ db: new Proxy({}, { get(_target, key) {
  const client = injection.current?.(); if (!client) throw new Error("Isolated issue54 client not initialized.");
  const value = Reflect.get(client, key, client); return typeof value === "function" ? value.bind(client) : value;
} }) }));
vi.mock("@vercel/blob", () => ({ put: external.put, del: external.del, get: external.get }));
vi.mock("next/server", async (importActual) => ({ ...await importActual<typeof import("next/server")>(), after: external.after }));
vi.mock("@/lib/server/notifications", async (importActual) => ({
  ...await importActual<typeof import("@/lib/server/notifications")>(), scheduleOutboxDrain: external.drain,
}));

import { createHoaRequest, submitBid, awardBid, saveDayPlan, updateVisitStatus, createVisitReview, getResidentHoaHub } from "@/lib/server/hoa-market";
import { storeVisitPhoto, listVisitPhotos, loadVisitPhotoForAccess, readVisitPhotoBytes, removeVisitPhoto, setVisitPhotoMarketingConsent, MAX_VISIT_PHOTO_BYTES } from "@/lib/server/visit-photos";
import { resolveVisitReviewPrompt, VISIT_REVIEW_DELAY_MS } from "@/lib/server/visit-review-prompts";
import { loadMediaForAccess } from "@/lib/server/media";
import { getProviderRatingSummary } from "@/lib/server/provider-reviews";
import { reviewCreateSchema } from "@/lib/validation/hoa";
import { storeProviderCredential, loadProviderCredentialForAccess } from "@/lib/server/provider-credentials";
import { updateProviderAdministration } from "@/lib/server/providers-admin";


const context = new AsyncLocalStorage<PrismaClient>();
let first: PrismaClient, second: PrismaClient;
function deferred() { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done; }); return { promise, resolve }; }
let readPause: { model: string; operation: string; id: string; hit: ReturnType<typeof deferred>; release: ReturnType<typeof deferred> } | null = null;
let writeSignal: { table: string; id: string; hit: ReturnType<typeof deferred> } | null = null;
const pending: Promise<unknown>[] = [];
const releases: Array<ReturnType<typeof deferred>> = [];
function client(name: string) {
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL!, application_name: `issue54-${name}` });
  pool.on("connect", (connection) => {
    const original = connection.query;
    connection.query = (function (...args: unknown[]) {
      const item = args[0] as { text?: string; values?: unknown[] };
      const text = typeof item === "string" ? item : item.text ?? "";
      const values = item.values ?? (Array.isArray(args[1]) ? args[1] : []);
      if (name === "first" && writeSignal && values.includes(writeSignal.id) &&
        new RegExp(`(?:INSERT INTO|UPDATE)\\s+(?:"public"\\.)?"${writeSignal.table}"`).test(text)) writeSignal.hit.resolve();
      return Reflect.apply(original, connection, args);
    }) as typeof connection.query;
  });
  const base = new PrismaClient({ adapter: new PrismaPg(pool, { disposeExternalPool: true }) });
  return base.$extends({ query: { $allModels: { async $allOperations({ model, operation, args, query }) {
    const result = await query(args);
    const held = readPause;
    const where = (args as { where?: { id?: string; userId?: string } }).where;
    if (name === "first" && held && model === held.model && operation === held.operation && (where?.id === held.id || where?.userId === held.id)) {
      readPause = null; held.hit.resolve(); await held.release.promise;
    }
    return result;
  } } } }) as unknown as PrismaClient;
}
function run<T>(db: PrismaClient, work: () => Promise<T>): Promise<T> {
  const result = context.run(db, work); pending.push(result); void result.catch(() => undefined); return result;
}
function holdRead(model: string, id: string, operation = "findUnique") {
  const held = { model, id, operation, hit: deferred(), release: deferred() }; releases.push(held.release); readPause = held; return held;
}
async function reached(signal: ReturnType<typeof deferred>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { await Promise.race([signal.promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Expected real database stage was not reached.")), 5000); })]); }
  finally { if (timer) clearTimeout(timer); }
}
async function past(date: Date) { await new Promise(resolve => setTimeout(resolve, Math.max(0, date.getTime() - Date.now() + 60))); }

async function seed(category = "pool_care", options: { notifyEmail?: boolean; totalOccurrences?: number } = {}) {
  const tag = `proof54-${randomUUID()}`;
  const admin = await first.user.create({ data: { clerkUserId: `${tag}-admin`, email: `${tag}-admin@example.invalid`,
    fullName: "Isolated admin", role: "admin", isVerified: true,
    adminAccess: { create: { email: `${tag}-admin@example.invalid`, status: "active", level: "admin" } } } });
  const manager = await first.user.create({ data: { clerkUserId: `${tag}-manager`, email: `${tag}-manager@example.invalid`, fullName: "Isolated manager", role: "hoa_staff" } });
  const community = await first.community.create({ data: { name: tag, type: "hoa", hoaProfile: { create: {
    legalName: tag, addressLine1: "1 Fixture St", locality: "Austin", region: "TX", postalCode: "78758", totalHomes: 2,
    latitude: 30.4, longitude: -97.7, addressVerificationStatus: "verified",
  } } } });
  await first.communityStaffAssignment.create({ data: { communityId: community.id, userId: manager.id, role: "hoa_manager", status: "active" } });
  const residents: Array<{ user: { id: string; email: string }; unit: { id: string } }> = [];
  for (let index = 0; index < 2; index++) {
    const user = await first.user.create({ data: { clerkUserId: `${tag}-resident-${index}`, email: `${tag}-resident-${index}@example.invalid`,
      fullName: `Owned resident ${index}`, role: "homeowner", isVerified: true,
      homeownerProfile: { create: { notifyEmail: options.notifyEmail ?? false } } } });
    const unit = await first.communityUnit.create({ data: { communityId: community.id, label: `Fixture unit ${index}` } });
    await first.communityMembership.create({ data: { communityId: community.id, userId: user.id, unitId: unit.id, status: "active" } });
    residents.push({ user, unit });
  }
  const provider = await first.user.create({ data: { clerkUserId: `${tag}-provider`, email: `${tag}-provider@example.invalid`,
    fullName: "Isolated provider", role: "provider", isVerified: true,
    providerProfile: { create: { companyName: "Fixture provider", trades: [category], accountStatus: "active",
      licenseNumber: `${tag}-LICENSE`, licenseState: "TX", insuranceProvider: "Fixture insurer", insurancePolicyNumber: `${tag}-POLICY` } },
    providerServiceAreas: { create: { label: "Owned service area", centerLatitude: 30.4, centerLongitude: -97.7, radiusMiles: 10, postalCodes: [] } },
  } });
  for (const kind of ["license", "insurance"] as const) {
    await run(first, () => storeProviderCredential(provider.id, kind, new Blob([`%PDF-1.7\n${kind}\n%%EOF`], { type: "application/pdf" })));
    const profile = await first.providerProfile.findUniqueOrThrow({ where: { userId: provider.id }, include: { licenseDocument: true, insuranceDocument: true } });
    const document = kind === "license" ? profile.licenseDocument! : profile.insuranceDocument!;
    await run(first, () => updateProviderAdministration(admin, provider.id, {
      [kind]: "verify", expectedUpdatedAt: profile.updatedAt.toISOString(), [`${kind}DocumentId`]: document.id,
      [`${kind}DocumentChecksum`]: document.checksum, [`${kind}ExpiresOn`]: "2099-12-31",
      ...(kind === "insurance" ? { insuranceCoverageCents: 100000000, insuranceAdditionalInsured: true } : {}),
    }));
  }
  const requestId = await run(first, () => createHoaRequest(manager.id, community.id, hoaRequestCreateSchema.parse({
    title: tag, category, description: "Owned private photo proof test", kind: "compulsory_recurring", publish: true,
    recurrenceLabel: "Daily", recurrenceIntervalDays: 1, totalOccurrences: options.totalOccurrences ?? 1,
    biddingClosesAt: new Date(Date.now() + 3600000).toISOString(),
  })));
  const bid = await run(first, () => submitBid(provider.id, requestId, bidSubmitSchema.parse({
    amountCents: 10000, pricingBasis: "total", scope: "Fixture whole-job service",
    validUntil: new Date(Date.now() + 86400000).toISOString(),
  })));
  const agreementId = await run(first, () => awardBid(manager.id, requestId, { bidId: bid.id, expectedBidVersion: bid.version }));
  const occurrence = await first.serviceOccurrence.findFirstOrThrow({ where: { agreementId } });
  const unscheduled = await first.serviceVisit.findMany({ where: { occurrenceId: occurrence.id } });
  await run(first, () => saveDayPlan(provider.id, occurrence.id, { publish: true,
    stops: unscheduled.map((visit, index) => ({ visitId: visit.id, stopRank: index + 1, windowStart: "10:00", windowEnd: "11:00" })) }));
  const visits = await first.serviceVisit.findMany({ where: { occurrenceId: occurrence.id } });
  const ownVisit = visits.find(visit => visit.unitId === residents[0].unit.id)!;
  const otherVisit = visits.find(visit => visit.unitId === residents[1].unit.id)!;
  return { tag, admin, manager, community, residents, provider, requestId, agreementId, occurrence, visits, ownVisit, otherVisit };
}
type Fixture = Awaited<ReturnType<typeof seed>>;
async function image(label = "proof") {
  const bytes = await sharp({ create: { width: 24, height: 18, channels: 3, background: { r: label.length, g: 60, b: 90 } } }).png().toBuffer();
  return new Blob([new Uint8Array(bytes)], { type: "image/png" });
}
async function lockRow(table: "ServiceVisit" | "MediaAsset" | "ServiceAgreement" | "CommunityMembership" | "ProviderProfile", id: string) {
  const lock = new PgClient({ connectionString: process.env.TEST_DATABASE_URL! }); await lock.connect(); await lock.query("BEGIN");
  await lock.query(`SELECT id FROM public."${table}" WHERE id=$1 FOR UPDATE`, [id]); return lock;
}
async function assertBlockedBehind(lock: PgClient, name = "first") {
  const blockerPid = (await lock.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const rows = await second.$queryRaw<Array<{ blocked: boolean }>>`SELECT EXISTS (
      SELECT 1 FROM pg_stat_activity WHERE application_name=${`issue54-${name}`}
        AND ${blockerPid} = ANY(pg_blocking_pids(pid))
    ) AS blocked`;
    if (rows[0].blocked) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error("Expected actual PostgreSQL lock wait was not observed.");
}
beforeAll(() => {
  const url = new URL(process.env.TEST_DATABASE_URL!);
  if (url.hostname !== "127.0.0.1" || url.port !== "54371" || !/^\/bundleen_issue54_test_[a-z0-9]+$/.test(url.pathname)) throw new Error("Refusing non-owned issue54 target.");
  first = client("first"); second = client("second"); injection.current = () => context.getStore() ?? first;
});
beforeEach(() => { external.drain.mockClear(); external.after.mockClear(); external.put.mockImplementation(async () => ({})); });
afterEach(async () => { for(const release of releases.splice(0))release.resolve();readPause = null; writeSignal = null; await Promise.allSettled(pending.splice(0)); });
afterAll(async () => { await Promise.all([first?.$disconnect(), second?.$disconnect()]); });

const upload = (f: Fixture, purpose: "visit_before" | "visit_after" = "visit_after", visitId = f.ownVisit.id, db = first) => run(db, async () => storeVisitPhoto(f.provider.id, visitId, purpose, await image()));
const complete = (f: Fixture, db = first) => run(db, () => updateVisitStatus(f.provider.id, f.ownVisit.id, { status: "completed", completionNote: null }));
const savedVisit = (f: Fixture) => first.serviceVisit.findUniqueOrThrow({ where: { id: f.ownVisit.id } });
async function prompt(f: Fixture) { return first.outboxEvent.findUniqueOrThrow({ where: { dedupeKey: `visit-review-prompt:${f.ownVisit.id}` } }); }
async function assertNoCompletion(f: Fixture) {
  expect((await savedVisit(f)).status).toBe("scheduled");
  expect(await first.notification.count({ where: { dedupeKey: `visit-status:${f.ownVisit.id}:completed` } })).toBe(0);
  expect(await first.outboxEvent.count({ where: { dedupeKey: `visit-review-prompt:${f.ownVisit.id}` } })).toBe(0);
}
const appUrl = (path: string) => `https://bundleen.example.invalid${path}`;

describe("private service visit photo proof on actual PostgreSQL", () => {
  it("uses independent sessions and leaves the genuine pre-migration pool visit grandfathered", async () => {
    const [a,b] = await Promise.all([first.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`, second.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`]);
    expect(a[0].pid).not.toBe(b[0].pid);
    expect(await first.categoryVisitPolicy.findUnique({ where: { category: "pool_care" } })).toMatchObject({ requiresAfterPhoto: true });
    expect(await first.hoaServiceRequest.findUnique({ where: { id: "issue54-legacy-request" } })).toMatchObject({ requiresAfterPhoto: false });
    expect(await first.serviceVisit.findUnique({ where: { id: "issue54-legacy-visit" } })).toMatchObject({ requiresAfterPhoto: false, status: "scheduled" });
    await run(first, () => updateVisitStatus("issue54-legacy-provider", "issue54-legacy-visit", { status: "completed", completionNote: null }));
    expect(await first.serviceVisit.findUnique({ where: { id: "issue54-legacy-visit" } })).toMatchObject({ requiresAfterPhoto: false, status: "completed" });
  });

  it("snapshots future category policy onto requests and awarded visits without rewriting history", async () => {
    const f = await seed();
    expect(await first.hoaServiceRequest.findUnique({ where: { id: f.requestId } })).toMatchObject({ requiresAfterPhoto: true });
    expect(f.visits.every(visit => visit.requiresAfterPhoto)).toBe(true);
    const oldPolicy = await first.categoryVisitPolicy.findUniqueOrThrow({ where: { category: "pool_care" } });
    try {
      await first.categoryVisitPolicy.update({ where: { category: "pool_care" }, data: { requiresAfterPhoto: false, updatedByUserId: f.admin.id } });
      expect((await savedVisit(f)).requiresAfterPhoto).toBe(true);
      expect(await first.hoaServiceRequest.findUnique({ where: { id: f.requestId } })).toMatchObject({ requiresAfterPhoto: true });
      const future = await seed();
      expect(future.visits.every(visit => !visit.requiresAfterPhoto)).toBe(true);
    } finally { await first.categoryVisitPolicy.update({ where: { category: "pool_care" }, data: { requiresAfterPhoto: oldPolicy.requiresAfterPhoto, updatedByUserId: f.admin.id } }); }
  });

  it("rejects direct downgrades of a required proof snapshot", async () => {
    const f = await seed();
    await expect(first.serviceVisit.update({ where: { id: f.ownVisit.id }, data: { requiresAfterPhoto: false } })).rejects.toThrow();
    expect((await savedVisit(f)).requiresAfterPhoto).toBe(true);
  });

  it("cannot bypass required after evidence by inserting an already completed visit", async () => {
    const f = await seed();
    const occurrence = await first.serviceOccurrence.create({ data: { agreementId: f.agreementId, sequence: 2, serviceDate: new Date() } });
    await expect(first.serviceVisit.create({ data: { occurrenceId: occurrence.id, unitId: f.residents[0].unit.id,
      status: "completed", completedAt: new Date() } })).rejects.toThrow();
    expect(await first.serviceVisit.count({ where: { occurrenceId: occurrence.id } })).toBe(0);
  });

  it("normalizes real image bytes into private immutable storage and returns an authorized reference", async () => {
    const f = await seed(); external.put.mockClear();
    const photo = await upload(f, "visit_before");
    expect(photo).toMatchObject({ purpose: "visit_before", src: `/api/visit-photos/${photo.id}`, marketingConsented: false });
    const asset = await first.mediaAsset.findUniqueOrThrow({ where: { id: photo.id } });
    expect(asset).toMatchObject({ visitId: f.ownVisit.id, uploaderUserId: f.provider.id, communityId: f.community.id,
      purpose: "visit_before", storageUrl: "", marketingConsentUserId: null });
    expect(asset.storagePath).toMatch(new RegExp(`^visit-photos/${f.ownVisit.id}/visit_before/[a-f0-9-]{36}\\.png$`));
    expect(external.put).toHaveBeenCalledTimes(1);
    const call = external.put.mock.calls[0] as unknown as [string, Buffer, { access: string; allowOverwrite: boolean; token: string }];
    expect(call[0]).toBe(asset.storagePath); expect(call[2]).toMatchObject({ access: "private", allowOverwrite: false });
    expect(asset.checksum).toBe(createHash("sha256").update(call[1]).digest("hex"));
    expect((await sharp(call[1]).metadata()).exif).toBeUndefined();
    const wire = JSON.stringify(await run(first, () => listVisitPhotos(f.residents[0].user.id, f.ownVisit.id)));
    expect(wire).not.toContain("storagePath"); expect(wire).not.toContain("storageUrl"); expect(wire).not.toContain("blob.vercel");
  });

  it("fails closed without the dedicated private token and never falls back to another storage token", async () => {
    const f = await seed(); const original = process.env.VISIT_PHOTO_BLOB_READ_WRITE_TOKEN; external.put.mockClear();
    delete process.env.VISIT_PHOTO_BLOB_READ_WRITE_TOKEN;
    try { await expect(upload(f)).rejects.toMatchObject({ status: 503 }); expect(external.put).not.toHaveBeenCalled(); }
    finally { process.env.VISIT_PHOTO_BLOB_READ_WRITE_TOKEN = original; }
  });

  it("bounds input before storage and rejects executable or unreadable content", async () => {
    const f = await seed(); external.put.mockClear();
    await expect(run(first, () => storeVisitPhoto(f.provider.id, f.ownVisit.id, "visit_after", new Blob([new Uint8Array(MAX_VISIT_PHOTO_BYTES + 1)], { type: "image/png" })))).rejects.toMatchObject({ status: 413 });
    await expect(run(first, () => storeVisitPhoto(f.provider.id, f.ownVisit.id, "visit_after", new Blob(["<script>private</script>"], { type: "image/png" })))).rejects.toMatchObject({ status: 422 });
    expect(external.put).not.toHaveBeenCalled();
  });

  it("allows only the awarded active provider to upload, never residents or managers", async () => {
    const f = await seed(); external.put.mockClear();
    for (const user of [f.residents[0].user, f.manager, f.admin]) {
      await expect(run(first, async () => storeVisitPhoto(user.id, f.ownVisit.id, "visit_after", await image()))).rejects.toMatchObject({ status: 404 });
    }
    await first.providerProfile.update({ where: { userId: f.provider.id }, data: { accountStatus: "suspended" } });
    await expect(upload(f)).rejects.toMatchObject({ status: 403 }); expect(external.put).not.toHaveBeenCalled();
  });

  it("limits a purpose to eight photos under concurrent final-slot uploads and cleans only the losing blob", async () => {
    const f = await seed();
    for (let i=0;i<7;i++) await upload(f);
    const beforeDeleted = external.del.mock.calls.length;
    const bothStored = deferred(), release = deferred(); releases.push(release); let entered = 0;
    external.put.mockImplementation(async () => { entered++; if (entered === 2) bothStored.resolve(); await release.promise; return {}; });
    const attempts = [upload(f, "visit_after", f.ownVisit.id, first), upload(f, "visit_after", f.ownVisit.id, second)];
    await reached(bothStored); release.resolve();
    const results = await Promise.allSettled(attempts);
    external.put.mockImplementation(async () => ({}));
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
    expect(await first.mediaAsset.count({ where: { visitId: f.ownVisit.id, purpose: "visit_after", status: "active" } })).toBe(8);
    expect(external.del.mock.calls.length - beforeDeleted).toBe(1);
    await expect(upload(f)).rejects.toMatchObject({ status: 409 });
    await upload(f, "visit_before");
    expect(await first.mediaAsset.count({ where: { visitId: f.ownVisit.id, purpose: "visit_before", status: "active" } })).toBe(1);
  });

  it("serves only this home, the awarded provider and scoped managers; membership revocation immediately denies access", async () => {
    const f = await seed(); const photo = await upload(f);
    for (const id of [f.residents[0].user.id, f.provider.id, f.manager.id, f.admin.id]) {
      expect(await run(first, () => loadVisitPhotoForAccess(id, photo.id))).not.toBeNull();
    }
    const tag = randomUUID();
    const unrelatedManager = await first.user.create({ data: { clerkUserId: tag, email: `${tag}@example.invalid`, fullName: "Unrelated manager", role: "hoa_staff" } });
    const unrelatedCommunity = await first.community.create({ data: { name: tag, type: "hoa" } });
    await first.communityStaffAssignment.create({ data: { communityId: unrelatedCommunity.id, userId: unrelatedManager.id, role: "hoa_manager", status: "active" } });
    for (const id of [f.residents[1].user.id, unrelatedManager.id, "missing-user"]) {
      expect(await run(first, () => loadVisitPhotoForAccess(id, photo.id))).toBeNull();
      await expect(run(first, () => listVisitPhotos(id, f.ownVisit.id))).rejects.toMatchObject({ status: 404 });
    }
    await first.communityMembership.updateMany({ where: { communityId: f.community.id, userId: f.residents[0].user.id }, data: { status: "removed" } });
    expect(await run(first, () => loadVisitPhotoForAccess(f.residents[0].user.id, photo.id))).toBeNull();
  });

  it("never serves visit proof through amenity or provider credential loaders, or credentials through visit routes", async () => {
    const f = await seed(); const photo = await upload(f);
    expect(await run(first, () => loadMediaForAccess(photo.id))).toBeNull();
    expect(await run(first, () => loadProviderCredentialForAccess(photo.id, { userId: f.provider.id, canReviewProviders: true }))).toBeNull();
    const provider = await first.providerProfile.findUniqueOrThrow({ where: { userId: f.provider.id } });
    expect(await run(first, () => loadVisitPhotoForAccess(f.provider.id, provider.licenseDocumentId!))).toBeNull();
  });

  it("reads only the validated private namespace and never dereferences a URL or another purpose", async () => {
    const f = await seed(); const photo = await upload(f); const asset = await first.mediaAsset.findUniqueOrThrow({ where: { id: photo.id } });
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array([1,2])); controller.close(); } });
    external.get.mockResolvedValue({ statusCode: 200, stream }); external.get.mockClear();
    expect(await readVisitPhotoBytes(asset)).toBe(stream);
    expect(external.get).toHaveBeenCalledWith(asset.storagePath, expect.objectContaining({ access: "private" }));
    external.get.mockClear();
    for (const storagePath of ["https://example.invalid/steal", "provider-credentials/profile/provider_license/file.pdf", "visit-photos/../visit_after/file.png"]) {
      expect(await readVisitPhotoBytes({ storagePath, contentType: "image/png" })).toBeNull();
    }
    expect(external.get).not.toHaveBeenCalled();
  });

  it.each(["visitId", "purpose", "storagePath", "checksum", "uploaderUserId"])("rejects mutation of photo identity field %s", async (field) => {
    const f = await seed(); const photo = await upload(f); const before = await first.mediaAsset.findUniqueOrThrow({ where: { id: photo.id } });
    const value = field === "visitId" ? f.otherVisit.id : field === "purpose" ? "visit_before" : field === "checksum" ? "b".repeat(64) : field === "uploaderUserId" ? f.manager.id : `${before.storagePath}.changed`;
    await expect(first.mediaAsset.update({ where: { id: photo.id }, data: { [field]: value } })).rejects.toThrow();
    expect(await first.mediaAsset.findUniqueOrThrow({ where: { id: photo.id } })).toEqual(before);
  });

  it("refuses completion with no after photo, including before-only proof, without a notification or delayed prompt", async () => {
    const f = await seed(); await upload(f, "visit_before");
    await expect(complete(f)).rejects.toMatchObject({ status: 409 }); await assertNoCompletion(f);
    await expect(first.serviceVisit.update({ where: { id: f.ownVisit.id }, data: { status: "completed", completedAt: new Date() } })).rejects.toThrow();
    await assertNoCompletion(f);
  });

  it("completes with after proof, records the immediate photo notice and exactly one two-hour prompt for the frozen resident", async () => {
    const f = await seed(); await upload(f); await complete(f); const visit = await savedVisit(f); const queued = await prompt(f);
    expect(queued).toMatchObject({ kind: "visit_review_prompt", status: "pending", payload: { visitId: f.ownVisit.id, recipientUserId: f.residents[0].user.id } });
    expect(+queued.nextAttemptAt - +visit.completedAt!).toBe(VISIT_REVIEW_DELAY_MS);
    const notice = await first.notification.findUniqueOrThrow({ where: { dedupeKey: `visit-status:${f.ownVisit.id}:completed` } });
    expect(notice).toMatchObject({ userId: f.residents[0].user.id, kind: "visit" });
    expect(notice.body).toMatch(/photo/i); expect(notice.body).not.toContain("storagePath");
    await complete(f);
    expect(await first.outboxEvent.count({ where: { dedupeKey: queued.dedupeKey } })).toBe(1);
    expect(await first.notification.count({ where: { dedupeKey: notice.dedupeKey } })).toBe(1);
    await expect(run(first, () => resolveVisitReviewPrompt(queued.payload, appUrl, new Date(+queued.nextAttemptAt-1)))).rejects.toThrow(/not due/i);
  });

  it("protects the final after proof from removal or hard deletion after completion", async () => {
    const f = await seed(); const photo = await upload(f); await complete(f);
    await expect(run(first, () => removeVisitPhoto(f.provider.id, f.ownVisit.id, photo.id))).rejects.toMatchObject({ status: 409 });
    await expect(first.mediaAsset.delete({ where: { id: photo.id } })).rejects.toThrow();
    await expect(first.mediaAsset.update({ where: { id: photo.id }, data: { status: "removed", deletedAt: new Date() } })).rejects.toThrow();
    expect(await first.mediaAsset.findUnique({ where: { id: photo.id } })).toMatchObject({ status: "active" });
  });

  it("rolls back a prepared completion overtaken by removal of its final after photo", async () => {
    const f = await seed(); const photo = await upload(f);
    const held = holdRead("ServiceVisit", f.ownVisit.id); const delayed = complete(f); await reached(held.hit);
    await run(second, () => removeVisitPhoto(f.provider.id, f.ownVisit.id, photo.id));
    held.release.resolve(); await expect(delayed).rejects.toThrow(); await assertNoCompletion(f);
  });

  it("rechecks final after evidence after a real visit-row lock wait and rolls back every completion effect", async () => {
    const f = await seed(); const photo = await upload(f); const lock = await lockRow("ServiceVisit", f.ownVisit.id);
    try {
      const delayed = complete(f); await assertBlockedBehind(lock);
      await lock.query('UPDATE "MediaAsset" SET "status"=\'removed\', "deletedAt"=NOW(), "updatedAt"=NOW() WHERE id=$1', [photo.id]);
      await lock.query("COMMIT");
      await expect(delayed).rejects.toThrow(); await assertNoCompletion(f);
    } finally { await lock.query("ROLLBACK").catch(() => undefined); await lock.end(); }
  });

  it("rejects and cleans an upload whose provider is suspended during a real profile-lock wait", async () => {
    const f = await seed(); const profile = await first.providerProfile.findUniqueOrThrow({ where: { userId: f.provider.id } });
    const lock = await lockRow("ProviderProfile", profile.id); const deletedBefore = external.del.mock.calls.length;
    try {
      const delayed = upload(f); await assertBlockedBehind(lock);
      await lock.query('UPDATE "ProviderProfile" SET "accountStatus"=\'suspended\', "updatedAt"=NOW() WHERE id=$1', [profile.id]);
      await lock.query("COMMIT");
      await expect(delayed).rejects.toMatchObject({ status: 409 });
      expect(await first.mediaAsset.count({ where: { visitId: f.ownVisit.id } })).toBe(0);
      expect(external.del.mock.calls.length - deletedBefore).toBe(1); await assertNoCompletion(f);
    } finally { await lock.query("ROLLBACK").catch(() => undefined); await lock.end(); }
  });

  it("rejects and cleans an upload if the agreement is cancelled during a real agreement-lock wait", async () => {
    const f = await seed();
    const lock = await lockRow("ServiceAgreement", f.agreementId); const deletedBefore = external.del.mock.calls.length;
    try {
      const delayed = upload(f); await assertBlockedBehind(lock);
      await lock.query('UPDATE "ServiceAgreement" SET "status"=\'cancelled\', "updatedAt"=NOW() WHERE id=$1', [f.agreementId]);
      await lock.query("COMMIT");
      await expect(delayed).rejects.toMatchObject({ status: 409 });
      expect(await first.mediaAsset.count({ where: { visitId: f.ownVisit.id } })).toBe(0);
      expect(external.del.mock.calls.length - deletedBefore).toBe(1); await assertNoCompletion(f);
    } finally { await lock.query("ROLLBACK").catch(() => undefined); await lock.end(); }
  });

  it("does not attach a slow upload to a household reassigned before its first optional-proof photo", async () => {
    const f = await seed("cleaning"); expect(f.ownVisit.requiresAfterPhoto).toBe(false);
    const stored = deferred(), release = deferred(); releases.push(release);
    external.put.mockImplementation(async () => { stored.resolve(); await release.promise; return {}; });
    const deletedBefore = external.del.mock.calls.length;
    const delayed = upload(f); await reached(stored);
    const newUnit = await second.communityUnit.create({ data: { communityId: f.community.id, label: "Changed target during upload" } });
    await second.serviceVisit.update({ where: { id: f.ownVisit.id }, data: { unitId: newUnit.id } });
    release.resolve(); await expect(delayed).rejects.toMatchObject({ status: 409 });
    expect(await first.mediaAsset.count({ where: { visitId: f.ownVisit.id } })).toBe(0);
    expect(external.del.mock.calls.length - deletedBefore).toBe(1);
  });

  it("grants consent for one exact photo without making it public and lets only its resident revoke", async () => {
    const f = await seed(); const one = await upload(f); const two = await upload(f, "visit_before");
    const accepted = await run(first, () => setVisitPhotoMarketingConsent(f.residents[0].user.id, f.ownVisit.id, one.id, true));
    expect(accepted).toMatchObject({ marketingConsented: true, src: `/api/visit-photos/${one.id}` });
    const saved = await first.mediaAsset.findUniqueOrThrow({ where: { id: one.id } });
    expect(saved).toMatchObject({ marketingConsentUserId: f.residents[0].user.id, marketingConsentVersion: saved.checksum, storageUrl: "" });
    expect((await first.mediaAsset.findUniqueOrThrow({ where: { id: two.id } })).marketingConsentedAt).toBeNull();
    for (const user of [f.provider, f.manager, f.admin, f.residents[1].user]) {
      await expect(run(first, () => setVisitPhotoMarketingConsent(user.id, f.ownVisit.id, one.id, true))).rejects.toMatchObject({ status: 403 });
    }
    expect(await run(first, () => loadVisitPhotoForAccess(f.residents[1].user.id, one.id))).toBeNull();
    await run(first, () => setVisitPhotoMarketingConsent(f.residents[0].user.id, f.ownVisit.id, one.id, false));
    expect(await first.mediaAsset.findUnique({ where: { id: one.id } })).toMatchObject({ marketingConsentedAt: null, marketingConsentUserId: null, marketingConsentVersion: null });
  });

  it("lets a departing resident revoke prior consent without retaining photo access", async () => {
    const f = await seed(); const photo = await upload(f);
    await run(first, () => setVisitPhotoMarketingConsent(f.residents[0].user.id, f.ownVisit.id, photo.id, true));
    await first.communityMembership.updateMany({ where: { communityId: f.community.id, userId: f.residents[0].user.id }, data: { status: "removed" } });
    expect(await run(first, () => loadVisitPhotoForAccess(f.residents[0].user.id, photo.id))).toBeNull();
    await run(first, () => setVisitPhotoMarketingConsent(f.residents[0].user.id, f.ownVisit.id, photo.id, false));
    expect((await first.mediaAsset.findUniqueOrThrow({ where: { id: photo.id } })).marketingConsentedAt).toBeNull();
  });

  it("refuses a prepared consent grant after the resident leaves", async () => {
    const f = await seed(); const photo = await upload(f);
    const held = holdRead("CommunityMembership", f.residents[0].user.id, "findFirst");
    const delayed = run(first, () => setVisitPhotoMarketingConsent(f.residents[0].user.id, f.ownVisit.id, photo.id, true)); await reached(held.hit);
    await second.communityMembership.updateMany({ where: { communityId: f.community.id, userId: f.residents[0].user.id }, data: { status: "removed" } });
    held.release.resolve(); await expect(delayed).rejects.toThrow();
    expect((await first.mediaAsset.findUniqueOrThrow({ where: { id: photo.id } })).marketingConsentedAt).toBeNull();
  });

  it("deduplicates concurrent/retried due prompts and honors inbox-only preferences", async () => {
    const f = await seed(); await upload(f); await complete(f); const queued = await prompt(f);
    const outputs = await Promise.all([run(first, () => resolveVisitReviewPrompt(queued.payload, appUrl, queued.nextAttemptAt)), run(second, () => resolveVisitReviewPrompt(queued.payload, appUrl, queued.nextAttemptAt))]);
    expect(outputs).toEqual([{ kind: "sent", email: null }, { kind: "sent", email: null }]);
    await run(first, () => resolveVisitReviewPrompt(queued.payload, appUrl, queued.nextAttemptAt));
    expect(await first.notification.count({ where: { dedupeKey: `visit-review-prompt:${f.ownVisit.id}:${f.residents[0].user.id}` } })).toBe(1);
    expect(await first.notification.count({ where: { userId: f.residents[1].user.id, kind: "review" } })).toBe(0);
  });

  it("returns stable email intent only for an opted-in frozen recipient, without delivering email", async () => {
    const f = await seed("pool_care", { notifyEmail: true }); await upload(f); await complete(f); const queued = await prompt(f);
    const one = await run(first, () => resolveVisitReviewPrompt(queued.payload, appUrl, queued.nextAttemptAt));
    const retry = await run(second, () => resolveVisitReviewPrompt(queued.payload, appUrl, queued.nextAttemptAt));
    expect(one).toEqual(retry); expect(one).toMatchObject({ kind: "sent", email: { to: f.residents[0].user.email } });
    expect(JSON.stringify(one)).not.toContain("blob.vercel"); expect(JSON.stringify(one)).not.toContain("storagePath");
    expect(await first.notification.count({ where: { dedupeKey: `visit-review-prompt:${f.ownVisit.id}:${f.residents[0].user.id}` } })).toBe(1);
  });

  it("skips a rated visit and accepts an actual stars-only review in published rating totals", async () => {
    const f = await seed(); await upload(f); await complete(f); const queued = await prompt(f);
    await run(first, () => createVisitReview(f.residents[0].user.id, f.ownVisit.id, reviewCreateSchema.parse({ rating: 5 })));
    expect(await first.review.findFirst({ where: { visitId: f.ownVisit.id } })).toMatchObject({ rating: 5, comment: "", status: "published" });
    expect(await run(first, () => getProviderRatingSummary(f.provider.id))).toMatchObject({ averageRating: 5, totalCount: 1 });
    expect(await run(first, () => resolveVisitReviewPrompt(queued.payload, appUrl, queued.nextAttemptAt))).toMatchObject({ kind: "skipped", reason: "already_reviewed" });
    await expect(run(first, () => createVisitReview(f.residents[0].user.id, f.ownVisit.id, reviewCreateSchema.parse({ rating: 4 })))).rejects.toThrow(/already/i);
    await expect(run(first, () => createVisitReview(f.residents[1].user.id, f.ownVisit.id, reviewCreateSchema.parse({ rating: 4 })))).rejects.toThrow(/own home/i);
    await first.review.updateMany({ where: { visitId: f.ownVisit.id }, data: { status: "removed" } });
    expect(await run(first, () => getProviderRatingSummary(f.provider.id))).toMatchObject({ averageRating: null, totalCount: 0 });
  });

  it("skips a frozen recipient whose role changes while their old membership remains active", async () => {
    const f = await seed(); await upload(f); await complete(f); const queued = await prompt(f);
    await first.user.update({ where: { id: f.residents[0].user.id }, data: { role: "provider" } });
    expect(await first.communityMembership.findFirst({ where: { communityId: f.community.id, userId: f.residents[0].user.id } })).toMatchObject({ status: "active" });
    expect(await run(first, () => resolveVisitReviewPrompt(queued.payload, appUrl, queued.nextAttemptAt))).toMatchObject({ kind: "skipped", reason: "inactive_recipient" });
    expect(await first.notification.count({ where: { dedupeKey: `visit-review-prompt:${f.ownVisit.id}:${f.residents[0].user.id}` } })).toBe(0);
  });

  it("keeps a just-completed own visit and its proof/rating handoff visible beyond twenty materialized visits", async () => {
    const f = await seed("pool_care", { totalOccurrences: 21 });
    const scope = { unitId: f.residents[0].unit.id, occurrence: { agreement: { communityId: f.community.id } } };
    const own = await first.serviceVisit.findMany({ where: scope }); expect(own).toHaveLength(21);
    expect(new Set(own.map(visit => +visit.createdAt)).size).toBe(1);
    const oldTop = await first.serviceVisit.findMany({ where: scope, orderBy: { createdAt: "desc" }, take: 20 });
    const target = own.find(visit => !oldTop.some(old => old.id === visit.id))!; expect(target).toBeDefined();
    const day = await first.serviceVisit.findMany({ where: { occurrenceId: target.occurrenceId } });
    await run(first, () => saveDayPlan(f.provider.id, target.occurrenceId, { publish: true, stops: day.map((visit, index) => ({ visitId: visit.id, stopRank: index+1 })) }));
    const targetFixture = { ...f, ownVisit: target }; const photo = await upload(targetFixture); await complete(targetFixture);
    const hub = await run(first, () => getResidentHoaHub(f.residents[0].user.id));
    const visits = hub.communities.find(community => community.id === f.community.id)!.myVisits;
    expect(visits[0]).toMatchObject({ id: target.id, status: "completed", canReview: true });
    expect(visits[0].photos?.map(item => item.id)).toContain(photo.id);
    expect(visits.every(visit => visit.unitId === f.residents[0].unit.id)).toBe(true);
    expect(visits.map(visit => visit.id)).not.toContain(f.otherVisit.id);
  });

  it("never redirects a pending prompt or its retry to a replacement resident", async () => {
    const f = await seed(); await upload(f); await complete(f); const queued = await prompt(f);
    await first.communityMembership.updateMany({ where: { communityId: f.community.id, userId: f.residents[0].user.id }, data: { status: "removed" } });
    const tag = randomUUID();
    const replacement = await first.user.create({ data: { clerkUserId: tag, email: `${tag}@example.invalid`, fullName: "Replacement resident", role: "homeowner", isVerified: true } });
    await first.communityMembership.create({ data: { communityId: f.community.id, unitId: f.residents[0].unit.id, userId: replacement.id, status: "active" } });
    expect(await run(first, () => resolveVisitReviewPrompt(queued.payload, appUrl, queued.nextAttemptAt))).toMatchObject({ kind: "skipped", reason: "inactive_recipient" });
    expect(await run(second, () => resolveVisitReviewPrompt(queued.payload, appUrl, queued.nextAttemptAt))).toMatchObject({ kind: "skipped", reason: "inactive_recipient" });
    expect(await first.notification.count({ where: { userId: replacement.id, kind: "review" } })).toBe(0);
  });
});
