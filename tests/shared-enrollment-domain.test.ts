import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
const m = vi.hoisted(() => ({ flow: vi.fn(), update: vi.fn(), request: vi.fn(), user: vi.fn(), membership: vi.fn(), invitation: vi.fn(), invitations: vi.fn(), participation: vi.fn(), raw: vi.fn(), createMember: vi.fn(), updateUnit: vi.fn(), updateInvite: vi.fn(), audit: vi.fn(), revoke: vi.fn(), start: vi.fn(), confirm: vi.fn(), offer: vi.fn() }));
vi.mock("@/lib/server/db", () => { const tx = {
  $queryRaw: m.raw, sharedEnrollmentFlow: { findUnique: m.flow, findUniqueOrThrow: m.flow, update: m.update }, hoaServiceRequest: { findUnique: m.request }, user: { findUnique: m.user }, communityMembership: { findFirst: m.membership, findUnique: vi.fn().mockResolvedValue(null), create: m.createMember }, communityInvitation: { findMany: m.invitations, findUnique: m.invitation, update: m.updateInvite }, communityUnit: { update: m.updateUnit }, hoaRequestParticipation: { findFirst: m.participation }, adminAuditLog: { create: m.audit }, enrollmentBillingConsent: { updateMany: m.revoke },
}; return { db: { ...tx, $transaction: async (fn: (tx: unknown) => unknown) => fn(tx) } }; });
vi.mock("@/lib/server/enrollment-billing", () => ({ startEnrollmentBilling: m.start, confirmEnrollmentBilling: m.confirm, getEnrollmentBillingOffer: m.offer }));
import { claimSharedEnrollmentFlow, getSharedEnrollmentReturnPath, confirmSharedEnrollmentAddress, startSharedEnrollmentBilling, confirmSharedEnrollmentBilling, restartSharedEnrollmentBilling } from "@/lib/server/shared-enrollment";
const token = "f".repeat(32), ct = "c".repeat(32), rt = "r".repeat(32);
const digest = (v: string) => createHash("sha256").update(v).digest("hex");
let flow: Record<string, unknown>;
let request: any;
const ownAddress = { addressLine1: "10 Cedar Lane", locality: "Austin", region: "TX", postalCode: "78701", unitLabel: "A" };
const unit = { id: "unit", communityId: "community", ...ownAddress, label: "A", occupancyStatus: "occupied" };
const member = { id: "member", unitId: "unit", unit, userId: "payer", communityId: "community", status: "active" };
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("PUBLIC_REQUEST_SHARING", "1");
  flow = { token, requestId: "request", userId: "payer", consentId: "consent", communityTokenHash: digest(ct), requestTokenHash: digest(rt), expiresAt: new Date("2099-01-01"), confirmedMembershipId: "member", confirmedUnitId: "unit" };
  request = { id: "request", communityId: "community", kind: "optional_group", status: "collecting_interest", publicShare: { enabled: true, token: rt }, community: { type: "hoa", status: "active", publicShare: { token: ct }, hoaProfile: ownAddress }, priceCommitment: { acceptedAt: new Date() }, category: "landscaping", participantsLockedAt: null, enrollmentClosesAt: null };
  m.flow.mockImplementation(async () => ({ ...flow })); m.request.mockImplementation(async () => request); m.user.mockResolvedValue({ id: "payer", role: "homeowner", isVerified: true, email: "payer@example.test" }); m.membership.mockResolvedValue(member); m.participation.mockResolvedValue(null); m.update.mockImplementation(async ({data}) => { Object.assign(flow,data); return {...flow}; }); m.invitations.mockResolvedValue([]); m.confirm.mockResolvedValue({joined:true});
});
afterEach(() => vi.unstubAllEnvs());
it("binds an anonymous continuation only once without joining or creating membership", async () => { flow.userId=null; expect((await claimSharedEnrollmentFlow("payer",token)).stage).toBe("card"); expect(m.update).toHaveBeenCalledWith({where:{token},data:{userId:"payer"}}); expect(m.createMember).not.toHaveBeenCalled(); expect(m.confirm).not.toHaveBeenCalled(); });
it.each(["other", "unverified", "provider", "expired", "rotated", "disabled"])("rejects %s continuation without leaking address", async scenario => { if(scenario==="other")flow.userId="other"; if(scenario==="unverified")m.user.mockResolvedValue({role:"homeowner",isVerified:false}); if(scenario==="provider")m.user.mockResolvedValue({role:"provider",isVerified:true}); if(scenario==="expired")flow.expiresAt=new Date(0); if(scenario==="rotated")request.publicShare.token="x".repeat(32); if(scenario==="disabled")request.publicShare.enabled=false; await expect(claimSharedEnrollmentFlow("payer",token)).rejects.toMatchObject({status:404}); });
it("returns only a validated fixed local signup continuation", async () => { expect(await getSharedEnrollmentReturnPath(token)).toBe(`/c/${ct}/r/${rt}/join`); expect(await getSharedEnrollmentReturnPath("https://attacker.test")).toBeNull(); });
it("requires explicit address confirmation even for current membership", async () => { flow.confirmedMembershipId=null; flow.confirmedUnitId=null; expect((await claimSharedEnrollmentFlow("payer",token)).stage).toBe("address"); expect((await confirmSharedEnrollmentAddress("payer",token,{...ownAddress,addressLine1:" 10  CEDAR lane "})).stage).toBe("card"); expect(m.createMember).not.toHaveBeenCalled(); });
it("address knowledge without an exact email invitation never grants membership", async () => { m.membership.mockResolvedValue(null); const result=await confirmSharedEnrollmentAddress("payer",token,ownAddress); expect(result.stage).toBe("review"); expect(result.ownAddress).toBeUndefined(); expect(m.createMember).not.toHaveBeenCalled(); });
it("ambiguous case-insensitive invitations require review", async () => { m.membership.mockResolvedValue(null); m.invitations.mockResolvedValue([{id:"a",unitId:"unit"},{id:"b",unitId:"unit2"}]); expect((await confirmSharedEnrollmentAddress("payer",token,ownAddress)).stage).toBe("review"); expect(m.invitation).not.toHaveBeenCalled(); });
it.each(["inactive","occupied"])("does not take a %s roster unit from a stale invite", async occupancyStatus => { m.membership.mockResolvedValue(null); m.invitations.mockResolvedValue([{id:"invite",unitId:"unit"}]); m.invitation.mockResolvedValue({id:"invite",unitId:"unit",unit:{...unit,occupancyStatus},status:"pending",role:"homeowner",communityId:"community",email:"payer@example.test"}); expect((await confirmSharedEnrollmentAddress("payer",token,ownAddress)).stage).toBe("review"); expect(m.createMember).not.toHaveBeenCalled(); });
it("uses only the flow's server consent identity and rechecks its pointer inside billing", async () => { m.start.mockImplementation(async (_payer,_request,_consent,_terms,_card,authorize) => { flow.consentId="rotated"; const {db}=await import("@/lib/server/db"); await authorize(db); }); await expect(startSharedEnrollmentBilling("payer",token,{accepted:true,termsToken:"terms"})).rejects.toMatchObject({status:409}); expect(m.start.mock.calls[0].slice(0,5)).toEqual(["payer","request","consent","terms",undefined]); });
it("rechecks publication inside the actual join transaction", async () => { m.confirm.mockImplementation(async (_payer,_request,_consent,_setup,authorize) => { request.publicShare.enabled=false; const {db}=await import("@/lib/server/db"); await authorize(db); }); await expect(confirmSharedEnrollmentBilling("payer",token,"seti_owned")).rejects.toMatchObject({status:404}); });
it("restarts by revoking previous consent before rotating its server identity", async () => { await restartSharedEnrollmentBilling("payer",token); expect(m.revoke).toHaveBeenCalledWith({where:{id:"consent",payerUserId:"payer",revokedAt:null},data:{revokedAt:expect.any(Date)}}); expect(m.revoke.mock.invocationCallOrder[0]).toBeLessThan(m.update.mock.invocationCallOrder[0]); expect(flow.consentId).not.toBe("consent"); });
it("cannot restart an already joined household", async () => { m.participation.mockResolvedValue({response:"joined"}); await expect(restartSharedEnrollmentBilling("payer",token)).rejects.toMatchObject({status:409}); expect(m.revoke).not.toHaveBeenCalled(); });
it("reuses an exact verified-email invitation and audits membership without joining", async () => {
  let created = false;
  m.membership.mockImplementation(async () => created ? member : null);
  m.createMember.mockImplementation(async () => {created=true;return member;});
  m.invitations.mockResolvedValue([{id:"invite",unitId:"unit"}]);
  m.invitation.mockResolvedValue({id:"invite",unitId:"unit",unit:{...unit,occupancyStatus:"invite_pending"},status:"pending",role:"homeowner",communityId:"community",email:"payer@example.test"});
  expect((await confirmSharedEnrollmentAddress("payer",token,ownAddress)).stage).toBe("card");
  expect(m.updateInvite).toHaveBeenCalledWith({where:{id:"invite"},data:{status:"accepted",acceptedByUserId:"payer",acceptedAt:expect.any(Date)}});
  expect(m.audit).toHaveBeenCalled(); expect(m.confirm).not.toHaveBeenCalled();
});
it("rejects canceled public request continuation but preserves an awarded read-only state", async () => {
  request.status="cancelled"; await expect(claimSharedEnrollmentFlow("payer",token)).rejects.toMatchObject({status:404});
  request.status="awarded"; expect((await claimSharedEnrollmentFlow("payer",token)).stage).toBe("closed");
});
