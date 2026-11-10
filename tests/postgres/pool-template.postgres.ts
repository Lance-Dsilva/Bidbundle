import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { Client as PgClient, Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { hoaRequestCreateSchema, bidSubmitSchema } from "@/lib/validation/hoa";
import type { PoolTemplate, PoolQuote, PoolTier, PoolAgreementSnapshot } from "@/lib/pool-bid-template";

const injection = vi.hoisted(() => ({ current: null as (() => PrismaClient) | null }));
const external = vi.hoisted(() => ({ drain: vi.fn(), after: vi.fn(), put: vi.fn(async () => ({})), del: vi.fn(async () => undefined), get: vi.fn() }));
// Only client routing and external delivery/storage transport are substituted.
// SQL, authorization, locks, revisions, prices and notification rows are real.
vi.mock("@/lib/server/db", () => ({ db: new Proxy({}, { get(_target, key) {
  const client = injection.current?.(); if (!client) throw new Error("Isolated issue52 client not initialized.");
  const value = Reflect.get(client, key, client); return typeof value === "function" ? value.bind(client) : value;
} }) }));
vi.mock("@vercel/blob", () => ({ put: external.put, del: external.del, get: external.get }));
vi.mock("next/server", async (importActual) => ({ ...await importActual<typeof import("next/server")>(), after: external.after }));
vi.mock("@/lib/server/notifications", async (importActual) => ({
  ...await importActual<typeof import("@/lib/server/notifications")>(), scheduleOutboxDrain: external.drain,
}));

import { createHoaRequest, respondToOptionalRequest, transitionHoaRequest, submitBid, awardBid, listRequestBids, getResidentHoaHub } from "@/lib/server/hoa-market";
import { storeProviderCredential } from "@/lib/server/provider-credentials";
import { updateProviderAdministration } from "@/lib/server/providers-admin";
import { inviteProviderToBid, listProviderBidInvitations } from "@/lib/server/provider-bid-invitations";

const context = new AsyncLocalStorage<PrismaClient>();
let first: PrismaClient, second: PrismaClient;
function deferred() { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done; }); return { promise, resolve }; }
let readPause: { model: string; operation: string; id: string; hit: ReturnType<typeof deferred>; release: ReturnType<typeof deferred> } | null = null;
let writeSignal: { table: string; id: string; hit: ReturnType<typeof deferred> } | null = null;
const pending: Promise<unknown>[] = [];
const releases: Array<ReturnType<typeof deferred>> = [];
function client(name: string) {
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL!, application_name: `issue52-${name}` });
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
    const where = (args as { where?: { id?: string } }).where;
    if (name === "first" && held && model === held.model && operation === held.operation && where?.id === held.id) {
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
const TEMPLATE: PoolTemplate = { version: 1, serviceMonths: 3, visitsPerMonth: 1, tiers: ["standard", "large"], hideProviderNamesUntilAward: true };
const QUOTE: PoolQuote = { monthlyCents: { standard: 10001, large: 20003 }, chemicalsIncluded: true,
  equipmentRepairsExcluded: true, earliestStartDate: "2028-01-31T12:00:00.000Z", routeDay: "flexible", cancellationNoticeDays: 30 };
const input = (changes: Record<string, unknown> = {}) => bidSubmitSchema.parse({ amountCents: 1, pricingBasis: "total", perHomeCents: null,
  scope: "PRIVATE_PROVIDER_NAME complete monthly service", exclusions: "PRIVATE_PROVIDER_CONTACT no equipment repairs",
  cadenceLabel: "PRIVATE_PROVIDER_CADENCE", estimatedDurationLabel: "PRIVATE_PROVIDER_DURATION", poolQuote: QUOTE,
  validUntil: new Date(Date.now() + 86400000).toISOString(), ...changes });

async function provider(tag: string) {
  const user = await first.user.create({ data: { clerkUserId: `${tag}-provider`, email: `${tag}-provider@example.invalid`,
    fullName: "PRIVATE_PROVIDER_NAME", role: "provider", isVerified: true,
    providerProfile: { create: { companyName: "PRIVATE_PROVIDER_COMPANY", trades: ["pool_care"], accountStatus: "active",
      licenseNumber: `${tag}-LICENSE`, licenseState: "TX", insuranceProvider: "Fixture insurer", insurancePolicyNumber: `${tag}-POLICY` } },
    providerServiceAreas: { create: { label: "Owned service area", centerLatitude: 30.4, centerLongitude: -97.7, radiusMiles: 10, postalCodes: [] } },
  } });
  return user;
}
async function seed(options: { template?: PoolTemplate | null } = {}) {
  const tag = `pool52-${randomUUID()}`;
  const admin = await first.user.create({ data: { clerkUserId: `${tag}-admin`, email: `${tag}-admin@example.invalid`, fullName: "Isolated admin", role: "admin", isVerified: true,
    adminAccess: { create: { email: `${tag}-admin@example.invalid`, status: "active", level: "admin" } } } });
  const manager = await first.user.create({ data: { clerkUserId: `${tag}-manager`, email: `${tag}-manager@example.invalid`, fullName: "Isolated manager", role: "hoa_staff" } });
  const community = await first.community.create({ data: { name: tag, type: "hoa", hoaProfile: { create: {
    legalName: tag, addressLine1: "1 Fixture St", locality: "Austin", region: "TX", postalCode: "78758", totalHomes: 3,
    latitude: 30.4, longitude: -97.7, addressVerificationStatus: "verified", minimumInsuranceCoverageCents: 50000000, requiresAdditionalInsured: true,
  } } } });
  await first.communityStaffAssignment.create({ data: { communityId: community.id, userId: manager.id, role: "hoa_manager", status: "active" } });
  const residents = [];
  for (let index = 0; index < 3; index++) {
    const user = await first.user.create({ data: { clerkUserId: `${tag}-resident-${index}`, email: `${tag}-resident-${index}@example.invalid`,
      fullName: `Owned resident ${index}`, role: "homeowner", isVerified: true, homeownerProfile: { create: { notifyEmail: false } } } });
    const unit = await first.communityUnit.create({ data: { communityId: community.id, label: `Fixture unit ${index}` } });
    await first.communityMembership.create({ data: { communityId: community.id, userId: user.id, unitId: unit.id, status: "active" } });
    residents.push({ user, unit });
  }
  const serviceProvider = await provider(tag);
  for (const kind of ["license", "insurance"] as const) {
    await run(first, () => storeProviderCredential(serviceProvider.id, kind, new Blob([`%PDF-1.7\n${kind}\n%%EOF`], { type: "application/pdf" })));
    const profile = await first.providerProfile.findUniqueOrThrow({ where: { userId: serviceProvider.id }, include: { licenseDocument: true, insuranceDocument: true } });
    const document = kind === "license" ? profile.licenseDocument! : profile.insuranceDocument!;
    await run(first, () => updateProviderAdministration(admin, serviceProvider.id, {
      [kind]: "verify", expectedUpdatedAt: profile.updatedAt.toISOString(), [`${kind}DocumentId`]: document.id,
      [`${kind}DocumentChecksum`]: document.checksum, [`${kind}ExpiresOn`]: "2099-12-31",
      ...(kind === "insurance" ? { insuranceCoverageCents: 100000000, insuranceAdditionalInsured: true } : {}),
    }));
  }
  const configured = options.template === undefined ? TEMPLATE : options.template;
  const requestId = await run(first, () => createHoaRequest(manager.id, community.id, hoaRequestCreateSchema.parse({
    title: tag, category: "pool_care", description: "Owned finite monthly pool service", kind: "optional_group", publish: true,
    recurrenceLabel: null, recurrenceIntervalDays: null, totalOccurrences: 1, minHomes: 1, maxHomes: null,
    enrollmentClosesAt: new Date(Date.now() + 3600000).toISOString(), biddingClosesAt: null,
    ...(configured ? { poolTemplate: configured } : {}),
  })));
  return { tag, admin, manager, community, residents, provider: serviceProvider, requestId };
}
type Fixture = Awaited<ReturnType<typeof seed>>;
const saved = (f: Fixture) => first.hoaServiceRequest.findUniqueOrThrow({ where: { id: f.requestId } });
async function join(f: Fixture, index: number, tier?: PoolTier, db = first) {
  return run(db, () => respondToOptionalRequest(f.residents[index].user.id, f.requestId, { response: "joined", ...(tier ? { poolTier: tier } : {}) }));
}
async function open(f: Fixture, tiers: PoolTier[] = ["standard", "large", "standard"]) {
  for (let index = 0; index < tiers.length; index++) await join(f, index, tiers[index]);
  await run(first, () => transitionHoaRequest(f.manager.id, f.requestId, { action: "open_bidding", biddingClosesAt: new Date(Date.now() + 3600000).toISOString() }));
}
const submit = (f: Fixture, changes: Record<string, unknown> = {}) => run(first, () => submitBid(f.provider.id, f.requestId, input(changes)));
const award = (f: Fixture, bid: { id: string; version: number }) => run(first, () => awardBid(f.manager.id, f.requestId, { bidId: bid.id, expectedBidVersion: bid.version }));
async function noAward(f: Fixture) {
  expect(await first.serviceAgreement.count({ where: { requestId: f.requestId } })).toBe(0);
  expect((await saved(f)).status).toBe("open_for_bids");
}
async function lockRow(table: "ProviderProfile" | "MediaAsset" | "AdminAccessGrant", id: string) {
  const lock = new PgClient({ connectionString: process.env.TEST_DATABASE_URL! }); await lock.connect(); await lock.query("BEGIN");
  await lock.query(`SELECT id FROM public."${table}" WHERE id=$1 FOR UPDATE`, [id]); return lock;
}
beforeAll(() => {
  const url = new URL(process.env.TEST_DATABASE_URL!);
  if (url.hostname !== "127.0.0.1" || url.port !== "54371" || !/^\/bundleen_issue52_test_[a-z0-9]+$/.test(url.pathname)) throw new Error("Refusing non-owned issue52 target.");
  first = client("first"); second = client("second"); injection.current = () => context.getStore() ?? first;
});
beforeEach(() => { external.drain.mockClear(); external.after.mockClear(); });
afterEach(async () => { for(const release of releases.splice(0))release.resolve();readPause = null; writeSignal = null; await Promise.allSettled(pending.splice(0)); });
afterAll(async () => { await Promise.all([first?.$disconnect(), second?.$disconnect()]); });

describe("pool tier enrollment and frozen audiences", () => {
  it("uses real independent PostgreSQL sessions and the finalized pool guards", async () => {
    const [a,b] = await Promise.all([first.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`, second.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`]);
    expect(a[0].pid).not.toBe(b[0].pid);
    const guards = await first.$queryRaw<Array<{ tgname: string }>>`SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgname IN ('HoaServiceRequest_pool_template','zz_HoaRequestParticipation_pool_guard','HoaRequestParticipation_stamp_pool','z_ServiceBid_pool_guard','ServiceBid_record_pool_revision','ServiceBidRevision_append_only','ServiceBidRevision_no_truncate','z_ServiceAgreement_pool_snapshot','ProviderBidInvitation_validate','zzz_ServiceBid_pool_validity')`;
    expect(guards).toHaveLength(10);
  });

  it("requires a configured tier and current household membership before joining", async () => {
    const f = await seed();
    await expect(join(f,0)).rejects.toMatchObject({ status:400 });
    await expect(join(f,0,"pool_spa")).rejects.toMatchObject({ status:400 });
    await expect(run(first, () => respondToOptionalRequest(f.provider.id,f.requestId,{response:"joined",poolTier:"standard"}))).rejects.toThrow();
    expect(await first.hoaRequestParticipation.count({where:{requestId:f.requestId}})).toBe(0);
    await join(f,0,"standard");
    expect(await first.hoaRequestParticipation.findFirst({where:{requestId:f.requestId,userId:f.residents[0].user.id}})).toMatchObject({poolTier:"standard",unitId:f.residents[0].unit.id});
  });

  it("advances the parent stamp on a tier-only edit and freezes update/delete after bidding locks", async () => {
    const f=await seed();await join(f,0,"standard");const before=await saved(f);await join(f,0,"large");
    expect(+(await saved(f)).updatedAt).toBeGreaterThan(+before.updatedAt);
    await run(first,()=>transitionHoaRequest(f.manager.id,f.requestId,{action:"open_bidding",biddingClosesAt:new Date(Date.now()+3600000).toISOString()}));
    const participation=await first.hoaRequestParticipation.findFirstOrThrow({where:{requestId:f.requestId}});
    await expect(first.$executeRaw`UPDATE "HoaRequestParticipation" SET "poolTier"='standard' WHERE id=${participation.id}`).rejects.toThrow(/locked|frozen/i);
    await expect(first.$executeRaw`DELETE FROM "HoaRequestParticipation" WHERE id=${participation.id}`).rejects.toThrow(/locked|frozen/i);
    expect(await first.hoaRequestParticipation.findUnique({where:{id:participation.id}})).toMatchObject({poolTier:"large"});
  });

  it("serializes a real concurrent enrollment lock and join without a partial frozen audience", async () => {
    const f=await seed();await join(f,0,"standard");
    const results=await Promise.allSettled([
      run(first,()=>transitionHoaRequest(f.manager.id,f.requestId,{action:"open_bidding",biddingClosesAt:new Date(Date.now()+3600000).toISOString()})),
      join(f,1,"large",second),
    ]);
    if(results[0].status==="rejected"){
      expect(results[1].status).toBe("fulfilled");
      await run(first,()=>transitionHoaRequest(f.manager.id,f.requestId,{action:"open_bidding",biddingClosesAt:new Date(Date.now()+3600000).toISOString()}));
    }
    const homes=await first.hoaRequestParticipation.findMany({where:{requestId:f.requestId,response:"joined"}});
    expect(homes).toHaveLength(results[1].status==="fulfilled"?2:1);
    expect((await saved(f)).participantsLockedAt).toBeInstanceOf(Date);
    expect(homes.map(home=>home.poolTier).sort()).toEqual(results[1].status==="fulfilled"?["large","standard"]:["standard"]);
  });

  it("rejects a stale enrollment lock after another session changes a selected tier", async () => {
    const f=await seed();await join(f,0,"standard");const held=holdRead("HoaServiceRequest",f.requestId);
    const opening=run(first,()=>transitionHoaRequest(f.manager.id,f.requestId,{action:"open_bidding",biddingClosesAt:new Date(Date.now()+3600000).toISOString()}));
    await reached(held.hit);await join(f,0,"large",second);held.release.resolve();
    await expect(opening).rejects.toMatchObject({status:409});
    expect((await saved(f)).participantsLockedAt).toBeNull();
  });

  it("serializes two first joins at capacity without overfilling or duplicate household rows",async()=>{
    const f=await seed();await first.hoaServiceRequest.update({where:{id:f.requestId},data:{maxHomes:1}});
    const outcomes=await Promise.allSettled([join(f,0,"standard"),join(f,1,"large",second)]);
    expect(outcomes.filter(result=>result.status==="fulfilled")).toHaveLength(1);
    expect(outcomes.filter(result=>result.status==="rejected")).toHaveLength(1);
    expect(await first.hoaRequestParticipation.count({where:{requestId:f.requestId,response:"joined"}})).toBe(1);
  });
});

describe("named provider invitations", () => {
  it("requires exact active administrator identity and community-scoped pool request access", async () => {
    const f=await seed();await open(f);
    await expect(run(first,()=>inviteProviderToBid(f.manager.id,f.community.id,f.requestId,f.provider.id))).rejects.toMatchObject({status:403});
    await expect(run(first,()=>inviteProviderToBid(f.admin.id,"another-community",f.requestId,f.provider.id))).rejects.toMatchObject({status:404});
    await first.user.update({where:{id:f.admin.id},data:{email:`changed-${randomUUID()}@example.invalid`}});
    await expect(run(first,()=>inviteProviderToBid(f.admin.id,f.community.id,f.requestId,f.provider.id))).rejects.toMatchObject({status:403});
    expect(await first.providerBidInvitation.count({where:{requestId:f.requestId}})).toBe(0);
  });

  it("denies an operations staff identity even when its admin grant is otherwise active", async () => {
    const f=await seed();await open(f);
    await first.adminAccessGrant.update({where:{userId:f.admin.id},data:{isStaffAccount:true}});
    await expect(run(first,()=>inviteProviderToBid(f.admin.id,f.community.id,f.requestId,f.provider.id))).rejects.toMatchObject({status:403});
    expect(await first.providerBidInvitation.count({where:{requestId:f.requestId}})).toBe(0);
  });

  it.each(["closed","expired"])("does not invite against a %s bidding window", async reason=>{
    const f=await seed();await open(f);
    if(reason==="closed")await run(first,()=>transitionHoaRequest(f.manager.id,f.requestId,{action:"close_bidding"}));
    else await first.hoaServiceRequest.update({where:{id:f.requestId},data:{biddingClosesAt:new Date(Date.now()-1000)}});
    await expect(run(first,()=>inviteProviderToBid(f.admin.id,f.community.id,f.requestId,f.provider.id))).rejects.toMatchObject({status:409});
    expect(await first.providerBidInvitation.count({where:{requestId:f.requestId}})).toBe(0);
  });

  it.each(["inactive","unverified","wrong-category","out-of-area"])("excludes a provider that is %s from discovery and invitation",async reason=>{
    const f=await seed();await open(f);
    if(reason==="inactive")await first.providerProfile.update({where:{userId:f.provider.id},data:{accountStatus:"suspended"}});
    else if(reason==="unverified")await first.providerProfile.update({where:{userId:f.provider.id},data:{licenseVerifiedAt:null}});
    else if(reason==="wrong-category")await first.providerProfile.update({where:{userId:f.provider.id},data:{trades:["cleaning"]}});
    else await first.providerServiceArea.updateMany({where:{providerUserId:f.provider.id},data:{centerLatitude:40,centerLongitude:-100}});
    const listed=await run(first,()=>listProviderBidInvitations(f.admin.id,f.community.id,f.requestId));
    expect(listed.providers.map(row=>row.id)).not.toContain(f.provider.id);
    await expect(run(first,()=>inviteProviderToBid(f.admin.id,f.community.id,f.requestId,f.provider.id))).rejects.toMatchObject({status:400});
    expect(await first.providerBidInvitation.count({where:{requestId:f.requestId}})).toBe(0);
  });

  it("honors inbox-only job preferences and dedupes repeated invitations and audit rows",async()=>{
    const f=await seed();await open(f);await first.providerProfile.update({where:{userId:f.provider.id},data:{notifyNewJobs:false}});
    const key=`provider-bid-invite:${f.requestId}:${f.provider.id}`;
    expect(await run(first,()=>inviteProviderToBid(f.admin.id,f.community.id,f.requestId,f.provider.id))).toEqual({invited:true,alreadyInvited:false});
    expect(await run(first,()=>inviteProviderToBid(f.admin.id,f.community.id,f.requestId,f.provider.id))).toEqual({invited:true,alreadyInvited:true});
    expect(await first.providerBidInvitation.count({where:{requestId:f.requestId}})).toBe(1);
    expect(await first.notification.count({where:{dedupeKey:key}})).toBe(1);
    expect(await first.outboxEvent.count({where:{dedupeKey:{contains:key}}})).toBe(0);
    expect(await first.adminAuditLog.count({where:{communityId:f.community.id,action:"provider_bid_invited"}})).toBe(1);
    expect(external.drain).not.toHaveBeenCalled();
  });
});

describe("expiry and authority are rechecked after real row locks",()=>{
  it("rolls back a prepared pool submission that expires while waiting for its provider lock",async()=>{
    const f=await seed();await open(f);
    const profile=await first.providerProfile.findUniqueOrThrow({where:{userId:f.provider.id}}),lock=await lockRow("ProviderProfile",profile.id);
    const validUntil=new Date(Date.now()+2500);writeSignal={table:"ServiceBid",id:f.requestId,hit:deferred()};
    const signal=writeSignal.hit;const sending=submit(f,{validUntil:validUntil.toISOString()});
    try{await reached(signal);await past(validUntil);await lock.query("COMMIT");await expect(sending).rejects.toMatchObject({status:409});}
    finally{await lock.query("ROLLBACK");await lock.end();}
    expect(await first.serviceBid.count({where:{requestId:f.requestId}})).toBe(0);
    expect(await first.serviceBidRevision.count({where:{bid:{requestId:f.requestId}}})).toBe(0);
  });

  it("rolls back parent award, bid, agreement and notices when quote expiry passes a document lock",async()=>{
    const f=await seed();await open(f);const deadline=new Date(Date.now()+2500),bid=await submit(f,{validUntil:deadline.toISOString()});
    const profile=await first.providerProfile.findUniqueOrThrow({where:{userId:f.provider.id}}),lock=await lockRow("MediaAsset",profile.licenseDocumentId!);
    const before=await saved(f);const notices=await first.notification.count({where:{dedupeKey:{startsWith:`award:${f.requestId}:`}}});
    writeSignal={table:"ServiceBid",id:bid.id,hit:deferred()};const signal=writeSignal.hit;const awarding=award(f,bid);
    try{await reached(signal);await past(deadline);await lock.query("COMMIT");await expect(awarding).rejects.toMatchObject({status:409});}
    finally{await lock.query("ROLLBACK");await lock.end();}
    await noAward(f);expect((await saved(f)).updatedAt).toEqual(before.updatedAt);
    expect((await first.serviceBid.findUniqueOrThrow({where:{id:bid.id}})).status).toBe("submitted");
    expect(await first.notification.count({where:{dedupeKey:{startsWith:`award:${f.requestId}:`}}})).toBe(notices);
  });

  it("does not create an invitation when its request deadline passes behind the parent lock",async()=>{
    const f=await seed();await open(f);const deadline=new Date(Date.now()+2500);
    await first.hoaServiceRequest.update({where:{id:f.requestId},data:{biddingClosesAt:deadline}});
    const lock=new PgClient({connectionString:process.env.TEST_DATABASE_URL!});await lock.connect();await lock.query("BEGIN");await lock.query('SELECT id FROM "HoaServiceRequest" WHERE id=$1 FOR UPDATE',[f.requestId]);
    writeSignal={table:"HoaServiceRequest",id:f.requestId,hit:deferred()};const signal=writeSignal.hit;
    const inviting=run(first,()=>inviteProviderToBid(f.admin.id,f.community.id,f.requestId,f.provider.id));
    try{await reached(signal);await past(deadline);await lock.query("COMMIT");await expect(inviting).rejects.toMatchObject({status:409});}
    finally{await lock.query("ROLLBACK");await lock.end();}
    expect(await first.providerBidInvitation.count({where:{requestId:f.requestId}})).toBe(0);
    expect(await first.notification.count({where:{dedupeKey:`provider-bid-invite:${f.requestId}:${f.provider.id}`}})).toBe(0);
  });

  it("rechecks a revoked administrator grant after waiting and rolls back the invitation batch",async()=>{
    const f=await seed();await open(f);const grant=await first.adminAccessGrant.findUniqueOrThrow({where:{userId:f.admin.id}}),lock=await lockRow("AdminAccessGrant",grant.id);
    writeSignal={table:"ProviderBidInvitation",id:f.requestId,hit:deferred()};const signal=writeSignal.hit;
    const inviting=run(first,()=>inviteProviderToBid(f.admin.id,f.community.id,f.requestId,f.provider.id));
    try{
      await reached(signal);await lock.query('UPDATE "AdminAccessGrant" SET status=\'revoked\',"revokedAt"=NOW() WHERE id=$1',[grant.id]);await lock.query("COMMIT");
      await expect(inviting).rejects.toMatchObject({status:409});
    }finally{await lock.query("ROLLBACK");await lock.end();}
    expect(await first.providerBidInvitation.count({where:{requestId:f.requestId}})).toBe(0);
    expect(await first.adminAuditLog.count({where:{communityId:f.community.id,action:"provider_bid_invited"}})).toBe(0);
    expect(await first.notification.count({where:{dedupeKey:`provider-bid-invite:${f.requestId}:${f.provider.id}`}})).toBe(0);
  });
});

describe("actual pool bids, history, snapshots and calendar terms", () => {
  it("derives the exact integer whole-term price from locked tiers instead of trusting the supplied total", async () => {
    const f=await seed();await open(f);const bid=await submit(f,{amountCents:1});
    expect(bid).toMatchObject({amountCents:120015,pricingBasis:"total",perHomeCents:null,version:1});
    const row=await first.serviceBid.findUniqueOrThrow({where:{id:bid.id}});
    expect(row.amountCents).toBe((2*10001+20003)*3);
    expect(row.poolQuote).toEqual(QUOTE);
    await expect(run(first,()=>awardBid(f.manager.id,f.requestId,{bidId:bid.id}))).rejects.toMatchObject({status:409});
    await noAward(f);
    expect(await first.serviceBidRevision.findMany({where:{bidId:bid.id}})).toMatchObject([{version:1,amountCents:120015}]);
  });

  it("requires every configured rate, rejects an unconfigured rate and rejects raw fractional rates", async () => {
    const f=await seed();await open(f);
    await expect(submit(f,{poolQuote:{...QUOTE,monthlyCents:{standard:10001}}})).rejects.toMatchObject({status:400});
    await expect(submit(f,{poolQuote:{...QUOTE,monthlyCents:{...QUOTE.monthlyCents,pool_spa:30000}}})).rejects.toMatchObject({status:400});
    await expect(first.serviceBid.create({data:{requestId:f.requestId,providerUserId:f.provider.id,amountCents:120015,currency:"usd",pricingBasis:"total",scope:"Attempted fractional bypass",
      validUntil:new Date(Date.now()+86400000),poolQuote:{...QUOTE,monthlyCents:{standard:10001.5,large:20003}}}})).rejects.toThrow();
    expect(await first.serviceBid.count({where:{requestId:f.requestId}})).toBe(0);
  });

  it("requires the reviewed revision and preserves both historical prices when the quote changes", async () => {
    const f=await seed();await open(f);const bid=await submit(f);
    await expect(submit(f,{poolQuote:{...QUOTE,monthlyCents:{standard:12001,large:20003}}})).rejects.toMatchObject({status:409});
    const revised=await submit(f,{expectedBidVersion:bid.version,poolQuote:{...QUOTE,monthlyCents:{standard:12001,large:20003}}});
    expect(revised).toMatchObject({version:2,amountCents:132015});
    await expect(submit(f,{expectedBidVersion:1})).rejects.toMatchObject({status:409});
    await expect(award(f,bid)).rejects.toMatchObject({status:409});await noAward(f);
    expect((await first.serviceBidRevision.findMany({where:{bidId:bid.id},orderBy:{version:"asc"}})).map(row=>[row.version,row.amountCents])).toEqual([[1,120015],[2,132015]]);
    const agreementId=await award(f,revised);
    expect(await first.serviceAgreement.findUniqueOrThrow({where:{id:agreementId}})).toMatchObject({amountCents:132015});
  });

  it("keeps revision history and all awarded commercial fields immutable against direct writes", async () => {
    const f=await seed();await open(f);const bid=await submit(f);
    const revision=await first.serviceBidRevision.findFirstOrThrow({where:{bidId:bid.id}});
    await expect(first.$executeRaw`UPDATE "ServiceBidRevision" SET "amountCents"=1 WHERE id=${revision.id}`).rejects.toThrow(/immutable|append/i);
    await expect(first.$executeRaw`DELETE FROM "ServiceBidRevision" WHERE id=${revision.id}`).rejects.toThrow(/immutable|append/i);
    await expect(first.$executeRaw`TRUNCATE "ServiceBidRevision"`).rejects.toThrow(/immutable|append/i);
    const agreementId=await award(f,bid),before=await first.serviceAgreement.findUniqueOrThrow({where:{id:agreementId}});
    await expect(first.$executeRaw`UPDATE "ServiceAgreement" SET "poolSnapshot"='{}'::jsonb WHERE id=${agreementId}`).rejects.toThrow(/immutable/i);
    await expect(first.$executeRaw`UPDATE "ServiceAgreement" SET "amountCents"="amountCents"+1 WHERE id=${agreementId}`).rejects.toThrow(/immutable/i);
    expect(await first.serviceAgreement.findUniqueOrThrow({where:{id:agreementId}})).toEqual(before);
    expect(await first.serviceBidRevision.count({where:{bidId:bid.id}})).toBe(1);
  });

  it("masks resident bid identity before award and never serializes another household's snapshot IDs", async () => {
    const f=await seed();await open(f);const bid=await submit(f);
    const resident=await run(first,()=>listRequestBids(f.residents[0].user.id,f.requestId));
    expect(resident[0]).toMatchObject({providerUserId:"",providerCompany:null,identityHidden:true,amountCents:120015});
    expect(JSON.stringify(resident)).not.toContain("PRIVATE_PROVIDER_");
    expect((await run(first,()=>listRequestBids(f.manager.id,f.requestId)))[0].providerName).toBe("PRIVATE_PROVIDER_NAME");
    const agreementId=await award(f,bid);
    const stored=await first.serviceAgreement.findUniqueOrThrow({where:{id:agreementId}});
    const snapshot=stored.poolSnapshot as unknown as PoolAgreementSnapshot;
    expect(snapshot).toMatchObject({amountCents:120015,tierCounts:{standard:2,large:1},quote:QUOTE,template:TEMPLATE});
    expect(snapshot.homes).toHaveLength(3);
    expect(snapshot.homes.reduce((total,home)=>total+home.termCents,0)).toBe(120015);
    expect(snapshot.homes.find(home=>home.unitId===f.residents[0].unit.id)).toMatchObject({tier:"standard",monthlyCents:10001,termCents:30003});
    const hub=await run(first,()=>getResidentHoaHub(f.residents[0].user.id));
    const community=hub.communities.find(row=>row.id===f.community.id)!;
    expect(community.requests.find(row=>row.id===f.requestId)?.viewerPoolTier).toBe("standard");
    expect(community.bidsByRequest[f.requestId][0].providerName).toBe("PRIVATE_PROVIDER_NAME");
    for(const other of f.residents.slice(1)){
      expect(JSON.stringify(hub)).not.toContain(other.user.id);expect(JSON.stringify(hub)).not.toContain(other.unit.id);
    }
    expect(community.agreements[0].poolSnapshot?.homes.every(home=>home.unitId===f.residents[0].unit.id)).toBe(true);
  });

  it.each([[2027,"2027-02-28"],[2028,"2028-02-29"]])("anchors Jan31 in %i through February and back to March31", async (year,february) => {
    const f=await seed();await open(f);const bid=await submit(f,{poolQuote:{...QUOTE,earliestStartDate:`${year}-01-31T12:00:00.000Z`}});
    const id=await award(f,bid);
    const occurrences=await first.serviceOccurrence.findMany({where:{agreementId:id},orderBy:{sequence:"asc"}});
    expect(occurrences.map(row=>row.serviceDate.toISOString())).toEqual([`${year}-01-31T12:00:00.000Z`,`${february}T12:00:00.000Z`,`${year}-03-31T12:00:00.000Z`]);
    expect((await first.serviceAgreement.findUniqueOrThrow({where:{id}})).endDate?.toISOString()).toBe(`${year}-04-30T12:00:00.000Z`);
  });

  it("materializes the configured visits inside actual calendar months without weekly pricing", async () => {
    const f=await seed({template:{...TEMPLATE,visitsPerMonth:4}});await open(f);const bid=await submit(f);const id=await award(f,bid);
    const dates=await first.serviceOccurrence.findMany({where:{agreementId:id},orderBy:{sequence:"asc"}});
    expect(dates.map(row=>row.serviceDate.toISOString().slice(0,10))).toEqual(["2028-01-31","2028-02-07","2028-02-14","2028-02-21","2028-02-29","2028-03-07","2028-03-15","2028-03-23","2028-03-31","2028-04-07","2028-04-15","2028-04-22"]);
    expect((await first.serviceAgreement.findUniqueOrThrow({where:{id}})).amountCents).toBe(120015);
    expect(await first.serviceVisit.count({where:{occurrence:{agreementId:id}}})).toBe(36);
  });

  it.each(["expired-proof","higher-policy"])("fails a new pool award closed for %s without partial award rows", async (reason) => {
    const f=await seed();await open(f);const bid=await submit(f);
    if(reason==="expired-proof")await first.providerProfile.update({where:{userId:f.provider.id},data:{licenseExpiresAt:new Date("2000-01-01")}});
    else await first.hoaProfile.update({where:{communityId:f.community.id},data:{minimumInsuranceCoverageCents:200000000}});
    await expect(award(f,bid)).rejects.toMatchObject({status:409});await noAward(f);
    expect((await first.serviceBid.findUniqueOrThrow({where:{id:bid.id}})).status).toBe("submitted");
  });

  it("preserves legacy optional requests, whole-job prices and null snapshots", async () => {
    const f=await seed({template:null});await join(f,0);
    await run(first,()=>transitionHoaRequest(f.manager.id,f.requestId,{action:"open_bidding",biddingClosesAt:new Date(Date.now()+3600000).toISOString()}));
    const bid=await submit(f,{poolQuote:null,amountCents:12345,validUntil:null});
    const id=await award(f,bid);
    expect(await first.serviceAgreement.findUniqueOrThrow({where:{id}})).toMatchObject({amountCents:12345,poolSnapshot:null,pricingBasis:"total"});
    expect(await first.serviceBidRevision.count({where:{bidId:bid.id}})).toBe(0);
  });
});
