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
import { createHoaRequest, submitBid, awardBid, saveDayPlan, updateVisitStatus } from "@/lib/server/hoa-market";
import { hoaRequestCreateSchema, bidSubmitSchema } from "@/lib/validation/hoa";
import { storeProviderCredential } from "@/lib/server/provider-credentials";
import { updateProviderAdministration } from "@/lib/server/providers-admin";
import { reportServiceQuality, requestQualityResolution, respondToQualityClaim } from "@/lib/server/service-quality";
let first: PrismaClient;
async function run<T>(_db: PrismaClient, work: () => Promise<T>) { return work(); }
beforeAll(() => { first = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.TEST_DATABASE_URL! }) }); injection.db = first; });
afterAll(async () => first?.$disconnect());
async function seed(category = "pool_care", options: { notifyEmail?: boolean; totalOccurrences?: number } = {}) {
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
    title: tag, category, description: "Owned service quality test", kind: "compulsory_recurring", publish: true,
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

describe("service quality transactions on migrated PostgreSQL", () => {
  it("serializes duplicate claims and atomically records ticket and notifications", async () => {
    const f = await seed("landscaping");
    await updateVisitStatus(f.provider.id, f.ownVisit.id, { status: "completed", completionNote: null });
    const input = { reason: "incomplete" as const, description: "The agreed service was incomplete." };
    const [one,two] = await Promise.all([reportServiceQuality(f.residents[0].user.id,f.ownVisit.id,input),reportServiceQuality(f.residents[0].user.id,f.ownVisit.id,input)]);
    expect(one.id).toBe(two.id);
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
