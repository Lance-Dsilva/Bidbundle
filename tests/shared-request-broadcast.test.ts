import { beforeEach, afterEach, expect, it, vi } from "vitest";
const m=vi.hoisted(()=>({request:vi.fn(),user:vi.fn(),staff:vi.fn(),members:vi.fn(),ops:vi.fn(),audit:vi.fn(),configured:vi.fn(),drain:vi.fn()}));
vi.mock("@/lib/server/email",()=>({isEmailConfigured:m.configured}));
vi.mock("@/lib/server/notifications",()=>({buildPreferenceAwareNotificationOps:m.ops,scheduleOutboxDrain:m.drain}));
vi.mock("@/lib/server/db",()=>{const tx={$queryRaw:vi.fn(),hoaServiceRequest:{findUnique:m.request},user:{findUnique:m.user},communityStaffAssignment:{findFirst:m.staff},communityMembership:{findMany:m.members},adminAuditLog:{create:m.audit}};return {db:{...tx,$transaction:async(fn:(tx:unknown)=>unknown)=>fn(tx)}};});
import {previewSharedRequestBroadcast,sendSharedRequestBroadcast} from "@/lib/server/shared-request-broadcast";
let request:any;
beforeEach(()=>{vi.resetAllMocks();vi.stubEnv("PUBLIC_REQUEST_SHARING","1");vi.stubEnv("BUNDLEEN_APP_URL","https://bundleen.example");vi.useFakeTimers();vi.setSystemTime(new Date("2026-11-21T12:00:00Z"));request={id:"r",communityId:"c",kind:"optional_group",status:"collecting_interest",category:"landscaping",publicShare:{enabled:true,token:"r".repeat(32)},community:{publicShare:{token:"c".repeat(32)}}};m.request.mockImplementation(async()=>request);m.user.mockResolvedValue({isVerified:true,role:"hoa_staff"});m.staff.mockResolvedValue({id:"staff"});m.members.mockResolvedValue([{id:"membership-a",unitId:"unit-a",user:{id:"payer",email:"private@example.test",homeownerProfile:{notifyEmail:true}}},{id:"membership-b",unitId:"unit-b",user:{id:"optout",email:"optout@example.test",homeownerProfile:{notifyEmail:false}}}]);m.configured.mockReturnValue(true);m.ops.mockResolvedValue([]);});
afterEach(()=>{vi.useRealTimers();vi.unstubAllEnvs();});
it("previews only request-owned HOA recipients without exposing names or addresses",async()=>{const result=await previewSharedRequestBroadcast("manager","r");expect(result).toMatchObject({recipientCount:2,emailCount:1,enabled:true});expect(JSON.stringify(result)).not.toContain("private@example.test");expect(m.members.mock.calls[0][0].where).toMatchObject({communityId:"c",status:"active",user:{role:"homeowner",isVerified:true}});expect(m.ops).not.toHaveBeenCalled();});
it.each(["foreign","unverified","provider"])("rejects %s manager authority before audience lookup",async scenario=>{if(scenario==="foreign")m.staff.mockResolvedValue(null);if(scenario==="unverified")m.user.mockResolvedValue({isVerified:false,role:"hoa_staff"});if(scenario==="provider")m.user.mockResolvedValue({isVerified:true,role:"provider"});await expect(previewSharedRequestBroadcast("manager","r")).rejects.toMatchObject({status:403});expect(m.members).not.toHaveBeenCalled();});
it("queues preference-aware durable intents with identical retry dedupe",async()=>{const preview=await previewSharedRequestBroadcast("manager","r");await sendSharedRequestBroadcast("manager","r",preview.previewToken);await sendSharedRequestBroadcast("manager","r",preview.previewToken);expect(m.ops.mock.calls[0][0]).toEqual(m.ops.mock.calls[1][0]);expect(m.ops.mock.calls[0][0][0]).toMatchObject({userId:"payer",emailPolicy:"respect_preference",linkPath:preview.path});expect(m.drain).toHaveBeenCalledTimes(2);});
it.each(["audience","rotation","expiry"])("requires a fresh preview after %s changes",async scenario=>{const preview=await previewSharedRequestBroadcast("manager","r");if(scenario==="audience")m.members.mockResolvedValue([]);if(scenario==="rotation")request.publicShare.token="x".repeat(32);if(scenario==="expiry")vi.advanceTimersByTime(600001);await expect(sendSharedRequestBroadcast("manager","r",preview.previewToken)).rejects.toMatchObject({status:409});expect(m.ops).not.toHaveBeenCalled();});
it("does not enqueue mail while delivery configuration is absent",async()=>{m.configured.mockReturnValue(false);const preview=await previewSharedRequestBroadcast("manager","r");expect(preview.enabled).toBe(false);await expect(sendSharedRequestBroadcast("manager","r",preview.previewToken)).rejects.toMatchObject({status:503});expect(m.ops).not.toHaveBeenCalled();});
it("rejects revoked public sharing before delivery",async()=>{const preview=await previewSharedRequestBroadcast("manager","r");request.publicShare.enabled=false;await expect(sendSharedRequestBroadcast("manager","r",preview.previewToken)).rejects.toMatchObject({status:409});expect(m.ops).not.toHaveBeenCalled();});

it.each(["new membership", "changed unit", "revocation", "optout"])("rejects %s winning before the locked audience reread", async scenario => {
  const preview=await previewSharedRequestBroadcast("manager","r");
  const original=await m.members();
  const current=structuredClone(original);
  if(scenario==="new membership") current[0].id="new-membership";
  if(scenario==="changed unit") current[0].unitId="new-unit";
  if(scenario==="revocation") current.splice(0,1);
  if(scenario==="optout") current[0].user.homeownerProfile.notifyEmail=false;
  m.members.mockResolvedValueOnce(original).mockResolvedValueOnce(current);
  await expect(sendSharedRequestBroadcast("manager","r",preview.previewToken)).rejects.toMatchObject({status:409});
  expect(m.ops).not.toHaveBeenCalled(); expect(m.audit).not.toHaveBeenCalled();
});
