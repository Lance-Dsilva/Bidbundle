import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, expect, it, vi } from "vitest";
import { db } from "@/lib/server/db";
import { setRequestSharing, getPublicRequest, getPublicCommunity, resolveSharedEnrollment } from "@/lib/server/public-request-sharing";
const url = new URL(process.env.DATABASE_URL ?? "https://disabled.invalid");
if(url.hostname!=="127.0.0.1"||url.port!=="53957"||url.pathname!=="/bundleen_sharing_test") throw new Error("Dedicated sharing test database required.");
beforeAll(()=>{vi.stubEnv("PUBLIC_REQUEST_SHARING","1");});
afterAll(async()=>{await db.$disconnect();vi.unstubAllEnvs();});
async function seed(){
 const tag=randomUUID();
 const community=await db.community.create({data:{name:`Synthetic ${tag}`,type:"hoa",status:"active",hoaProfile:{create:{legalName:"Test HOA",addressLine1:"1 Test",locality:"Austin",region:"TX",postalCode:"78758",totalHomes:5}}}});
 const manager=await db.user.create({data:{clerkUserId:`share-manager-${tag}`,email:`m-${tag}@example.invalid`,fullName:"Test manager",role:"hoa_staff"}});
 await db.communityStaffAssignment.create({data:{communityId:community.id,userId:manager.id,role:"hoa_manager",status:"active"}});
 const request=await db.hoaServiceRequest.create({data:{communityId:community.id,createdByUserId:manager.id,title:"PRIVATE ADDRESS",description:"PRIVATE RESIDENT",category:"cleaning",kind:"optional_group",status:"collecting_interest",enrollmentClosesAt:new Date(Date.now()+3600000)}});
 return{community,manager,request};
}
function tokens(path:string){const[, ,ct,,rt]=path.split("/");return [ct,rt] as const;}
it("creates one capability under concurrent retries and never publishes private request content",async()=>{
 const f=await seed();const results=await Promise.all(Array.from({length:4},()=>setRequestSharing(f.manager.id,f.request.id,"enable")));
 expect(new Set(results.map(r=>r.path)).size).toBe(1);
 const [ct,rt]=tokens(results[0].path!);const visible=await getPublicRequest(ct,rt);expect(visible?.service).toBe("Cleaning");expect(JSON.stringify(visible)).not.toContain("PRIVATE");
 expect((await getPublicCommunity(ct))?.requests).toHaveLength(1);
});
it("rotates and revokes actual public reads",async()=>{
 const f=await seed();const first=await setRequestSharing(f.manager.id,f.request.id,"enable");const [ct,old]=tokens(first.path!);
 const next=await setRequestSharing(f.manager.id,f.request.id,"rotate");expect(await getPublicRequest(ct,old)).toBeNull();const[,rt]=tokens(next.path!);expect(await getPublicRequest(ct,rt)).not.toBeNull();
 await setRequestSharing(f.manager.id,f.request.id,"disable");expect(await getPublicRequest(ct,rt)).toBeNull();expect((await getPublicCommunity(ct))?.requests).toEqual([]);
});
it("requires current scoped manager authority and matched active roster for enrollment handoff",async()=>{
 const f=await seed();const share=await setRequestSharing(f.manager.id,f.request.id,"enable");const[ct,rt]=tokens(share.path!);
 const tag=randomUUID();const resident=await db.user.create({data:{clerkUserId:`share-resident-${tag}`,email:`r-${tag}@example.invalid`,fullName:"Synthetic resident",role:"homeowner"}});
 expect(await resolveSharedEnrollment(resident.id,ct,rt)).toBeNull();await expect(setRequestSharing(resident.id,f.request.id,"disable")).rejects.toMatchObject({status:403});
 const unit=await db.communityUnit.create({data:{communityId:f.community.id,label:"Synthetic home",occupancyStatus:"occupied"}});
 await db.communityMembership.create({data:{communityId:f.community.id,userId:resident.id,unitId:unit.id,status:"active"}});
 expect(await resolveSharedEnrollment(resident.id,ct,rt)).toBe(`/app/homeowner/community#request-${f.request.id}`);
 await db.communityMembership.updateMany({where:{userId:resident.id,communityId:f.community.id},data:{status:"removed"}});
 expect(await resolveSharedEnrollment(resident.id,ct,rt)).toBeNull();
});
