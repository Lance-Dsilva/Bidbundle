import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import Stripe from "stripe";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { beforeAll, afterAll, it, expect, vi } from "vitest";
const injection = vi.hoisted(() => ({ db: null as PrismaClient | null }));
vi.mock("@/lib/server/db", () => ({ db: new Proxy({}, { get(_target,key) { const db=injection.db!;const v=Reflect.get(db,key);return typeof v==="function"?v.bind(db):v; } }) }));
vi.mock("@vercel/blob", () => ({ put:vi.fn(async()=>({})),del:vi.fn(),get:vi.fn() }));
vi.mock("@/lib/server/notifications", async original=>({...await original<object>(),scheduleOutboxDrain:vi.fn()}));
import { createHoaRequest, respondToOptionalRequest, transitionHoaRequest, submitBid, awardBid, saveDayPlan, updateVisitStatus } from "@/lib/server/hoa-market";
import { hoaRequestCreateSchema, bidSubmitSchema } from "@/lib/validation/hoa";
import { storeProviderCredential } from "@/lib/server/provider-credentials";
import { updateProviderAdministration } from "@/lib/server/providers-admin";
import { startStripeTestOnboarding,refreshStripeTestPayouts,requireStripeTestAwardPayouts } from "@/lib/server/stripe-test-connect";
import { getVisitBillingOffer,acceptVisitBillingOffer } from "@/lib/server/visit-billing-consent";
import { startStripeTestCardSetup,verifyStripeTestCardSetup } from "@/lib/server/stripe-test-card";
import { chargeStripeTestVisit } from "@/lib/server/stripe-test-payments";
import { getResidentTestReceipt } from "@/lib/server/stripe-test-payment-history";
import { transferStripeTestPayment } from "@/lib/server/stripe-test-transfers";
import { requestStripeTestRefund,processStripeTestRefund } from "@/lib/server/stripe-test-refunds";
const artifactPath="/private/tmp/bundleen-stripe-live-evidence.json";
let first:PrismaClient; let stripe:Stripe;
const evidence:Record<string,any>=existsSync(artifactPath)?JSON.parse(readFileSync(artifactPath,"utf8")):{};
function save(){writeFileSync(artifactPath,JSON.stringify(evidence,null,2),{mode:0o600});}
async function run<T>(_db:PrismaClient,work:()=>Promise<T>){return work();}
beforeAll(async()=>{
 first=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.TEST_DATABASE_URL!})});injection.db=first;
 const [{name}]=await first.$queryRaw<Array<{name:string}>>`SELECT current_database() AS name`;expect(name).toBe("bundleen_issue43_test_live");
 stripe=new Stripe(process.env.STRIPE_SECRET_KEY!,{timeout:10000,maxNetworkRetries:0});
 try { const balance=await stripe.balance.retrieve();expect(balance.livemode).toBe(false);evidence.sandboxConfirmed=true;save(); } catch { throw new Error("Sandbox account preflight unavailable; no processor details logged"); }
});
afterAll(async()=>{await first?.$disconnect();});
async function seed(category = "pool_care", options: { notifyEmail?: boolean; totalOccurrences?: number; paid?: boolean } = {}) {
  const tag = `stripe-live43-${randomUUID()}`;
  const admin = await first.user.create({ data: { clerkUserId: `${tag}-admin`, email: `${tag}-admin@example.com`,
    fullName: "Isolated admin", role: "admin", isVerified: true,
    adminAccess: { create: { email: `${tag}-admin@example.com`, status: "active", level: "admin" } } } });
  const manager = await first.user.create({ data: { clerkUserId: `${tag}-manager`, email: `${tag}-manager@example.com`, fullName: "Isolated manager", role: "hoa_staff" } });
  const community = await first.community.create({ data: { name: tag, type: "hoa", hoaProfile: { create: {
    legalName: tag, addressLine1: "1 Fixture St", locality: "Austin", region: "TX", postalCode: "78758", totalHomes: 2,
    latitude: 30.4, longitude: -97.7, addressVerificationStatus: "verified",
  } } } });
  await first.communityStaffAssignment.create({ data: { communityId: community.id, userId: manager.id, role: "hoa_manager", status: "active" } });
  const residents: Array<{ user: { id: string; email: string }; unit: { id: string } }> = [];
  for (let index = 0; index < 2; index++) {
    const user = await first.user.create({ data: { clerkUserId: `${tag}-resident-${index}`, email: `${tag}-resident-${index}@example.com`,
      fullName: `Owned resident ${index}`, role: "homeowner", isVerified: true,
      homeownerProfile: { create: { notifyEmail: options.notifyEmail ?? false } } } });
    const unit = await first.communityUnit.create({ data: { communityId: community.id, label: `Fixture unit ${index}` } });
    await first.communityMembership.create({ data: { communityId: community.id, userId: user.id, unitId: unit.id, status: "active" } });
    residents.push({ user, unit });
  }
  const provider = await first.user.create({ data: { clerkUserId: `${tag}-provider`, email: `${tag}-provider@example.com`,
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

it("verifies actual sandbox card setup through domain methods without a charge",async context=>{
 // A local artifact is historical evidence, not a fresh account/DB ownership assertion.
 if(evidence.cardVerified) context.skip();
 try {
  if(!evidence.fixture){process.env.STRIPE_TEST_PAYMENTS="0";evidence.fixture=await seed("landscaping",{paid:true});save();}
  const f=evidence.fixture;
  process.env.STRIPE_TEST_CARD_SETUP="1";process.env.STRIPE_TEST_CONNECT="1";process.env.STRIPE_TEST_PAYMENTS="1";
  if(!evidence.cardVerified){
   const offer=await getVisitBillingOffer(f.residents[0].user.id,f.agreementId);await acceptVisitBillingOffer(f.residents[0].user.id,f.agreementId,offer.termsToken);
   const setup=await startStripeTestCardSetup(f.residents[0].user.id,f.agreementId,randomUUID());
   const setupId=setup.clientSecret.split("_secret_")[0];
   const confirmed=await stripe.setupIntents.confirm(setupId,{payment_method:"pm_card_visa"});expect(confirmed.livemode).toBe(false);expect(confirmed.status).toBe("succeeded");
   const verified=await verifyStripeTestCardSetup(f.residents[0].user.id,f.agreementId,setupId);expect(verified.last4).toBe("4242");
   const payer=await first.user.findUniqueOrThrow({where:{id:f.residents[0].user.id}});
   const beforeCompletion=await stripe.paymentIntents.list({customer:payer.stripeTestCustomerId!,limit:10});expect(beforeCompletion.data).toHaveLength(0);
   evidence.noChargeAtCardSetup=true;evidence.setupIntentId=setupId;evidence.cardVerified=true;save();
  }

 }catch(error:any){evidence.failure={stage:"setup",type:error.type??error.name,code:error.code??null,status:error.statusCode??error.status??null,param:error.param??null,message:String(error.message??"").replace(/(?:sk|rk|pk)_(?:test|live)_[A-Za-z0-9]+/g,"[credential]").replace(/[A-Za-z0-9_]+_secret_[A-Za-z0-9]+/g,"[client-secret]").slice(0,500)};save();throw new Error(`Sandbox setup failed (${evidence.failure.type}; ${evidence.failure.code??"no_code"})`);}
});
it("creates and verifies actual Express onboarding when account policy permits",async context=>{
 if(evidence.onboardingCreated) context.skip();
 if(evidence.failure?.message?.includes("Accounts v1") && process.env.STRIPE_CONNECT_POLICY_RECHECK!=="1") context.skip();
 process.env.STRIPE_TEST_CONNECT="1";
 try { const f=evidence.fixture;
  if(!evidence.onboardingCreated){const result=await startStripeTestOnboarding(f.provider.id);evidence.onboardingUrl=result.url;evidence.onboardingCreated=true;save();}
  const profile=await first.providerProfile.findUniqueOrThrow({where:{userId:f.provider.id}});evidence.accountId=profile.stripeTestAccountId;
  const account=await stripe.accounts.retrieve(profile.stripeTestAccountId!);evidence.connect={chargesEnabled:account.charges_enabled,payoutsEnabled:account.payouts_enabled,transfers:account.capabilities?.transfers,requirements:account.requirements?.currently_due};save();
  const status=await refreshStripeTestPayouts(f.provider.id);evidence.payoutStatus=status.status;save();
  if(status.status!=="active")await expect(requireStripeTestAwardPayouts(f.provider.id)).rejects.toMatchObject({status:409});
  evidence.providerOnboardingPending=status.status!=="active";delete evidence.failure;save();
 }catch(error:any){evidence.failure={stage:"onboarding",type:error.type??error.name,status:error.statusCode??null,message:String(error.message??"").replace(/(?:sk|rk|pk)_(?:test|live)_[A-Za-z0-9]+/g,"[credential]").slice(0,500)};save();throw new Error("Sandbox Connect onboarding blocked; see sanitized local evidence");}
});
it("charges and transfers exactly once then refunds through domain methods when provider onboarding is ready",async context=>{
 // Resuming partially completed financial evidence requires a separately reviewed
 // ownership/remote-state reconciliation, never a pass based on saved flags.
 if(evidence.charged||evidence.transferred||evidence.refunded||evidence.fullRefunded)context.skip();
 if(!evidence.cardVerified||evidence.payoutStatus!=="active")context.skip();
 try{
  const f=evidence.fixture;process.env.STRIPE_TEST_PAYMENTS="1";process.env.STRIPE_TEST_TRANSFERS="1";process.env.STRIPE_TEST_REFUNDS="1";
  await first.adminAccessGrant.update({where:{userId:f.admin.id},data:{level:"owner"}});
  const visit=await first.serviceVisit.findUniqueOrThrow({where:{id:f.ownVisit.id}});
  if(visit.status!=="completed")await updateVisitStatus(f.provider.id,visit.id,{status:"completed",completionNote:null});
  if(!evidence.charged){await chargeStripeTestVisit(visit.id);const payment=await first.stripeTestPayment.findUniqueOrThrow({where:{visitId:visit.id}});expect(payment.status).toBe("succeeded");expect(payment.amountCents).toBe(1000);evidence.paymentIntentId=payment.stripePaymentIntentId;await chargeStripeTestVisit(visit.id);expect((await first.stripeTestPayment.findUniqueOrThrow({where:{visitId:visit.id}})).stripePaymentIntentId).toBe(evidence.paymentIntentId);const intent=await stripe.paymentIntents.retrieve(payment.stripePaymentIntentId!);expect(intent.livemode).toBe(false);expect(intent.receipt_email).toBe(f.residents[0].user.email.toLowerCase());
   const receipt=await getResidentTestReceipt(f.residents[0].user.id,visit.id);expect(new URL(receipt).hostname).toBe("pay.stripe.com");evidence.hostedReceiptVerified=true;evidence.charged=true;save();}
  if(!evidence.transferred){await transferStripeTestPayment(visit.id);const payment=await first.stripeTestPayment.findUniqueOrThrow({where:{visitId:visit.id}});const transfer=await stripe.transfers.retrieve(payment.stripeTransferId!);expect(transfer.livemode).toBe(false);expect(transfer.amount).toBe(900);expect(transfer.source_transaction).toBe(payment.stripeChargeId);await transferStripeTestPayment(visit.id);expect((await first.stripeTestPayment.findUniqueOrThrow({where:{visitId:visit.id}})).stripeTransferId).toBe(transfer.id);evidence.transferId=transfer.id;evidence.transferred=true;save();}
  if(!evidence.refunded){const op=await requestStripeTestRefund(f.admin.id,visit.id,{id:randomUUID(),amountCents:400,reason:"requested_by_customer"});await processStripeTestRefund(op.id);const refund=await first.stripeTestRefund.findUniqueOrThrow({where:{id:op.id}});expect(refund.state).toBe("succeeded");expect(refund.reversalCents).toBe(360);await processStripeTestRefund(op.id);evidence.refundOperationId=op.id;evidence.refunded=true;save();}
  if(!evidence.fullRefunded){const op=await requestStripeTestRefund(f.admin.id,visit.id,{id:randomUUID(),amountCents:600,reason:"requested_by_customer"});await processStripeTestRefund(op.id);const payment=await first.stripeTestPayment.findUniqueOrThrow({where:{visitId:visit.id}});expect(payment).toMatchObject({amountRefundedCents:1000,providerReversedCents:900,status:"refunded"});evidence.fullRefundOperationId=op.id;evidence.fullRefunded=true;save();}
 }catch(error:any){evidence.failure={stage:"money",type:error.type??error.name,code:error.code??null,status:error.statusCode??error.status??null,param:error.param??null,message:String(error.message??"").replace(/(?:sk|rk|pk)_(?:test|live)_[A-Za-z0-9]+/g,"[credential]").replace(/[A-Za-z0-9_]+_secret_[A-Za-z0-9]+/g,"[client-secret]").slice(0,500)};save();throw new Error(`Sandbox money verification failed (${evidence.failure.type}; ${evidence.failure.code??"no_code"})`);}
});
