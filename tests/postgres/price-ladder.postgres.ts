import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { afterAll, describe, expect, it } from "vitest";
const db=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.TEST_DATABASE_URL!})});
(globalThis as unknown as {prisma:PrismaClient}).prisma=db;
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
 it("freezes quoted scope and service frequency and idempotently records provider acceptance",async()=>{const f=await seed();const a=await acceptPriceLadder(f.provider.id,f.commitment.id);const b=await acceptPriceLadder(f.provider.id,f.commitment.id);expect(b).toEqual(a);await expect(db.hoaServiceRequest.update({where:{id:f.request.id},data:{totalOccurrences:3}})).rejects.toThrow();await expect(db.serviceBidPriceTier.create({data:{id:randomUUID(),commitmentId:f.commitment.id,minHomes:3,perHomeCents:9000}})).rejects.toThrow();await expect(db.priceLadderCommitment.update({where:{id:f.commitment.id},data:{guaranteedPerHomeCents:13000}})).rejects.toThrow();});
 it("blocks enrollment until the exact provider accepts, then caps and ratchets prices",async()=>{const f=await seed();await expect(join(f,0)).rejects.toThrow();await expect(acceptPriceLadder(f.homes[0].user.id,f.commitment.id)).rejects.toThrow();await acceptPriceLadder(f.provider.id,f.commitment.id);const first=await join(f,0);const second=await join(f,1);expect(first.maximumPriceCents).toBe(12000);expect(second.maximumPriceCents).toBe(10000);await db.hoaRequestParticipation.update({where:{id:second.id},data:{response:"declined"}});expect((await db.priceLadderCommitment.findUniqueOrThrow({where:{id:f.commitment.id}})).guaranteedPerHomeCents).toBe(10000);expect(await db.notification.count({where:{dedupeKey:{startsWith:`price-ladder:${f.commitment.id}:`}}})).toBe(2);await db.$transaction(tx=>notifyPriceLadderUnlock(tx,f.request.id,12000));expect(await db.notification.count({where:{dedupeKey:{startsWith:`price-ladder:${f.commitment.id}:`}}})).toBe(2);});
 it("materializes the full-term total once on lock and prevents changes to accepted commitment",async()=>{const f=await seed();await acceptPriceLadder(f.provider.id,f.commitment.id);await join(f,0);await join(f,1);await expect(db.priceLadderCommitment.update({where:{id:f.commitment.id},data:{scope:"Changed"}})).rejects.toThrow();await db.hoaServiceRequest.update({where:{id:f.request.id},data:{status:"open_for_bids",participantsLockedAt:new Date(),biddingClosesAt:new Date(Date.now()+3600000)}});const bid=await db.serviceBid.findUniqueOrThrow({where:{id:`ladder:${f.commitment.id}`},include:{priceTiers:true}});expect(bid.amountCents).toBe(20000);expect(bid.perHomeCents).toBe(10000);expect(bid.priceTiers).toHaveLength(2);await expect(db.serviceBid.update({where:{id:bid.id},data:{status:"withdrawn"}})).rejects.toThrow();});
});
