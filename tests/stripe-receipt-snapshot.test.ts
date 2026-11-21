import { beforeEach, expect, it, vi } from "vitest";
const m=vi.hoisted(()=>({raw:vi.fn(),existing:vi.fn(),visit:vi.fn(),consent:vi.fn(),payer:vi.fn(),create:vi.fn()}));
vi.mock("@/lib/server/db",()=>{const tx={$queryRaw:m.raw,stripeTestPayment:{findUnique:m.existing,create:m.create},serviceVisit:{findUnique:m.visit},visitBillingConsent:{findUnique:m.consent},user:{findUnique:m.payer}};return {db:{$transaction:(fn:(tx:unknown)=>unknown)=>fn(tx)}}});
import {prepareStripeTestPayment} from "@/lib/server/stripe-test-payments";
beforeEach(()=>{
 vi.resetAllMocks();
 m.visit.mockResolvedValue({status:"completed",completedAt:new Date("2026-11-20"),unitId:"unit",billingPayerUserId:"original",allocatedVisitCents:1000,occurrence:{agreement:{id:"agreement",requestId:"request",communityId:"community",providerUserId:"provider",currency:"usd",lockedHomeCount:2,status:"active",request:{kind:"optional_group",status:"in_progress",minHomes:2},community:{type:"hoa"},provider:{role:"provider",providerProfile:{accountStatus:"active",stripeTestPayoutStatus:"active",stripeTestAccountId:"acct_test"}}}}});
 m.consent.mockResolvedValue({termsToken:"terms",termsVersion:"completed-visit-charge-v1",acceptedAt:new Date("2026-11-01"),testCard:{customerId:"cus_original",paymentMethodId:"pm_original",verifiedAt:new Date("2026-11-01")}});
 m.payer.mockResolvedValue({stripeTestCustomerId:"cus_original",isVerified:true,email:" Original@Example.Invalid "});m.create.mockImplementation(({data})=>data);
});
it("snapshots normalized verified original payer email after locking that User",async()=>{
 const result=await prepareStripeTestPayment("visit");expect(result).toMatchObject({residentUserId:"original",receiptEmail:"original@example.invalid"});
 expect(m.payer.mock.calls[0][0].where).toEqual({id:"original"});expect(m.raw.mock.calls.some(call=>call[0].join("").includes('FROM "User"')&&call[1]==="original")).toBe(true);
});
it.each([{isVerified:false,email:"valid@example.invalid"},{isVerified:true,email:"not-email"},{isVerified:true,email:"x".repeat(255)+"@example.invalid"}])("rejects unverified or invalid receipt source %j",async change=>{m.payer.mockResolvedValue({stripeTestCustomerId:"cus_original",...change});await expect(prepareStripeTestPayment("visit")).rejects.toMatchObject({status:409});expect(m.create).not.toHaveBeenCalled();});
it("returns an existing historical snapshot unchanged without reading current email",async()=>{m.existing.mockResolvedValue({visitId:"visit",receiptEmail:null});await expect(prepareStripeTestPayment("visit")).resolves.toEqual({visitId:"visit",receiptEmail:null});expect(m.payer).not.toHaveBeenCalled();expect(m.create).not.toHaveBeenCalled();});
