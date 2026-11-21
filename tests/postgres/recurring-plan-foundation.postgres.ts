import { createHash, randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { beforeAll, afterAll, it, expect, vi } from "vitest";
const injection = vi.hoisted(() => ({ db: null as PrismaClient | null }));
vi.mock("@/lib/server/db", () => ({ db: new Proxy({}, { get(_target, key) { const db = injection.db!; const v = Reflect.get(db, key); return typeof v === "function" ? v.bind(db) : v; } }) }));
vi.mock("stripe", () => ({ default: class {} })); // No remote processor methods exist in this suite.
vi.mock("@vercel/blob", () => ({ put: vi.fn(async () => ({})), del: vi.fn(), get: vi.fn() }));
vi.mock("@/lib/server/notifications", async original => ({ ...await original<object>(), scheduleOutboxDrain: vi.fn() }));
import { createHoaRequest, respondToOptionalRequest, transitionHoaRequest, submitBid, awardBid, saveDayPlan, updateVisitStatus, closeOccurrence } from "@/lib/server/hoa-market";
import { hoaRequestCreateSchema, bidSubmitSchema } from "@/lib/validation/hoa";
import { storeProviderCredential } from "@/lib/server/provider-credentials";
import { updateProviderAdministration } from "@/lib/server/providers-admin";
import { reportServiceQuality } from "@/lib/server/service-quality";
import { proposeRecurringPlan, acceptRecurringPlan, generateRecurringMonth, requestRecurringStop, sealRecurringMonth, getRecurringPlanView, runRecurringPlanLifecycle } from "@/lib/server/recurring-plans";
import { addDaysToDateKey, zonedDateKey } from "@/lib/server/timezone";
let first: PrismaClient;
async function run<T>(_db: PrismaClient, work: () => Promise<T>) { return work(); }
beforeAll(() => { first = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.TEST_DATABASE_URL! }) }); injection.db = first; });
afterAll(async () => { await first?.$disconnect(); vi.unstubAllEnvs(); });
async function seed(category = "pool_care", options: { notifyEmail?: boolean; totalOccurrences?: number; paid?: boolean; startDate?: string } = {}) {
  const tag = `recurring56-${randomUUID()}`;
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
    ...(options.startDate ? {proposedStartDate:options.startDate} : {}),
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

async function recurringFixture() {
 const f=await seed('landscaping',{paid:true});
 await first.user.update({where:{id:f.manager.id},data:{isVerified:true}});
 const timezone='America/Chicago';
 await first.hoaProfile.update({where:{communityId:f.community.id},data:{timezone}});
 const lastFinite=await first.serviceOccurrence.findFirstOrThrow({where:{agreementId:f.agreementId},orderBy:{serviceDate:'desc'}});
 const anchorDate=addDaysToDateKey([zonedDateKey(new Date(),timezone),zonedDateKey(lastFinite.serviceDate,timezone)].sort().at(-1)!,1);
 const plan=await proposeRecurringPlan(f.manager.id,{id:randomUUID(),agreementId:f.agreementId,monthlyPriceCents:10001,billingMode:'monthly',anchorDate,cadenceDays:7});
 const providerOffer=await getRecurringPlanView(f.provider.id,plan.id);
 await acceptRecurringPlan(f.provider.id,plan.id,providerOffer.termsToken!);
 const resident=f.residents[0];
 const membership=await first.communityMembership.findFirstOrThrow({where:{userId:resident.user.id,communityId:f.community.id}});
 const customerId=`cus_${f.tag}`;
 await first.user.update({where:{id:resident.user.id},data:{stripeTestCustomerId:customerId}});
 const pending=await first.recurringSubscription.create({data:{id:randomUUID(),planId:plan.id,payerUserId:resident.user.id,unitId:resident.unit.id,membershipId:membership.id,startDate:anchorDate,monthlyCapCents:10001,currency:'usd',termsVersion:'recurring-monthly-cap-v1',termsToken:'fixture-consent',receiptEmail:resident.user.email}});
 const subscription=await first.recurringSubscription.update({where:{id:pending.id},data:{status:'active',customerId,paymentMethodId:`pm_${f.tag}`,setupIntentId:`seti_${f.tag}`,cardVerifiedAt:new Date()}});
 return {...f,plan,subscription,anchorDate};
}
it('serializes duplicate generation and freezes original payer, allocation and source identity',async()=>{
 const f=await recurringFixture();const month=f.anchorDate.slice(0,7);
 const results=await Promise.all([generateRecurringMonth(f.plan.id,month),generateRecurringMonth(f.plan.id,month)]);
 const visits=await first.serviceVisit.findMany({where:{recurringSubscriptionId:f.subscription.id}});
 expect(visits.length).toBeGreaterThan(0);expect(results.reduce((sum,r)=>sum+r.created,0)).toBe(visits.length);
 expect(visits.every(v=>v.billingPayerUserId===f.subscription.payerUserId)).toBe(true);
 await expect(first.serviceVisit.update({where:{id:visits[0].id},data:{status:'completed',completedAt:new Date()}})).rejects.toThrow('Recurring service is future or outside notice coverage');
 await expect(first.serviceVisit.create({data:{occurrenceId:visits[0].occurrenceId,unitId:f.subscription.unitId,billingPayerUserId:f.subscription.payerUserId,allocatedVisitCents:visits[0].allocatedVisitCents,requiresAfterPhoto:visits[0].requiresAfterPhoto,recurringSubscriptionId:f.subscription.id,recurringMonth:month,status:'completed',completedAt:new Date()}})).rejects.toThrow('New recurring service must start unscheduled');
 await expect(first.outboxEvent.create({data:{kind:'stripe_test_visit_charge',dedupeKey:randomUUID(),payload:{visitId:visits[0].id}}})).rejects.toThrow('Recurring visits cannot enqueue legacy charges');
 await expect(first.serviceVisit.update({where:{id:visits[0].id},data:{allocatedVisitCents:1}})).rejects.toThrow();
 await expect(first.recurringSubscription.update({where:{id:f.subscription.id},data:{monthlyCapCents:9999}})).rejects.toThrow();
 await expect(first.serviceAgreement.update({where:{id:f.agreementId},data:{status:'completed'}})).rejects.toThrow();
});
it('enforces notice against direct SQL and retains repeat notice identity',async()=>{
 const f=await recurringFixture();
 await expect(first.recurringSubscription.update({where:{id:f.subscription.id},data:{stopKind:'cancel',stopEffectiveDate:f.anchorDate,stopRequestedAt:new Date()}})).rejects.toThrow();
 const firstNotice=await requestRecurringStop(f.subscription.payerUserId,f.subscription.id,'pause');
 const secondNotice=await requestRecurringStop(f.subscription.payerUserId,f.subscription.id,'pause');
 expect(secondNotice.stopEffectiveDate).toBe(firstNotice.stopEffectiveDate);
 await expect(first.recurringSubscription.update({where:{id:f.subscription.id},data:{status:'paused',stoppedAt:new Date()}})).rejects.toThrow();
 await expect(first.recurringSubscription.update({where:{id:f.subscription.id},data:{stopKind:null,stopEffectiveDate:null,stopRequestedAt:null}})).rejects.toThrow();
});

// Accounting-only historical fixtures: no claim about production chronology.
// Exact IDs, no disabled guards, removed before any billing assertions.
async function historicalClock<T>(binding:{planId:string;subscriptionId:string;anchorDate:string;planToken:string;subscriptionToken:string},work:()=>Promise<T>) {
 const name=`fixture56_${randomUUID().replaceAll('-','')}`;
 const current=await first.$queryRaw<Array<{name:string}>>`SELECT current_database() AS name`;
 if(current[0]?.name!=='bundleen_issue56_test_recurring')throw new Error('Wrong fixture database');
 await first.$executeRawUnsafe(`CREATE TABLE "${name}" ("planId" text,"subscriptionId" text,"anchorDate" text,"planToken" text,"subscriptionToken" text)`);
 try {
  await first.$executeRawUnsafe(`INSERT INTO "${name}" VALUES($1,$2,$3,$4,$5)`,binding.planId,binding.subscriptionId,binding.anchorDate,binding.planToken,binding.subscriptionToken);
  await first.$executeRawUnsafe(`CREATE FUNCTION "${name}"() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE f record; BEGIN IF current_database()<>'bundleen_issue56_test_recurring' THEN RAISE EXCEPTION 'Wrong fixture database'; END IF; SELECT * INTO f FROM "${name}"; IF TG_TABLE_NAME='RecurringPlan' AND NEW."id"=f."planId" THEN NEW."anchorDate":=f."anchorDate"; NEW."termsToken":=f."planToken"; ELSIF TG_TABLE_NAME='RecurringSubscription' AND NEW."id"=f."subscriptionId" AND NEW."planId"=f."planId" THEN NEW."startDate":=f."anchorDate"; NEW."termsToken":=f."subscriptionToken"; END IF; RETURN NEW; END $$`);
  for(const table of ['RecurringPlan','RecurringSubscription'])await first.$executeRawUnsafe(`CREATE TRIGGER "zz_${name}" BEFORE INSERT ON "${table}" FOR EACH ROW EXECUTE FUNCTION "${name}"()`);
  return await work();
 }finally{
  for(const table of ['RecurringPlan','RecurringSubscription'])await first.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "zz_${name}" ON "${table}"`);
  await first.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${name}"()`);
  await first.$executeRawUnsafe(`DROP TABLE IF EXISTS "${name}"`);
 }
}

it('seals historical completed allocations once, excludes skipped cents and freezes constituents',async()=>{
 const f=await seed('landscaping',{paid:true,startDate:'2024-12-20T18:00:00.000Z'});
 await first.user.update({where:{id:f.manager.id},data:{isVerified:true}});
 const timezone='America/Chicago';await first.hoaProfile.update({where:{communityId:f.community.id},data:{timezone}});
 const agreement=await first.serviceAgreement.findUniqueOrThrow({where:{id:f.agreementId}});
 const request=await first.hoaServiceRequest.findUniqueOrThrow({where:{id:f.requestId}});
 const membership=await first.communityMembership.findFirstOrThrow({where:{userId:f.residents[0].user.id,communityId:f.community.id}});
 const planId=randomUUID(),subscriptionId=randomUUID(),anchorDate='2025-01-01',termsVersion='recurring-monthly-cap-v1';
 const terms={id:planId,agreementId:f.agreementId,monthlyPriceCents:10001,billingMode:'monthly' as const,anchorDate,cadenceDays:7,requestId:f.requestId,communityId:f.community.id,providerUserId:f.provider.id,scope:agreement.scope,timezone,currency:'usd',requiresAfterPhoto:request.requiresAfterPhoto,termsVersion};
 const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
 const planToken=hash(terms),subscriptionToken=hash([termsVersion,planToken,f.residents[0].user.id,membership.id,membership.unitId,anchorDate,10001]);
 const today=zonedDateKey(new Date(),timezone),customerId=`cus_${f.tag}`;
 await first.user.update({where:{id:f.residents[0].user.id},data:{stripeTestCustomerId:customerId}});
 await historicalClock({planId,subscriptionId,anchorDate,planToken,subscriptionToken},async()=>{
  await proposeRecurringPlan(f.manager.id,{id:planId,agreementId:f.agreementId,monthlyPriceCents:10001,billingMode:'monthly',anchorDate:today,cadenceDays:7});
  await acceptRecurringPlan(f.provider.id,planId,planToken);
  await first.recurringSubscription.create({data:{id:subscriptionId,planId,payerUserId:f.residents[0].user.id,unitId:membership.unitId!,membershipId:membership.id,startDate:today,monthlyCapCents:10001,currency:'usd',termsVersion,termsToken:subscriptionToken,receiptEmail:f.residents[0].user.email}});
 });
 await first.recurringSubscription.update({where:{id:subscriptionId},data:{status:'active',customerId,paymentMethodId:`pm_${f.tag}`,setupIntentId:`seti_${f.tag}`,cardVerifiedAt:new Date()}});
 const visits=[];
 for(const [index,date] of ['01','08','15','22','29'].entries()) {
  const occurrence=await first.serviceOccurrence.create({data:{agreementId:f.agreementId,sequence:100+index,serviceDate:new Date(`2025-01-${date}T18:00:00Z`),recurringPlanId:planId,recurringLocalDate:`2025-01-${date}`}});
  const visit=await first.serviceVisit.create({data:{occurrenceId:occurrence.id,unitId:membership.unitId!,billingPayerUserId:f.residents[0].user.id,allocatedVisitCents:index===0?2001:2000,requiresAfterPhoto:false,recurringSubscriptionId:subscriptionId,recurringMonth:'2025-01'}});
  await saveDayPlan(f.provider.id,occurrence.id,{publish:true,stops:[{visitId:visit.id,stopRank:1,windowStart:'10:00',windowEnd:'11:00'}]});
  await updateVisitStatus(f.provider.id,visit.id,{status:index===1?'skipped':'completed',completionNote:index===1?'Synthetic skip':null});
  visits.push(visit);
 }
 const bills=await Promise.all([sealRecurringMonth(planId,subscriptionId,'2025-01'),sealRecurringMonth(planId,subscriptionId,'2025-01')]);
 expect(bills[0].id).toBe(bills[1].id);expect(bills[0].amountCents).toBe(8001);
 expect(await first.recurringBillLine.count({where:{billId:bills[0].id}})).toBe(5);
 await expect(first.serviceVisit.update({where:{id:visits[1].id},data:{status:'completed',completedAt:new Date()}})).rejects.toThrow();
 await expect(first.recurringMonthlyBill.update({where:{id:bills[0].id},data:{amountCents:10001}})).rejects.toThrow();
});

async function elapsedPauseFixture<T>(subscriptionId:string,work:()=>Promise<T>) {
 const name=`fixture56_pause_${randomUUID().replaceAll('-','')}`;
 const current=await first.$queryRaw<Array<{name:string}>>`SELECT current_database() AS name`;
 if(current[0]?.name!=='bundleen_issue56_test_recurring'||! /^[0-9a-f-]{36}$/.test(subscriptionId))throw new Error('Wrong elapsed notice fixture');
 // UUID is generated by this suite; no arbitrary SQL identifiers or values.
 await first.$executeRawUnsafe(`CREATE FUNCTION "${name}"() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE tz text; BEGIN IF current_database()<>'bundleen_issue56_test_recurring' THEN RAISE EXCEPTION 'Wrong fixture database'; END IF; IF NEW."id"='${subscriptionId}' AND OLD."status"='active' AND NEW."status"='active' AND OLD."stopKind" IS NULL AND NEW."stopKind"='pause' THEN SELECT "timezone" INTO tz FROM "RecurringPlan" WHERE "id"=NEW."planId"; NEW."stopEffectiveDate":=to_char(clock_timestamp() AT TIME ZONE tz,'YYYY-MM-DD'); NEW."stopRequestedAt":=((clock_timestamp() AT TIME ZONE tz)-interval '30 days') AT TIME ZONE tz; END IF; RETURN NEW; END $$`);
 try {
  await first.$executeRawUnsafe(`CREATE TRIGGER "zz_${name}" BEFORE UPDATE ON "RecurringSubscription" FOR EACH ROW EXECUTE FUNCTION "${name}"()`);
  return await work();
 }finally{
  await first.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "zz_${name}" ON "RecurringSubscription"`);
  await first.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${name}"()`);
 }
}
it('fresh consent resumes the same future service day without overwriting canceled enrollment history',async()=>{
 const f=await recurringFixture();const now=new Date();const month=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()+2,1)).toISOString().slice(0,7);
 await generateRecurringMonth(f.plan.id,month);
 const oldVisits=await first.serviceVisit.findMany({where:{recurringSubscriptionId:f.subscription.id,recurringMonth:month}});expect(oldVisits.length).toBeGreaterThan(0);
 await elapsedPauseFixture(f.subscription.id,()=>requestRecurringStop(f.subscription.payerUserId,f.subscription.id,'pause'));
 await runRecurringPlanLifecycle();
 expect((await first.recurringSubscription.findUniqueOrThrow({where:{id:f.subscription.id}})).status).toBe('paused');
 expect(await first.serviceVisit.count({where:{id:{in:oldVisits.map(v=>v.id)},status:'cancelled'}})).toBe(oldVisits.length);
 await expect(closeOccurrence(f.manager.id,oldVisits[0].occurrenceId)).rejects.toThrow('A future recurring service day cannot be closed');
 await expect(first.serviceOccurrence.update({where:{id:oldVisits[0].occurrenceId},data:{status:'completed',closedAt:new Date()}})).rejects.toThrow('Future recurring days cannot close');
 const oldDay=await first.serviceOccurrence.findUniqueOrThrow({where:{id:oldVisits[0].occurrenceId}});
 await expect(first.serviceOccurrence.create({data:{agreementId:f.agreementId,sequence:9999,serviceDate:oldDay.serviceDate,recurringPlanId:f.plan.id,recurringLocalDate:oldDay.recurringLocalDate,status:'completed',closedAt:new Date()}})).rejects.toThrow('New recurring day must start planned');
 const prior=await first.recurringSubscription.findUniqueOrThrow({where:{id:f.subscription.id}});
 const pending=await first.recurringSubscription.create({data:{id:randomUUID(),planId:f.plan.id,payerUserId:prior.payerUserId,unitId:prior.unitId,membershipId:prior.membershipId,startDate:f.anchorDate,monthlyCapCents:prior.monthlyCapCents,currency:'usd',termsVersion:prior.termsVersion,termsToken:'fresh-resume-consent',receiptEmail:prior.receiptEmail}});
 await first.recurringSubscription.update({where:{id:pending.id},data:{status:'active',customerId:prior.customerId,paymentMethodId:`pm_resume_${f.tag}`,setupIntentId:`seti_resume_${f.tag}`,cardVerifiedAt:new Date()}});
 await Promise.all([generateRecurringMonth(f.plan.id,month),generateRecurringMonth(f.plan.id,month)]);
 const resumed=await first.serviceVisit.findMany({where:{recurringSubscriptionId:pending.id,recurringMonth:month}});
 expect(resumed.length).toBe(oldVisits.length);expect(new Set(resumed.map(v=>v.occurrenceId))).toEqual(new Set(oldVisits.map(v=>v.occurrenceId)));
 expect(await first.serviceVisit.count({where:{id:{in:oldVisits.map(v=>v.id)},status:'cancelled'}})).toBe(oldVisits.length);
 await expect(first.serviceVisit.update({where:{id:oldVisits[0].id},data:{status:'unscheduled'}})).rejects.toThrow();
 await saveDayPlan(f.provider.id,resumed[0].occurrenceId,{publish:true,stops:[{visitId:resumed[0].id,stopRank:1,windowStart:'10:00',windowEnd:'11:00'}]});
 expect((await first.serviceVisit.findUniqueOrThrow({where:{id:resumed[0].id}})).status).toBe('scheduled');
});
