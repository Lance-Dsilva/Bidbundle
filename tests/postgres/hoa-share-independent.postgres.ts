import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { beforeAll, afterAll, it, expect, vi } from "vitest";
const injection = vi.hoisted(() => ({ db: null as PrismaClient | null }));
vi.mock("@/lib/server/db", () => ({ db: new Proxy({}, { get(_target, key) { const db = injection.db!; const v = Reflect.get(db, key); return typeof v === "function" ? v.bind(db) : v; } }) }));
vi.mock("stripe", () => ({ default: class {} })); // No remote processor methods exist in this suite.
vi.mock("@vercel/blob", () => ({ put: vi.fn(async () => ({})), del: vi.fn(), get: vi.fn() }));
vi.mock("@/lib/server/notifications", async original => ({ ...await original<object>(), scheduleOutboxDrain: vi.fn() }));
import { createHoaRequest, respondToOptionalRequest, transitionHoaRequest, submitBid, awardBid, saveDayPlan, updateVisitStatus } from "@/lib/server/hoa-market";
import { hoaRequestCreateSchema, bidSubmitSchema } from "@/lib/validation/hoa";
import { storeProviderCredential } from "@/lib/server/provider-credentials";
import { updateProviderAdministration } from "@/lib/server/providers-admin";
import { reportServiceQuality } from "@/lib/server/service-quality";
import { getHoaShareDashboard, setHoaShareRate, createHoaShareStatement, getHoaShareStatement, markHoaShareStatementPaid } from "@/lib/server/hoa-revenue-share";
let first: PrismaClient;
async function run<T>(_db: PrismaClient, work: () => Promise<T>) { return work(); }
beforeAll(() => { first = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.TEST_DATABASE_URL! }) }); injection.db = first; });
afterAll(async () => { await first?.$disconnect(); vi.unstubAllEnvs(); });
async function seed(category = "pool_care", options: { notifyEmail?: boolean; totalOccurrences?: number; paid?: boolean } = {}) {
  const tag = `share44-${randomUUID()}`;
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
    title: tag, category, description: "Owned service quality test", kind: options.paid ? "optional_group" : "compulsory_recurring", publish: true,
    ...(options.paid ? { minHomes: 2, enrollmentClosesAt: new Date(Date.now()+3600000).toISOString() } : {}),
    recurrenceLabel: "Daily", recurrenceIntervalDays: 1, totalOccurrences: options.totalOccurrences ?? 1,
    biddingClosesAt: new Date(Date.now() + 3600000).toISOString(),
  })));
  if (options.paid) {
    for (const resident of residents) await respondToOptionalRequest(resident.user.id, requestId, { response: "joined" });
    await transitionHoaRequest(manager.id, requestId, { action: "open_bidding", biddingClosesAt: new Date(Date.now()+3600000).toISOString() });
  }
  const bid = await run(first, () => submitBid(provider.id, requestId, bidSubmitSchema.parse({
    amountCents: options.paid ? 2002 : 10000, pricingBasis: "total", scope: "Fixture whole-job service",
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

async function fixture(complete = true) {
 const f = await seed("landscaping", { paid: true });
 await first.adminAccessGrant.update({ where: { userId: f.admin.id }, data: { level: "owner" } });
 await first.user.update({ where: { id: f.manager.id }, data: { isVerified: true } });
 await setHoaShareRate(f.admin.id, f.community.id, 500);
 if (complete) await updateVisitStatus(f.provider.id, f.ownVisit.id, { status: "completed", completionNote: null });
 const payment = await first.stripeTestPayment.create({ data: {
  visitId: f.ownVisit.id, requestId: f.requestId, agreementId: f.agreementId, communityId: f.community.id,
  residentUserId: f.residents[0].user.id, providerUserId: f.provider.id, unitId: f.residents[0].unit.id,
  customerId: `cus_${f.tag}`, paymentMethodId: `pm_${f.tag}`, providerAccountId: `acct_${f.tag}`, termsToken: "owned-fixture",
  amountCents: 1001, platformFeeCents: 100, providerAmountCents: 901, hoaShareCents: 50, hoaRevenueShareBps: 500,
  currency: "usd", status: "pending",
 }});
 return { ...f, payment };
}
async function paid(f: Awaited<ReturnType<typeof fixture>>) { return first.stripeTestPayment.update({ where: { visitId: f.ownVisit.id }, data: { status: "succeeded", stripePaymentIntentId: `pi_${f.tag}`, stripeChargeId: `ch_${f.tag}` } }); }
async function balance(f: Awaited<ReturnType<typeof fixture>>) { return (await first.hoaShareEntry.aggregate({ where: { communityId: f.community.id }, _sum: { amountCents: true } }))._sum.amountCents ?? 0; }
it("audits owner rate changes, denies manager changes, and freezes existing payment allocations", async () => {
 const f = await fixture();
 await expect(setHoaShareRate(f.manager.id, f.community.id, 300)).rejects.toMatchObject({ status: 403 });
 await expect(setHoaShareRate(f.admin.id, f.community.id, 1001)).rejects.toMatchObject({ status: 400 });
 await setHoaShareRate(f.admin.id, f.community.id, 300);
 expect(await first.adminAuditLog.count({ where: { communityId: f.community.id, metadata: { path: ["operation"], equals: "hoa_share_rate" } } })).toBe(2);
 expect(await first.stripeTestPayment.findUniqueOrThrow({ where: { visitId: f.ownVisit.id } })).toMatchObject({ hoaRevenueShareBps: 500, hoaShareCents: 50, providerAmountCents: 901 });
 await expect(first.stripeTestPayment.update({ where: { visitId: f.ownVisit.id }, data: { hoaRevenueShareBps: 300, hoaShareCents: 30 } })).rejects.toThrow();
});
it("accrues only completed paid work and rejects direct fabricated ledger rows", async () => {
 await expect(fixture(false)).rejects.toThrow();
 const f = await fixture(); expect(await balance(f)).toBe(0);
 await paid(f); expect(await balance(f)).toBe(50);
 await first.stripeTestPayment.update({ where: { visitId: f.ownVisit.id }, data: { status: "succeeded" } });
 expect(await first.hoaShareEntry.count({ where: { paymentVisitId: f.ownVisit.id } })).toBe(1);
 await expect(first.hoaShareEntry.create({ data: { id: randomUUID(), communityId: f.community.id, paymentVisitId: f.ownVisit.id, sequence: 2, kind: "earned", amountCents: 50, savingsCents: 0, refundedCents: 0 } })).rejects.toThrow();
});
it("reverses cumulative partial refunds without reducing provider allocation or losing rounding cents", async () => {
 const f = await fixture(); await paid(f);
 const expected = [34, 17, 0];
 for (const [i, refunded] of [333,666,1001].entries()) {
  await first.stripeTestPayment.update({ where: { visitId: f.ownVisit.id }, data: { amountRefundedCents: refunded, status: refunded === 1001 ? "refunded" : "partially_refunded" } });
  expect(await balance(f)).toBe(expected[i]);
 }
 expect((await first.stripeTestPayment.findUniqueOrThrow({ where: { visitId: f.ownVisit.id } })).providerAmountCents).toBe(901);
 const rows = await first.hoaShareEntry.findMany({ where: { paymentVisitId: f.ownVisit.id }, orderBy: { sequence: "asc" } });
 expect(rows.map(row=>row.amountCents)).toEqual([50,-16,-17,-17]);
 await expect(first.hoaShareEntry.update({ where: { id: rows[0].id }, data: { amountCents: 1 } })).rejects.toThrow();
 await expect(first.hoaShareEntry.delete({ where: { id: rows[0].id } })).rejects.toThrow();
});
it("scopes manager dashboard and statement reads to assigned community", async () => {
 const f = await fixture(); await paid(f); const other = await fixture();
 expect((await getHoaShareDashboard(f.manager.id, f.community.id)).earnedCents).toBe(50);
 await expect(getHoaShareDashboard(other.manager.id, f.community.id)).rejects.toMatchObject({ status: 403 });
 const month = "2020-01";
 const [one,two] = await Promise.all([createHoaShareStatement(f.admin.id,f.community.id,month), createHoaShareStatement(f.admin.id,f.community.id,month)]);
 expect(one.id).toBe(two.id); expect(one.totalCents).toBe(0);
 await expect(getHoaShareStatement(other.admin.id,other.community.id,one.id)).rejects.toMatchObject({ status: 404 });
 await expect(markHoaShareStatementPaid(f.admin.id,f.community.id,one.id,"check-zero")).rejects.toMatchObject({ status: 409 });
});
// Test-only historical clock: exact fixture IDs, all production guards remain enabled.
// This proves historical accounting, not the production wall-clock stamping behavior.
async function historicalFixture(f: Awaited<ReturnType<typeof fixture>>, work: (dates: { earnedMonth:string; nextMonth:string; setRefundMonth:()=>Promise<void>; bindPayout:(statementId:string)=>Promise<void> })=>Promise<void>) {
 const [{name}] = await first.$queryRaw<Array<{name:string}>>`SELECT current_database() AS name`;
 expect(name).toBe("bundleen_issue44_test_share");
 const tag=randomUUID().replaceAll("-", ""); const table=`test_share_clock_${tag}`, fn=`test_share_clock_fn_${tag}`, entryTrigger=`zz_test_share_entry_${tag}`, payoutTrigger=`zz_test_share_payout_${tag}`;
 const now=new Date(); const earned=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()-2,15)); const next=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()-1,15));
 try {
  await first.$executeRawUnsafe(`CREATE TABLE "${table}" (visit_id TEXT PRIMARY KEY, statement_id TEXT, stamp TIMESTAMP(3) NOT NULL, paid_stamp TIMESTAMP(3) NOT NULL)`);
  await first.$executeRawUnsafe(`INSERT INTO "${table}" VALUES ($1,NULL,$2,$3)`,f.ownVisit.id,earned,next);
  await first.$executeRawUnsafe(`CREATE FUNCTION "${fn}"() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE chosen TIMESTAMP(3); BEGIN IF current_database()<>'bundleen_issue44_test_share' THEN RAISE EXCEPTION 'Wrong fixture database'; END IF; IF TG_TABLE_NAME='HoaShareEntry' THEN SELECT stamp INTO chosen FROM "${table}" WHERE visit_id=NEW."paymentVisitId"; IF chosen IS NOT NULL THEN NEW."createdAt":=chosen; END IF; ELSE SELECT paid_stamp INTO chosen FROM "${table}" WHERE statement_id=NEW."statementId"; IF chosen IS NOT NULL AND NEW."status"='paid' THEN NEW."paidAt":=chosen; END IF; END IF; RETURN NEW; END $$`);
  await first.$executeRawUnsafe(`CREATE TRIGGER "${entryTrigger}" BEFORE INSERT ON "HoaShareEntry" FOR EACH ROW EXECUTE FUNCTION "${fn}"()`);
  await first.$executeRawUnsafe(`CREATE TRIGGER "${payoutTrigger}" BEFORE UPDATE ON "HoaSharePayout" FOR EACH ROW EXECUTE FUNCTION "${fn}"()`);
  await work({ earnedMonth:earned.toISOString().slice(0,7),nextMonth:next.toISOString().slice(0,7),setRefundMonth:async()=>{await first.$executeRawUnsafe(`UPDATE "${table}" SET stamp=$1 WHERE visit_id=$2`,next,f.ownVisit.id);},bindPayout:async(id)=>{await first.$executeRawUnsafe(`UPDATE "${table}" SET statement_id=$1 WHERE visit_id=$2`,id,f.ownVisit.id);} });
 } finally {
  await first.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${entryTrigger}" ON "HoaShareEntry"`);
  await first.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${payoutTrigger}" ON "HoaSharePayout"`);
  await first.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${fn}"()`);
  await first.$executeRawUnsafe(`DROP TABLE IF EXISTS "${table}"`);
 }
}
it("pays one audited monthly statement once, then carries later refund liability without rewriting paid history", async()=>{
 const f=await fixture();
 await historicalFixture(f,async clock=>{
  await paid(f);
  const [s,same]=await Promise.all([createHoaShareStatement(f.admin.id,f.community.id,clock.earnedMonth),createHoaShareStatement(f.admin.id,f.community.id,clock.earnedMonth)]);
  expect(s.id).toBe(same.id);expect(s.totalCents).toBe(50); await clock.bindPayout(s.id);
  await Promise.all([markHoaShareStatementPaid(f.admin.id,f.community.id,s.id,"CHECK-44"),markHoaShareStatementPaid(f.admin.id,f.community.id,s.id,"CHECK-44")]);
  expect(await first.hoaSharePayout.count({where:{statementId:s.id}})).toBe(1);
  const payout=await first.hoaSharePayout.findUniqueOrThrow({where:{statementId:s.id}});expect(payout).toMatchObject({amountCents:50,status:"paid",reference:"CHECK-44"});
  await expect(markHoaShareStatementPaid(f.admin.id,f.community.id,s.id,"CHANGED")).rejects.toMatchObject({status:409});
  await expect(first.hoaSharePayout.update({where:{id:payout.id},data:{reference:"tampered"}})).rejects.toThrow();
  const original=await first.hoaShareStatement.findUniqueOrThrow({where:{id:s.id}});
  await clock.setRefundMonth();await first.stripeTestPayment.update({where:{visitId:f.ownVisit.id},data:{amountRefundedCents:1001,status:"refunded"}});
  expect((await getHoaShareDashboard(f.manager.id,f.community.id)).availableCents).toBe(-50);
  const next=await createHoaShareStatement(f.admin.id,f.community.id,clock.nextMonth);expect(next).toMatchObject({totalCents:-50,closingBalanceCents:-50,status:"carried"});
  expect(await first.hoaShareStatement.findUniqueOrThrow({where:{id:s.id}})).toEqual(original);
  const exportRows=await getHoaShareStatement(f.manager.id,f.community.id,next.id);expect(exportRows.lines.reduce((sum,row)=>sum+row.amountCents,0)).toBe(next.totalCents);
 });
});
async function waitBlocked(blocker:number) {
 const until=Date.now()+5000;
 while(Date.now()<until){const [row]=await first.$queryRaw<Array<{blocked:boolean}>>`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE ${blocker}=ANY(pg_blocking_pids(pid))) AS blocked`;if(row.blocked)return;await new Promise(resolve=>setTimeout(resolve,20));}
 throw new Error("Expected actual Community lock wait");
}
it("claim committed while holding Community authority blocks a waiting manual payout",async()=>{
 const f=await fixture(); await historicalFixture(f,async clock=>{
  await paid(f);const s=await createHoaShareStatement(f.admin.id,f.community.id,clock.earnedMonth);
  let release!:()=>void,ready!:(pid:number)=>void;const gate=new Promise<void>(resolve=>{release=resolve});const acquired=new Promise<number>(resolve=>{ready=resolve});
  const claim=first.$transaction(async tx=>{
   await tx.$queryRaw`SELECT "id" FROM "ServiceVisit" WHERE "id"=${f.ownVisit.id} FOR UPDATE`;
   await tx.$queryRaw`SELECT "visitId" FROM "StripeTestPayment" WHERE "visitId"=${f.ownVisit.id} FOR UPDATE`;
   const ticket=await tx.supportTicket.create({data:{ticketNumber:randomUUID(),requesterUserId:f.residents[0].user.id,requesterRole:"homeowner",category:"service_quality",subject:"Owned race",communityId:f.community.id}});
   await tx.serviceQualityClaim.create({data:{visitId:f.ownVisit.id,ticketId:ticket.id,requesterUserId:f.residents[0].user.id,providerUserId:f.provider.id,reason:"incomplete"}});
   const [{pid}]=await tx.$queryRaw<Array<{pid:number}>>`SELECT pg_backend_pid() AS pid`;ready(pid);await gate;
  },{timeout:15000});
  const blocker=await acquired;const payment=markHoaShareStatementPaid(f.admin.id,f.community.id,s.id,"RACE-CHECK").then(()=>null,error=>error);
  try{await waitBlocked(blocker);}finally{release();}await claim;
  expect(await payment).toMatchObject({status:409});expect(await first.hoaSharePayout.count({where:{statementId:s.id}})).toBe(0);
 });
});
it("committed refund reduces a waiting manual payout under the observed Community lock",async()=>{
 const f=await fixture();await historicalFixture(f,async clock=>{
  await paid(f);const s=await createHoaShareStatement(f.admin.id,f.community.id,clock.earnedMonth);
  let release!:()=>void,ready!:(pid:number)=>void;const gate=new Promise<void>(resolve=>{release=resolve});const acquired=new Promise<number>(resolve=>{ready=resolve});
  const refund=first.$transaction(async tx=>{
   await tx.stripeTestPayment.update({where:{visitId:f.ownVisit.id},data:{amountRefundedCents:333,status:"partially_refunded"}});
   const [{pid}]=await tx.$queryRaw<Array<{pid:number}>>`SELECT pg_backend_pid() AS pid`;ready(pid);await gate;
  },{timeout:15000});
  const blocker=await acquired;const payout=markHoaShareStatementPaid(f.admin.id,f.community.id,s.id,"AFTER-REFUND");
  try{await waitBlocked(blocker);}finally{release();}await refund;await payout;
  expect((await first.hoaSharePayout.findUniqueOrThrow({where:{statementId:s.id}})).amountCents).toBe(34);
 });
});
it("direct payout transition rechecks owner verification and holds and stamps first attempt with server time",async()=>{
 const f=await fixture();let opId="";await historicalFixture(f,async clock=>{
  await paid(f);const s=await createHoaShareStatement(f.admin.id,f.community.id,clock.earnedMonth);
  await first.community.update({where:{id:f.community.id},data:{stripeTestHoaAccountId:`acct_${f.tag}`,stripeTestHoaPayoutStatus:"active"}});
  const op=await first.hoaSharePayout.create({data:{id:randomUUID(),statementId:s.id,communityId:f.community.id,actorUserId:f.admin.id,method:"stripe",amountCents:50,accountId:`acct_${f.tag}`}});
  opId=op.id;
 }); // All test clock overrides are gone before verifying production attempt timestamps.
  await first.user.update({where:{id:f.admin.id},data:{isVerified:false}});
  await expect(first.hoaSharePayout.update({where:{id:opId},data:{attemptedAt:new Date("2099-01-01")}})).rejects.toThrow();
  await first.user.update({where:{id:f.admin.id},data:{isVerified:true}});
  await first.stripeTestPayment.update({where:{visitId:f.ownVisit.id},data:{reconciliationHoldReason:"external_refund"}});
  await expect(first.hoaSharePayout.update({where:{id:opId},data:{attemptedAt:new Date("2099-01-01")}})).rejects.toThrow();
  await first.stripeTestPayment.update({where:{visitId:f.ownVisit.id},data:{reconciliationHoldReason:null}});
  const before=Date.now();const attempted=await first.hoaSharePayout.update({where:{id:opId},data:{attemptedAt:new Date("2099-01-01")}});
  expect(attempted.attemptedAt!.getTime()).toBeGreaterThanOrEqual(before-1000);expect(attempted.attemptedAt!.getTime()).toBeLessThanOrEqual(Date.now()+1000);
  await expect(first.hoaSharePayout.update({where:{id:opId},data:{attemptedAt:new Date("2099-01-01")}})).rejects.toThrow();
  await expect(first.hoaSharePayout.update({where:{id:opId},data:{status:"paid"}})).rejects.toThrow();
});
it("rejects forged savings and provider binding against a valid completed-visit control",async()=>{
 const f=await fixture();
 await updateVisitStatus(f.provider.id,f.otherVisit.id,{status:"completed",completionNote:null});
 const data={...f.payment,visitId:f.otherVisit.id,unitId:f.residents[1].unit.id,residentUserId:f.residents[1].user.id};
 const rollback=new Error("rollback successful positive control");
 await expect(first.$transaction(async tx=>{const control=await tx.stripeTestPayment.create({data});expect(control).toMatchObject({visitId:f.otherVisit.id,hoaShareCents:50,providerAmountCents:901});throw rollback;})).rejects.toBe(rollback);
 expect(await first.stripeTestPayment.findUnique({where:{visitId:f.otherVisit.id}})).toBeNull();
 await expect(first.stripeTestPayment.create({data:{...data,residentSavingsCents:1}})).rejects.toThrow(/savings snapshot/i);
 await expect(first.stripeTestPayment.create({data:{...data,providerUserId:f.manager.id}})).rejects.toThrow(/original completed resident visit/i);
 await paid(f);
 // Duplicate zero-delta insertion is rejected; this is not isolated proof of the kind discriminator.
 await expect(first.hoaShareEntry.create({data:{id:randomUUID(),communityId:f.community.id,paymentVisitId:f.ownVisit.id,sequence:2,kind:"forged",amountCents:0,savingsCents:0,refundedCents:0}})).rejects.toThrow();
});
