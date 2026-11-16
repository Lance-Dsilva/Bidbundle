import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { afterAll, describe, expect, it, vi } from "vitest";
vi.mock("@vercel/blob",()=>({put:vi.fn(async()=>({})),del:vi.fn(async()=>undefined),get:vi.fn()}));
vi.mock("next/server",async(importActual)=>({...await importActual<typeof import("next/server")>(),after:vi.fn()}));
process.env.PROVIDER_DOCUMENT_BLOB_READ_WRITE_TOKEN="local-test-transport-stub-only";
import { storeProviderCredential } from "@/lib/server/provider-credentials";
import { updateProviderAdministration } from "@/lib/server/providers-admin";
import { awardBid } from "@/lib/server/hoa-market";
const db=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.TEST_DATABASE_URL!})});
(globalThis as unknown as {prisma:PrismaClient}).prisma=db;
import { respondToNeighborhoodRequest } from "@/lib/server/neighborhood-market";
import { commitPriceLadder, acceptPriceLadder, notifyPriceLadderUnlock } from "@/lib/server/price-ladder";
afterAll(()=>db.$disconnect());
async function seed(){
 const tag=randomUUID();
 const admin=await db.user.create({data:{clerkUserId:`a-${tag}`,email:`a-${tag}@example.invalid`,fullName:"Test owner",role:"admin",isVerified:true,adminAccess:{create:{email:`a-${tag}@example.invalid`,level:"owner",status:"active"}}}});
 const provider=await db.user.create({data:{clerkUserId:`p-${tag}`,email:`p-${tag}@example.invalid`,fullName:"Test provider",role:"provider",providerProfile:{create:{accountStatus:"active",trades:["cleaning"]}}}});
 const community=await db.community.create({data:{name:tag,type:"hoa",status:"active",hoaProfile:{create:{legalName:"Test HOA",addressLine1:"1 Test",locality:"Austin",region:"TX",postalCode:"78758",totalHomes:5}}}});
 const manager=await db.user.create({data:{clerkUserId:`m-${tag}`,email:`m-${tag}@example.invalid`,fullName:"Test manager",role:"hoa_staff"}});
 await db.communityStaffAssignment.create({data:{communityId:community.id,userId:manager.id,role:"hoa_manager",status:"active"}});
 const request=await db.hoaServiceRequest.create({data:{communityId:community.id,createdByUserId:manager.id,title:"Ladder",category:"cleaning",description:"Test",kind:"optional_group",status:"collecting_interest",enrollmentClosesAt:new Date(Date.now()+3600000),totalOccurrences:2}});
 const commitment=await commitPriceLadder(admin.id,community.id,{requestId:request.id,providerUserId:provider.id,scope:"Two cleaning visits",providerAgreementConfirmed:true,tiers:[{minHomes:1,perHomeCents:12000},{minHomes:2,perHomeCents:10000}]});
 const homes=[];
 for(let i=0;i<2;i++){
  const user=await db.user.create({data:{clerkUserId:`h${i}-${tag}`,email:`h${i}-${tag}@example.invalid`,fullName:"Test home",role:"homeowner",homeownerProfile:{create:{notifyEmail:false}}}});
  const unit=await db.communityUnit.create({data:{communityId:community.id,label:`Home ${i}`,occupancyStatus:"occupied"}});
  await db.communityMembership.create({data:{communityId:community.id,userId:user.id,unitId:unit.id,status:"active"}});homes.push({user,unit});
 }
 return{admin,provider,community,request,commitment,homes,manager};
}
async function join(f:Awaited<ReturnType<typeof seed>>,index:number){return db.$transaction(async(tx)=>{await tx.$queryRaw`SELECT "id" FROM "HoaServiceRequest" WHERE "id"=${f.request.id} FOR UPDATE`;const before=await tx.priceLadderCommitment.findUniqueOrThrow({where:{id:f.commitment.id}});const result=await tx.hoaRequestParticipation.create({data:{requestId:f.request.id,userId:f.homes[index].user.id,unitId:f.homes[index].unit.id,response:"joined"}});await notifyPriceLadderUnlock(tx,f.request.id,before.guaranteedPerHomeCents);return result;});}
describe("real price commitment persistence",()=>{
 it("serializes concurrent enrollments and records one unlock per recipient",async()=>{const f=await seed();await acceptPriceLadder(f.provider.id,f.commitment.id);const results=await Promise.all([join(f,0),join(f,1)]);expect(results.map(r=>r.maximumPriceCents).sort()).toEqual([10000,12000]);expect(await db.notification.count({where:{dedupeKey:{startsWith:`price-ladder:${f.commitment.id}:`}}})).toBe(2);});
 it("awards the exact protected full-term amount through the real credential and award guards",async()=>{
  const f=await seed();
  await db.providerProfile.update({where:{userId:f.provider.id},data:{licenseNumber:"fixture-license",licenseState:"TX",insuranceProvider:"fixture-insurer",insurancePolicyNumber:"fixture-policy"}});
  for(const kind of ["license","insurance"] as const){
   await storeProviderCredential(f.provider.id,kind,new Blob([`%PDF-1.7\n${kind}\n%%EOF`],{type:"application/pdf"}));
   const p=await db.providerProfile.findUniqueOrThrow({where:{userId:f.provider.id},include:{licenseDocument:true,insuranceDocument:true}});
   const document=kind==="license"?p.licenseDocument!:p.insuranceDocument!;
   await updateProviderAdministration(f.admin,f.provider.id,{[kind]:"verify",expectedUpdatedAt:p.updatedAt.toISOString(),[`${kind}DocumentId`]:document.id,[`${kind}DocumentChecksum`]:document.checksum,[`${kind}ExpiresOn`]:"2099-12-31",...(kind==="insurance"?{insuranceCoverageCents:100000000,insuranceAdditionalInsured:true}:{})});
  }
  await acceptPriceLadder(f.provider.id,f.commitment.id);await join(f,0);await join(f,1);
  await db.hoaServiceRequest.update({where:{id:f.request.id},data:{status:"open_for_bids",participantsLockedAt:new Date(),biddingClosesAt:new Date(Date.now()+3600000)}});
  const id=await awardBid(f.manager.id,f.request.id,{bidId:`ladder:${f.commitment.id}`,expectedBidVersion:1});
  const agreement=await db.serviceAgreement.findUniqueOrThrow({where:{id}});expect(agreement).toMatchObject({amountCents:20000,perHomeCents:10000,lockedHomeCount:2,pricingBasis:"per_home"});
  expect(await db.serviceOccurrence.count({where:{agreementId:id}})).toBe(2);
 });
 it("holds neighborhood enrollment until provider acceptance, including the creator",async()=>{
  const f=await seed();const tag=randomUUID();
  const owner=await db.user.create({data:{clerkUserId:`n-${tag}`,email:`n-${tag}@example.invalid`,fullName:"Neighbor",role:"homeowner",address:"1 Test St, Austin, TX",latitude:30.4,longitude:-97.7}});
  const community=await db.community.create({data:{name:tag,type:"neighborhood",status:"active",centerLatitude:30.4,centerLongitude:-97.7,radiusMiles:10}});
  await db.communityMembership.create({data:{communityId:community.id,userId:owner.id,status:"active"}});
  const request=await db.hoaServiceRequest.create({data:{communityId:community.id,createdByUserId:owner.id,title:"Protected neighborhood job",category:"cleaning",description:"One cleaning",kind:"optional_group",status:"collecting_interest",requiresPriceCommitment:true,enrollmentClosesAt:new Date(Date.now()+3600000)}});
  await expect(respondToNeighborhoodRequest(owner.id,request.id,"joined")).rejects.toThrow("Enrollment opens");
  const c=await commitPriceLadder(f.admin.id,community.id,{requestId:request.id,providerUserId:f.provider.id,scope:"One cleaning",providerAgreementConfirmed:true,tiers:[{minHomes:1,perHomeCents:10000}]});
  await acceptPriceLadder(f.provider.id,c.id);
  expect(await respondToNeighborhoodRequest(owner.id,request.id,"joined")).toEqual({response:"joined",joinedCount:1});
  expect((await db.hoaRequestParticipation.findFirstOrThrow({where:{requestId:request.id}})).maximumPriceCents).toBe(10000);
 });
 it("lets the named provider author final tiers before accepting and freezes them afterward",async()=>{const f=await seed();const tiers=[{minHomes:1,perHomeCents:15000},{minHomes:2,perHomeCents:11000}];const accepted=await acceptPriceLadder(f.provider.id,f.commitment.id,tiers);expect(accepted.tiers).toEqual(tiers);expect((await join(f,0)).maximumPriceCents).toBe(15000);await expect(acceptPriceLadder(f.provider.id,f.commitment.id,[{minHomes:1,perHomeCents:20000}])).rejects.toThrow("Accepted provider prices cannot change");});
 it("freezes quoted scope and service frequency and idempotently records provider acceptance",async()=>{const f=await seed();const a=await acceptPriceLadder(f.provider.id,f.commitment.id);const b=await acceptPriceLadder(f.provider.id,f.commitment.id);expect(b).toEqual(a);await expect(db.hoaServiceRequest.update({where:{id:f.request.id},data:{totalOccurrences:3}})).rejects.toThrow();await expect(db.serviceBidPriceTier.create({data:{id:randomUUID(),commitmentId:f.commitment.id,minHomes:3,perHomeCents:9000}})).rejects.toThrow();await expect(db.priceLadderCommitment.update({where:{id:f.commitment.id},data:{guaranteedPerHomeCents:13000}})).rejects.toThrow();});
 it("blocks enrollment until the exact provider accepts, then caps and ratchets prices",async()=>{const f=await seed();await expect(join(f,0)).rejects.toThrow();await expect(acceptPriceLadder(f.homes[0].user.id,f.commitment.id)).rejects.toThrow();await acceptPriceLadder(f.provider.id,f.commitment.id);const first=await join(f,0);const second=await join(f,1);expect(first.maximumPriceCents).toBe(12000);expect(second.maximumPriceCents).toBe(10000);await db.hoaRequestParticipation.update({where:{id:second.id},data:{response:"declined"}});expect((await db.priceLadderCommitment.findUniqueOrThrow({where:{id:f.commitment.id}})).guaranteedPerHomeCents).toBe(10000);expect(await db.notification.count({where:{dedupeKey:{startsWith:`price-ladder:${f.commitment.id}:`}}})).toBe(2);await db.$transaction(tx=>notifyPriceLadderUnlock(tx,f.request.id,12000));expect(await db.notification.count({where:{dedupeKey:{startsWith:`price-ladder:${f.commitment.id}:`}}})).toBe(2);});
 it("materializes the full-term total once on lock and prevents changes to accepted commitment",async()=>{const f=await seed();await acceptPriceLadder(f.provider.id,f.commitment.id);await join(f,0);await join(f,1);await expect(db.priceLadderCommitment.update({where:{id:f.commitment.id},data:{scope:"Changed"}})).rejects.toThrow();await db.hoaServiceRequest.update({where:{id:f.request.id},data:{status:"open_for_bids",participantsLockedAt:new Date(),biddingClosesAt:new Date(Date.now()+3600000)}});const bid=await db.serviceBid.findUniqueOrThrow({where:{id:`ladder:${f.commitment.id}`},include:{priceTiers:true}});expect(bid.amountCents).toBe(20000);expect(bid.perHomeCents).toBe(10000);expect(bid.priceTiers).toHaveLength(2);await expect(db.serviceBid.update({where:{id:bid.id},data:{status:"withdrawn"}})).rejects.toThrow();});
});
