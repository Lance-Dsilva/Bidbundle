import { createHash, randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { beforeAll, afterAll, it, expect, vi } from "vitest";
const injection = vi.hoisted(() => ({ db: null as PrismaClient | null }));
vi.mock("@/lib/server/db", () => ({ db: new Proxy({}, { get(_target, key) { const db = injection.db!; const v = Reflect.get(db, key); return typeof v === "function" ? v.bind(db) : v; } }) }));
const processor=vi.hoisted(()=>({create:vi.fn(),retrieve:vi.fn(),confirm:vi.fn(),chargeRetrieve:vi.fn(),refundCreate:vi.fn(),refundRetrieve:vi.fn(),refundList:vi.fn(),transferRetrieve:vi.fn(),reversalCreate:vi.fn(),reversalRetrieve:vi.fn(),reversalList:vi.fn()}));
vi.mock("stripe",()=>({default:class{charges={retrieve:processor.chargeRetrieve};refunds={create:processor.refundCreate,retrieve:processor.refundRetrieve,list:processor.refundList};transfers={retrieve:processor.transferRetrieve,createReversal:processor.reversalCreate,retrieveReversal:processor.reversalRetrieve,listReversals:processor.reversalList};paymentIntents={create:processor.create,retrieve:processor.retrieve,confirm:processor.confirm};}}));
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


async function financialFixture(){
 vi.stubEnv('STRIPE_TEST_PAYMENTS','0');
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
 const bill=await sealRecurringMonth(planId,subscriptionId,'2025-01');
 await first.adminAccessGrant.update({where:{userId:f.admin.id},data:{level:'owner'}});
 await setHoaShareRate(f.admin.id,f.community.id,500);
 await first.providerProfile.update({where:{userId:f.provider.id},data:{stripeTestAccountId:`acct_${f.tag}`,stripeTestPayoutStatus:'active'}});
 vi.stubEnv('STRIPE_TEST_PAYMENTS','1');vi.stubEnv('RECURRING_TEST_PAYMENTS','1');vi.stubEnv('STRIPE_SECRET_KEY','sk_test_fake');
 return {...f,bill,planId,subscriptionId,visits};
}

import { prepareRecurringCharge, chargeRecurringSource } from '@/lib/server/recurring-payments';
import { requestRecurringRefund, reserveRecurringRefund, processRecurringRefund } from '@/lib/server/recurring-refunds';
import { setHoaShareRate, createHoaShareStatement, markHoaShareStatementPaid } from '@/lib/server/hoa-revenue-share';
it('reserves one aggregate across concurrent workers and rejects source/line mutation',async()=>{
 const f=await financialFixture();
 const charges=await Promise.all([prepareRecurringCharge({monthlyBillId:f.bill.id}),prepareRecurringCharge({monthlyBillId:f.bill.id})]);
 expect(charges[0].id).toBe(charges[1].id);expect(charges[0].amountCents).toBe(8001);
 const lines=await first.recurringChargeLine.findMany({where:{chargeId:charges[0].id}});expect(lines).toHaveLength(4);
 expect(lines.reduce((n,l)=>n+l.providerCents,0)).toBe(7201);expect(lines.reduce((n,l)=>n+l.hoaCents,0)).toBe(400);
 await expect(prepareRecurringCharge({visitId:lines[0].visitId})).rejects.toThrow('authorization is incomplete');
 await expect(first.recurringCharge.update({where:{id:charges[0].id},data:{receiptEmail:'foreign@example.invalid'}})).rejects.toThrow();
 await expect(first.recurringChargeLine.update({where:{id:lines[0].id},data:{grossCents:1}})).rejects.toThrow();
});
it('paid aggregate accrues HOA once and concurrent refund reservations cannot overspend a line',async()=>{
 const f=await financialFixture();const charge=await prepareRecurringCharge({monthlyBillId:f.bill.id});
 let remote:any;
 processor.create.mockImplementation(async(data:any)=>remote={id:`pi_${charge.id}`,livemode:false,status:'requires_confirmation',...data});
 processor.retrieve.mockImplementation(async()=>({...remote}));
 processor.confirm.mockImplementation(async()=>remote={...remote,status:'succeeded',latest_charge:`ch_${charge.id}`});
 await chargeRecurringSource({monthlyBillId:f.bill.id});await chargeRecurringSource({monthlyBillId:f.bill.id});
 expect(processor.confirm).toHaveBeenCalledTimes(1);
 const entries=await first.hoaShareEntry.findMany({where:{recurringChargeId:charge.id}});expect(entries).toHaveLength(1);expect(entries[0].amountCents).toBe(400);
 const line=await first.recurringChargeLine.findFirstOrThrow({where:{chargeId:charge.id}});
 const results=await Promise.allSettled([requestRecurringRefund(f.admin.id,line.visitId,{id:randomUUID(),amountCents:line.grossCents,reason:'service_quality'}),requestRecurringRefund(f.admin.id,line.visitId,{id:randomUUID(),amountCents:1,reason:'service_quality'})]);
 expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(results.filter(r=>r.status==='rejected')).toHaveLength(1);
});
async function paidFixture(){
 const f=await financialFixture();const charge=await prepareRecurringCharge({monthlyBillId:f.bill.id});let remote:any;
 processor.create.mockImplementation(async(data:any)=>remote={id:`pi_${charge.id}`,livemode:false,status:'requires_confirmation',...data});processor.retrieve.mockImplementation(async()=>({...remote}));processor.confirm.mockImplementation(async()=>remote={...remote,status:'succeeded',latest_charge:`ch_${charge.id}`});await chargeRecurringSource({monthlyBillId:f.bill.id});return{...f,charge};
}
it('rejects null transfer baseline fields with an otherwise legal positive reservation control',async()=>{
 const f=await paidFixture();let controlReached=false;
 await expect(first.$transaction(async tx=>{await tx.recurringCharge.update({where:{id:f.charge.id},data:{transferAttemptedAt:new Date(),transferAmountCents:7201,transferBaseProviderDebitCents:0}});controlReached=true;throw new Error('rollback valid control');})).rejects.toThrow('rollback valid control');expect(controlReached).toBe(true);
 for(const fields of [{transferAmountCents:null,transferBaseProviderDebitCents:0},{transferAmountCents:7201,transferBaseProviderDebitCents:null},{transferAmountCents:null,transferBaseProviderDebitCents:null}])await expect(first.recurringCharge.update({where:{id:f.charge.id},data:{transferAttemptedAt:new Date(),...fields}})).rejects.toThrow('Recurring transfer entitlement mismatch');
});
it('pending refund trigger holds Community while a real HOA payout waits and then rejects the liability',async()=>{
 const f=await paidFixture();const line=await first.recurringChargeLine.findFirstOrThrow({where:{chargeId:f.charge.id}});
 // Ended zero-balance statement is enough to prove lock/hold ordering; this
 // case does not claim successful positive payout accounting.
 const statement=await createHoaShareStatement(f.admin.id,f.community.id,'2025-01');
 let ready!:()=>void,release!:()=>void;const readyPromise=new Promise<void>(r=>ready=r),gate=new Promise<void>(r=>release=r);let holderPid=0;
 const holder=first.$transaction(async tx=>{const pid=await tx.$queryRaw<Array<{pid:number}>>`SELECT pg_backend_pid() AS pid`;holderPid=pid[0].pid;await reserveRecurringRefund(tx,f.admin.id,line.visitId,{id:randomUUID(),amountCents:1,reason:'service_quality'});ready();await gate;},{timeout:20000});
 await readyPromise;
 const applicationName=`issue56-payout-${randomUUID()}`;const url=new URL(process.env.TEST_DATABASE_URL!);url.searchParams.set('application_name',applicationName);
 const payoutDb=new PrismaClient({adapter:new PrismaPg({connectionString:url.toString()})});injection.db=payoutDb;
 const payout=markHoaShareStatementPaid(f.admin.id,f.community.id,statement.id,'synthetic-reference').then(()=>({error:null}),error=>({error}));
 try {
  let observed=false;for(let n=0;n<100;n++){const rows=await first.$queryRaw<Array<{blocked:boolean}>>`SELECT ${holderPid} = ANY(pg_blocking_pids(pid)) AS blocked FROM pg_stat_activity WHERE application_name=${applicationName}`;if(rows.some(r=>r.blocked)){observed=true;break;}await new Promise(r=>setTimeout(r,20));}
  expect(observed).toBe(true);
 }finally{release();await holder;injection.db=first;}
 const outcome=await payout;await payoutDb.$disconnect();expect(outcome.error?.message).toContain('recurring refund is still processing');
 expect(await first.hoaSharePayout.count({where:{statementId:statement.id}})).toBe(0);
});
it('claim linkage rejects another constituent and waits for actual refund reversal before final resolution',async()=>{
 const f=await paidFixture();const lines=await first.recurringChargeLine.findMany({where:{chargeId:f.charge.id},orderBy:{visitId:'asc'}});
 // Synthetic processor transfer is already complete; reserve its exact legal baseline first.
 await first.recurringCharge.update({where:{id:f.charge.id},data:{transferAttemptedAt:new Date(),transferAmountCents:7201,transferBaseProviderDebitCents:0}});
 const transferId=`tr_${f.charge.id}`;await first.recurringCharge.update({where:{id:f.charge.id},data:{stripeTransferId:transferId}});
 const claim=await reportServiceQuality(f.residents[0].user.id,lines[0].visitId,{reason:'incomplete',description:'Synthetic recurring service was incomplete.'});
 const wrong=await requestRecurringRefund(f.admin.id,lines[1].visitId,{id:randomUUID(),amountCents:1,reason:'service_quality'});
 await expect(first.serviceQualityClaim.update({where:{id:claim.id},data:{resolution:'refund_pending',resolutionRequestedAt:new Date(),resolutionRequestedBy:f.admin.id,recurringRefundOperationId:wrong.id}})).rejects.toThrow('Recurring claim refund mismatch');
 // Settle the unrelated operation through the real processor adapter before
 // creating the correct operation; one pending refund per charge is enforced.
 const refundObjects=new Map<string,any>(),reversalObjects=new Map<string,any>();
 processor.chargeRetrieve.mockImplementation(async()=>{const c=await first.recurringCharge.findUniqueOrThrow({where:{id:f.charge.id}});return{id:c.stripeChargeId,livemode:false,paid:true,customer:c.customerId,amount:c.amountCents,currency:c.currency,payment_intent:c.stripePaymentIntentId,amount_refunded:c.refundedCents,disputed:false};});
 processor.refundCreate.mockImplementation(async(data:any)=>{const r={id:`re_${data.metadata.bundleenRecurringRefundId}`,amount:data.amount,currency:'usd',charge:data.charge,payment_intent:`pi_${f.charge.id}`,metadata:data.metadata,status:'succeeded'};refundObjects.set(r.id,r);return r;});
 processor.refundRetrieve.mockImplementation(async(id:string)=>refundObjects.get(id));processor.refundList.mockResolvedValue({data:[],has_more:false});
 processor.transferRetrieve.mockImplementation(async()=>{const c=await first.recurringCharge.findUniqueOrThrow({where:{id:f.charge.id}});return{id:transferId,livemode:false,amount:7201,currency:'usd',destination:c.providerAccountId,source_transaction:c.stripeChargeId,amount_reversed:c.providerReversedCents,metadata:{bundleenRecurringChargeId:c.id}};});
 processor.reversalCreate.mockImplementation(async(_id:string,data:any)=>{const r={id:`trr_${data.metadata.bundleenRecurringRefundId}`,amount:data.amount,currency:'usd',transfer:transferId,metadata:data.metadata};reversalObjects.set(r.id,r);return r;});processor.reversalRetrieve.mockImplementation(async(_id:string,id:string)=>reversalObjects.get(id));processor.reversalList.mockResolvedValue({data:[],has_more:false});
 await processRecurringRefund(wrong.id);
 const correct=await requestRecurringRefund(f.admin.id,lines[0].visitId,{id:randomUUID(),amountCents:lines[0].grossCents,reason:'service_quality'});
 await first.serviceQualityClaim.update({where:{id:claim.id},data:{resolution:'refund_pending',resolutionRequestedAt:new Date(),resolutionRequestedBy:f.admin.id,recurringRefundOperationId:correct.id}});
 processor.reversalCreate.mockRejectedValueOnce(new Error('synthetic reversal unavailable'));
 await expect(processRecurringRefund(correct.id)).rejects.toThrow('synthetic reversal unavailable');
 expect((await first.recurringChargeRefund.findUniqueOrThrow({where:{id:correct.id}})).status).toBe('reversal_pending');
 await expect(first.serviceQualityClaim.update({where:{id:claim.id},data:{resolution:'refund_complete',resolvedAt:new Date()}})).rejects.toThrow('Recurring refund and reversal must finish');
 await processRecurringRefund(correct.id);
 await first.serviceQualityClaim.update({where:{id:claim.id},data:{resolution:'refund_complete',resolvedAt:new Date()}});
 expect((await first.serviceQualityClaim.findUniqueOrThrow({where:{id:claim.id}})).resolution).toBe('refund_complete');
 expect((await first.recurringChargeLine.findUniqueOrThrow({where:{id:lines[0].id}})).refundedCents).toBe(lines[0].grossCents);
});
it('reservation waits on source Visit before Agreement, allowing completion lock order without deadlock',async()=>{
 const f=await financialFixture();const line=await first.recurringBillLine.findFirstOrThrow({where:{billId:f.bill.id,amountCents:{gt:0}},orderBy:{visitId:'asc'}});
 let ready!:()=>void,release!:()=>void;const readyPromise=new Promise<void>(r=>ready=r),gate=new Promise<void>(r=>release=r);let holderPid=0;
 const holder=first.$transaction(async tx=>{const pid=await tx.$queryRaw<Array<{pid:number}>>`SELECT pg_backend_pid() AS pid`;holderPid=pid[0].pid;await tx.$queryRaw`SELECT id FROM "ServiceVisit" WHERE id=${line.visitId} FOR UPDATE`;ready();await gate;await tx.$queryRaw`SELECT id FROM "ServiceAgreement" WHERE id=${f.agreementId} FOR UPDATE`;},{timeout:15000});
 await readyPromise;
 const applicationName=`issue56-reservation-${randomUUID()}`,url=new URL(process.env.TEST_DATABASE_URL!);url.searchParams.set('application_name',applicationName);const reservationDb=new PrismaClient({adapter:new PrismaPg({connectionString:url.toString()})});injection.db=reservationDb;
 const reservation=prepareRecurringCharge({monthlyBillId:f.bill.id}).then(value=>({value,error:null}),error=>({value:null,error}));
 try{let observed=false;for(let n=0;n<100;n++){const rows=await first.$queryRaw<Array<{blocked:boolean}>>`SELECT ${holderPid} = ANY(pg_blocking_pids(pid)) AS blocked FROM pg_stat_activity WHERE application_name=${applicationName}`;if(rows.some(r=>r.blocked)){observed=true;break;}await new Promise(r=>setTimeout(r,20));}expect(observed).toBe(true);}
 finally{release();await holder;injection.db=first;}
 const result=await reservation;await reservationDb.$disconnect();expect(result.error).toBeNull();expect(result.value?.amountCents).toBe(8001);
});
import { reconcileRecurringFinancialEvent } from '@/lib/server/recurring-financial-events';
it('duplicate processor observations remain immutable and unknown refunds hold without line attribution',async()=>{
 const f=await paidFixture();let observedRefund=1;
 processor.chargeRetrieve.mockImplementation(async()=>{const c=await first.recurringCharge.findUniqueOrThrow({where:{id:f.charge.id}});return{id:c.stripeChargeId,livemode:false,paid:true,amount:c.amountCents,currency:c.currency,customer:c.customerId,payment_intent:c.stripePaymentIntentId,amount_refunded:observedRefund,disputed:false};});
 const event=await first.stripeTestEvent.create({data:{id:`evt_${randomUUID()}`,eventType:'charge.refunded',objectId:`ch_${f.charge.id}`,occurredAt:new Date()}});
 await Promise.all([reconcileRecurringFinancialEvent(event.id),reconcileRecurringFinancialEvent(event.id)]);
 const observations=await first.recurringFinancialObservation.findMany({where:{eventId:event.id}});expect(observations).toHaveLength(1);expect(observations[0]).toMatchObject({refundedCents:1,holdReason:'unknown_refund'});
 expect((await first.recurringChargeLine.aggregate({where:{chargeId:f.charge.id},_sum:{refundedCents:true}}))._sum.refundedCents).toBe(0);
 await expect(first.recurringFinancialObservation.update({where:{id:observations[0].id},data:{refundedCents:0}})).rejects.toThrow('immutable');
 observedRefund=0;const next=await first.stripeTestEvent.create({data:{id:`evt_${randomUUID()}`,eventType:'charge.refunded',objectId:`ch_${f.charge.id}`,occurredAt:new Date()}});await reconcileRecurringFinancialEvent(next.id);
 expect((await first.recurringCharge.findUniqueOrThrow({where:{id:f.charge.id}})).reconciliationHoldReason).toBe('unknown_refund');
 const guardEvent=await first.stripeTestEvent.create({data:{id:`evt_${randomUUID()}`,eventType:'charge.refunded',objectId:`ch_${f.charge.id}`,occurredAt:new Date()}});
 const valid={eventId:guardEvent.id,chargeId:f.charge.id,eventType:'charge.refunded',objectId:`ch_${f.charge.id}`,processorChargeId:`ch_${f.charge.id}`,processorTransferId:null,refundedCents:0,reversedCents:0,disputed:false,disputeId:null,disputeStatus:null,holdReason:'unknown_refund'};
 let positive=false;await expect(first.$transaction(async tx=>{await tx.recurringFinancialObservation.create({data:valid});positive=true;throw new Error('rollback valid observation');})).rejects.toThrow('rollback valid observation');expect(positive).toBe(true);
 for(const [change,message] of [[{processorTransferId:'tr_foreign'},'financial identity mismatch'],[{disputed:true},'financial identity mismatch'],[{refundedCents:1},'scope mismatch'],[{disputeId:'dp_foreign',disputeStatus:'lost'},'Unexpected recurring dispute']] as const)await expect(first.recurringFinancialObservation.create({data:{...valid,...change}})).rejects.toThrow(message);

});
it('foreign transfer ownership cannot bind a provider transfer and leaves a review hold',async()=>{
 const f=await paidFixture();const c=await first.recurringCharge.findUniqueOrThrow({where:{id:f.charge.id}});
 processor.chargeRetrieve.mockResolvedValue({id:c.stripeChargeId,livemode:false,paid:true,amount:c.amountCents,currency:c.currency,customer:c.customerId,payment_intent:c.stripePaymentIntentId,amount_refunded:0,disputed:false});
 processor.transferRetrieve.mockResolvedValue({id:'tr_foreign',livemode:false,amount:7201,currency:'usd',destination:'acct_foreign',source_transaction:c.stripeChargeId,transfer_group:`recurring_${c.id}`,metadata:{bundleenRecurringChargeId:c.id},amount_reversed:0});
 const event=await first.stripeTestEvent.create({data:{id:`evt_${randomUUID()}`,eventType:'transfer.created',objectId:'tr_foreign',occurredAt:new Date()}});
 await reconcileRecurringFinancialEvent(event.id);
 expect(await first.recurringCharge.findUniqueOrThrow({where:{id:c.id}})).toMatchObject({stripeTransferId:null,reconciliationHoldReason:'unknown_transfer'});
});
