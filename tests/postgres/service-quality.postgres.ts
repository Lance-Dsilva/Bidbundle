import { reserveStripeTestRefund } from "@/lib/server/stripe-test-refunds";
import { transferStripeTestPayment } from "@/lib/server/stripe-test-transfers";
import { scheduleQualityRedo, reconcileQualityResolution } from "@/lib/server/service-quality-resolution";
const stripeMock = vi.hoisted(() => ({ list: vi.fn(), charge: vi.fn(), account: vi.fn(), transfer: vi.fn() }));
vi.mock("stripe", () => ({ default: class { charges = { retrieve: stripeMock.charge }; accounts = { retrieve: stripeMock.account }; transfers = { create: stripeMock.transfer, list: stripeMock.list }; } }));
import { serviceQualityMetrics } from "@/lib/server/service-quality-metrics";
import sharp from "sharp";
import { storeQualityPhoto, listQualityPhotos } from "@/lib/server/service-quality-photos";
import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
const injection = vi.hoisted(() => ({ db: null as PrismaClient | null }));
vi.mock("@/lib/server/db", () => ({ db: new Proxy({}, { get(_target, key) { const db = injection.db!; const v = Reflect.get(db, key); return typeof v === "function" ? v.bind(db) : v; } }) }));
vi.mock("@vercel/blob", () => ({ put: vi.fn(async () => ({})), del: vi.fn(), get: vi.fn() }));
vi.mock("@/lib/server/notifications", async (original) => ({ ...await original<object>(), scheduleOutboxDrain: vi.fn() }));
import { createHoaRequest, respondToOptionalRequest, transitionHoaRequest, submitBid, awardBid, saveDayPlan, updateVisitStatus } from "@/lib/server/hoa-market";
import { hoaRequestCreateSchema, bidSubmitSchema } from "@/lib/validation/hoa";
import { storeProviderCredential } from "@/lib/server/provider-credentials";
import { updateProviderAdministration } from "@/lib/server/providers-admin";
import { reportServiceQuality, requestQualityResolution, respondToQualityClaim } from "@/lib/server/service-quality";
let first: PrismaClient;
async function run<T>(_db: PrismaClient, work: () => Promise<T>) { return work(); }
beforeAll(() => { vi.stubEnv("SERVICE_QUALITY_INTAKE", "1"); first = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.TEST_DATABASE_URL! }) }); injection.db = first; });
afterAll(async () => { await first?.$disconnect(); vi.unstubAllEnvs(); });
async function seed(category = "pool_care", options: { notifyEmail?: boolean; totalOccurrences?: number; paid?: boolean } = {}) {
  const tag = `quality50-${randomUUID()}`;
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
    amountCents: options.paid ? 2000 : 10000, pricingBasis: "total", scope: "Fixture whole-job service",
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

describe("service quality transactions on migrated PostgreSQL", () => {
  it("serializes duplicate claims and atomically records ticket and notifications", async () => {
    const f = await seed("landscaping");
    await updateVisitStatus(f.provider.id, f.ownVisit.id, { status: "completed", completionNote: null });
    const input = { reason: "incomplete" as const, description: "The agreed service was incomplete." };
    const [one,two] = await Promise.all([reportServiceQuality(f.residents[0].user.id,f.ownVisit.id,input),reportServiceQuality(f.residents[0].user.id,f.ownVisit.id,input)]);
    expect(one.id).toBe(two.id);
    const metrics = await serviceQualityMetrics(f.admin.id);
    expect(metrics.providers.find(row=>row.providerUserId===f.provider.id)).toMatchObject({claims:1,completedVisits:1,claimRateBps:10000,reviewSuggested:false});
    expect(await first.serviceQualityClaim.count({where:{visitId:f.ownVisit.id}})).toBe(1);
    expect(await first.supportTicket.count({where:{relatedVisitId:f.ownVisit.id}})).toBe(1);
    expect(await first.notification.count({where:{dedupeKey:{startsWith:`quality:${one.id}:`}}})).toBe(2);
    const before = await first.supportTicket.findUniqueOrThrow({where:{id:one.ticketId}});
    await respondToQualityClaim(f.provider.id,one.id,{response:"We will review the completed work."});
    const after = await first.supportTicket.findUniqueOrThrow({where:{id:one.ticketId}});
    expect(after.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());
    expect(await first.supportTicketEvent.count({where:{ticketId:one.ticketId,type:"internal_note_added"}})).toBe(1);
    expect(await requestQualityResolution(f.admin.id,one.id,{action:"request_refund",note:"Pending payment integration review."})).toEqual({resolution:"refund_pending",executed:false});
    expect((await first.supportTicket.findUniqueOrThrow({where:{id:one.ticketId}})).status).toBe("new");
  });
  it("rejects another resident and removed/re-added membership with preserved joinedAt", async () => {
    const f = await seed("landscaping");
    await updateVisitStatus(f.provider.id, f.ownVisit.id, { status: "completed", completionNote: null });
    const input = {reason:"incomplete" as const,description:"The agreed service was incomplete."};
    await expect(reportServiceQuality(f.residents[1].user.id,f.ownVisit.id,input)).rejects.toMatchObject({status:404});
    await first.communityMembership.update({where:{communityId_userId:{communityId:f.community.id,userId:f.residents[0].user.id}},data:{status:"removed"}});
    await first.communityMembership.update({where:{communityId_userId:{communityId:f.community.id,userId:f.residents[0].user.id}},data:{status:"active"}});
    await expect(reportServiceQuality(f.residents[0].user.id,f.ownVisit.id,input)).rejects.toMatchObject({status:404});
    expect(await first.serviceQualityClaim.count({where:{visitId:f.ownVisit.id}})).toBe(0);
  });
});

it("stores private normalized evidence with a serialized eight-photo cap", async () => {
 const f = await seed("landscaping");
 await updateVisitStatus(f.provider.id, f.ownVisit.id, {status:"completed",completionNote:null});
 const claim = await reportServiceQuality(f.residents[0].user.id,f.ownVisit.id,{reason:"incomplete",description:"The service was not completed."});
 const bytes = await sharp({create:{width:12,height:12,channels:3,background:{r:0,g:100,b:100}}}).png().toBuffer();
 const results = await Promise.allSettled(Array.from({length:9},()=>storeQualityPhoto(f.residents[0].user.id,claim.id,new Blob([new Uint8Array(bytes)],{type:"image/png"}))));
 expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(8);
 expect(await first.serviceQualityPhoto.count({where:{claimId:claim.id}})).toBe(8);
 const stored = await first.serviceQualityPhoto.findFirstOrThrow({where:{claimId:claim.id}});
 expect(stored.storagePath).toMatch(/^quality-photos\//);
 expect((await listQualityPhotos(f.provider.id,claim.id))[0]).not.toHaveProperty("storagePath");
 await expect(listQualityPhotos(f.residents[1].user.id,claim.id)).rejects.toMatchObject({status:404});
 await expect(listQualityPhotos(f.manager.id,claim.id)).rejects.toMatchObject({status:404});
});


async function paidFixture() {
 const f = await seed("landscaping", { paid: true });
 await first.adminAccessGrant.update({ where: { userId: f.admin.id }, data: { level: "owner" } });
 await updateVisitStatus(f.provider.id, f.ownVisit.id, { status: "completed", completionNote: null });
 await first.providerProfile.update({ where: { userId: f.provider.id }, data: { stripeTestAccountId: `acct_${f.ownVisit.id}`, stripeTestPayoutStatus: "active" } });
 const pay = await first.stripeTestPayment.create({ data: { visitId: f.ownVisit.id, requestId: f.requestId, agreementId: f.agreementId, communityId: f.community.id, residentUserId: f.residents[0].user.id, providerUserId: f.provider.id, unitId: f.residents[0].unit.id, customerId: `cus_${f.ownVisit.id}`, paymentMethodId: "pm_fixture", providerAccountId: `acct_${f.ownVisit.id}`, termsToken: "fixture", amountCents: 1000, platformFeeCents: 100, providerAmountCents: 900, currency: "usd", status: "succeeded", stripeChargeId: `ch_${f.ownVisit.id}`, stripePaymentIntentId: `pi_${f.ownVisit.id}` } });
 stripeMock.list.mockResolvedValue({data:[],has_more:false});
 stripeMock.charge.mockResolvedValue({ livemode: false, paid: true, disputed: false, amount_refunded: 0, amount: 1000, amount_captured: 1000, currency: "usd", payment_intent: pay.stripePaymentIntentId, customer: pay.customerId });
 stripeMock.account.mockResolvedValue({ metadata: { bundleenProviderUserId: f.provider.id }, payouts_enabled: true, capabilities: { transfers: "active" } });
 stripeMock.transfer.mockResolvedValue({ id: `tr_${f.ownVisit.id}`, livemode: false, amount: 900, currency: "usd", destination: pay.providerAccountId, source_transaction: pay.stripeChargeId });
 vi.stubEnv("STRIPE_TEST_TRANSFERS", "1"); vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_fixture");
 return { ...f, pay };
}
async function waitForBlock(pid: number) {
 const until = Date.now()+5000;
 while (Date.now()<until) {
  const rows = await first.$queryRaw<Array<{ blocked: boolean }>>`SELECT EXISTS(SELECT 1 FROM pg_stat_activity a WHERE ${pid}=ANY(pg_blocking_pids(a.pid))) AS blocked`;
  if(rows[0].blocked) return;
  await new Promise(resolve=>setTimeout(resolve,20));
 }
 throw new Error("Expected actual PostgreSQL lock wait");
}
it("unresolved claim wins observed transfer lock race without aging transfer clock", async()=>{
 const f=await paidFixture(); const before=stripeMock.transfer.mock.calls.length;
 let release!:()=>void, locked!: (pid:number)=>void;
 const ready=new Promise<number>(resolve=>{locked=resolve}); const gate=new Promise<void>(resolve=>{release=resolve});
 const intake=first.$transaction(async tx=>{
  await tx.$queryRaw`SELECT "id" FROM "ServiceVisit" WHERE "id"=${f.ownVisit.id} FOR UPDATE`;
  const [{pid}]=await tx.$queryRaw<Array<{pid:number}>>`SELECT pg_backend_pid() AS pid`;
  locked(pid); await gate;
  const ticket=await tx.supportTicket.create({data:{ticketNumber:`RACE-${randomUUID()}`,requesterUserId:f.residents[0].user.id,requesterRole:"homeowner",category:"service_quality",subject:"Observed claim race",communityId:f.community.id}});
  await tx.serviceQualityClaim.create({data:{visitId:f.ownVisit.id,ticketId:ticket.id,requesterUserId:f.residents[0].user.id,providerUserId:f.provider.id,reason:"incomplete"}});
 },{timeout:15000});
 const pid=await ready; const transfer=transferStripeTestPayment(f.ownVisit.id).then(()=>null,error=>error);
 try{await waitForBlock(pid);}finally{release();} await intake;
 expect(await transfer).toMatchObject({status:409}); expect(stripeMock.transfer.mock.calls.length).toBe(before);
 expect((await first.stripeTestPayment.findUniqueOrThrow({where:{visitId:f.ownVisit.id}})).transferAttemptedAt).toBeNull();
});
it("transfer wins lock before intake, with claim retained for later refund rather than fictional hold", async()=>{
 const f=await paidFixture(); let release!:()=>void, entered!:()=>void;
 const ready=new Promise<void>(resolve=>{entered=resolve}); const gate=new Promise<void>(resolve=>{release=resolve});
 stripeMock.transfer.mockImplementationOnce(async()=>{entered();await gate;return {id:`tr_${f.ownVisit.id}`,livemode:false,amount:900,currency:"usd",destination:f.pay.providerAccountId,source_transaction:f.pay.stripeChargeId};});
 const transfer=transferStripeTestPayment(f.ownVisit.id); await ready;
 const lockRows=await first.$queryRaw<Array<{pid:number}>>`SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND state='idle in transaction' AND pid<>pg_backend_pid()`;
 const intake=reportServiceQuality(f.residents[0].user.id,f.ownVisit.id,{reason:"incomplete",description:"The agreed work was incomplete."});
 try{expect(lockRows).toHaveLength(1);await waitForBlock(lockRows[0].pid);}finally{release();}
 await transfer; const claim=await intake;
 expect(claim.resolution).toBe("reported"); expect((await first.stripeTestPayment.findUniqueOrThrow({where:{visitId:f.ownVisit.id}})).stripeTransferId).toBe(`tr_${f.ownVisit.id}`);
});
it("creates immutable no-charge redo and closes claim only after actual completion",async()=>{
 const f=await paidFixture(); const claim=await reportServiceQuality(f.residents[0].user.id,f.ownVisit.id,{reason:"incomplete",description:"The agreed work was incomplete."});
 await requestQualityResolution(f.admin.id,claim.id,{action:"request_redo",note:"Approved no-charge return visit."});
 const redo=await scheduleQualityRedo(f.admin.id,claim.id,new Date(Date.now()+86400000),"Approved return visit date.");
 const visit=await first.serviceVisit.findUniqueOrThrow({where:{id:redo.redoVisitId!}});
 expect(visit).toMatchObject({redoOfVisitId:f.ownVisit.id,allocatedVisitCents:0,billingPayerUserId:f.residents[0].user.id});
 await expect(first.outboxEvent.create({data:{kind:"stripe_test_visit_charge",dedupeKey:`redo-${visit.id}`,payload:{visitId:visit.id}}})).rejects.toThrow();
 await expect(first.serviceVisit.update({where:{id:visit.id},data:{allocatedVisitCents:100}})).rejects.toThrow();
 await expect(reconcileQualityResolution(claim.id)).resolves.toMatchObject({executed:false});
 await updateVisitStatus(f.provider.id,visit.id,{status:"completed",completionNote:null});
 await expect(reconcileQualityResolution(claim.id)).resolves.toEqual({executed:true,resolution:"redo_complete"});
 expect(await first.stripeTestPayment.count({where:{visitId:visit.id}})).toBe(0);
 expect(await first.outboxEvent.count({where:{dedupeKey:`stripe-test-charge:${visit.id}`}})).toBe(0);
 await expect(first.serviceQualityClaim.delete({where:{id:claim.id}})).rejects.toThrow();
});

it("links the explicit partial refund then pays only the remaining provider share",async()=>{
 const f=await paidFixture();vi.stubEnv("STRIPE_TEST_REFUNDS", "1");
 const claim=await reportServiceQuality(f.residents[0].user.id,f.ownVisit.id,{reason:"incomplete",description:"The agreed work was incomplete."});
 await requestQualityResolution(f.admin.id,claim.id,{action:"request_refund",note:"Agreed partial service refund."});
 const op=await first.$transaction(async tx=>{const reserved=await reserveStripeTestRefund(tx,f.admin.id,f.ownVisit.id,{id:randomUUID(),amountCents:400,reason:"service_quality"});await tx.serviceQualityClaim.update({where:{id:claim.id},data:{refundOperationId:reserved.id}});return reserved;});
 await expect(first.serviceQualityClaim.update({where:{id:claim.id},data:{resolution:"refund_complete",resolvedAt:new Date()}})).rejects.toThrow();
 await first.$transaction([
  first.stripeTestRefund.update({where:{id:op.id},data:{state:"succeeded",stripeRefundId:`re_${op.id}`}}),
  first.stripeTestPayment.update({where:{visitId:f.ownVisit.id},data:{amountRefundedCents:400,status:"partially_refunded"}})
 ]);
 await expect(reconcileQualityResolution(claim.id)).resolves.toEqual({executed:true,resolution:"refund_complete"});
 stripeMock.charge.mockResolvedValue({livemode:false,paid:true,disputed:false,amount_refunded:400,amount:1000,amount_captured:1000,currency:"usd",payment_intent:f.pay.stripePaymentIntentId,customer:f.pay.customerId});
 stripeMock.transfer.mockResolvedValue({id:`tr_${f.ownVisit.id}`,livemode:false,amount:540,currency:"usd",destination:f.pay.providerAccountId,source_transaction:f.pay.stripeChargeId});
 await transferStripeTestPayment(f.ownVisit.id);
 const payment=await first.stripeTestPayment.findUniqueOrThrow({where:{visitId:f.ownVisit.id}});
 expect(payment).toMatchObject({transferAmountCents:540,transferRefundedBeforeCents:400,providerReversedCents:0});
 const final=await first.$transaction(tx=>reserveStripeTestRefund(tx,f.admin.id,f.ownVisit.id,{id:randomUUID(),amountCents:600,reason:"requested_by_customer"}));
 expect(final.reversalCents).toBe(540);
 await expect(first.stripeTestPayment.update({where:{visitId:f.ownVisit.id},data:{transferAmountCents:900}})).rejects.toThrow();
});
it("rejects attempted transfer state on fresh ledger inserts while allowing an unattempted row", async()=>{
 const f=await paidFixture();
 const data={...f.pay,visitId:f.otherVisit.id,residentUserId:f.residents[1].user.id,unitId:f.residents[1].unit.id,stripePaymentIntentId:`pi_${f.otherVisit.id}`,stripeChargeId:`ch_${f.otherVisit.id}`};
 for(const change of [{transferAttemptedAt:new Date()},{stripeTransferId:`tr_${f.otherVisit.id}`},{transferAmountCents:900,transferRefundedBeforeCents:0}]) {
  await expect(first.stripeTestPayment.create({data:{...data,...change}})).rejects.toThrow(/unattempted/);
 }
 expect((await first.stripeTestPayment.create({data})).transferAmountCents).toBeNull();
});
