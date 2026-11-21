import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { afterAll, expect, it } from "vitest";
const db=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.TEST_DATABASE_URL!})});
afterAll(()=>db.$disconnect());
async function fixture(){
 const v=await db.serviceVisit.findFirst({where:{testPayment:null,billingPayerUserId:{not:null},redoOfVisitId:null,occurrence:{agreement:{request:{stripeTestEnrollmentRequired:false}}}},include:{occurrence:{include:{agreement:true}}}});
 if(!v)throw new Error("Run owned quality fixtures first");
 const payer=await db.user.findUniqueOrThrow({where:{id:v.billingPayerUserId!}}),g=v.occurrence.agreement;
 return {payer,data:{visitId:v.id,requestId:g.requestId,agreementId:g.id,communityId:g.communityId,residentUserId:payer.id,providerUserId:g.providerUserId,unitId:v.unitId!,customerId:`cus_${randomUUID()}`,paymentMethodId:"pm_receipt",providerAccountId:"acct_receipt",termsToken:"receipt-fixture",amountCents:1000,platformFeeCents:100,providerAmountCents:900,currency:"usd",status:"pending"}};
}
it("accepts only the normalized verified original payer and freezes it through profile changes",async()=>{
 const f=await fixture();await db.user.update({where:{id:f.payer.id},data:{email:` Mixed-${randomUUID()}@Example.Invalid `,isVerified:true}});
 const payer=await db.user.findUniqueOrThrow({where:{id:f.payer.id}}),email=payer.email.trim().toLowerCase();
 await expect(db.stripeTestPayment.create({data:{...f.data,receiptEmail:"replacement@example.invalid"}})).rejects.toThrow(/verified original payer/);
 const p=await db.stripeTestPayment.create({data:{...f.data,receiptEmail:email}});expect(p.receiptEmail).toBe(email);
 await db.user.update({where:{id:payer.id},data:{email:`changed-${randomUUID()}@example.invalid`}});
 for(const receiptEmail of [null,"changed@example.invalid"]){await expect(db.stripeTestPayment.update({where:{visitId:p.visitId},data:{receiptEmail}})).rejects.toThrow(/immutable/);}
 expect((await db.stripeTestPayment.findUniqueOrThrow({where:{visitId:p.visitId}})).receiptEmail).toBe(email);
});
it("rejects unverified and malformed nonnull addresses even when matching User",async()=>{
 const f=await fixture();await db.user.update({where:{id:f.payer.id},data:{isVerified:false}});
 await expect(db.stripeTestPayment.create({data:{...f.data,receiptEmail:f.payer.email.trim().toLowerCase()}})).rejects.toThrow(/verified original payer/);
 await db.user.update({where:{id:f.payer.id},data:{isVerified:true,email:`invalid-${randomUUID()}`}});
 const payer=await db.user.findUniqueOrThrow({where:{id:f.payer.id}});
 await expect(db.stripeTestPayment.create({data:{...f.data,receiptEmail:payer.email}})).rejects.toThrow(/verified original payer/);
});
it("preserves legacy null without allowing a retrospective receipt recipient",async()=>{
 const f=await fixture();const p=await db.stripeTestPayment.create({data:f.data});expect(p.receiptEmail).toBeNull();
 await expect(db.stripeTestPayment.update({where:{visitId:p.visitId},data:{receiptEmail:"invented@example.invalid"}})).rejects.toThrow(/immutable/);
 await db.stripeTestPayment.update({where:{visitId:p.visitId},data:{failureCode:"synthetic_retry"}});
 expect((await db.stripeTestPayment.findUniqueOrThrow({where:{visitId:p.visitId}})).receiptEmail).toBeNull();
});
