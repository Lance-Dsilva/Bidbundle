import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ request: { findUnique: vi.fn() }, staff: { findFirst: vi.fn() }, community: { upsert: vi.fn(), findFirst: vi.fn() }, share: { upsert: vi.fn(), updateMany: vi.fn(), findFirst: vi.fn() }, query: vi.fn() }));
vi.mock("@/lib/server/db", () => {
  const tx = { hoaServiceRequest: mocks.request, communityStaffAssignment: mocks.staff, communityPublicShare: mocks.community, requestPublicShare: mocks.share, $queryRaw: mocks.query };
  return { db: { ...tx, $transaction: (fn: (value: typeof tx) => unknown) => fn(tx) } };
});
import { canonicalShareUrl, getPublicCommunity, getPublicRequest, setRequestSharing, resolveSharedEnrollment, validShareToken } from "@/lib/server/public-request-sharing";
const ct = "C".repeat(32), rt = "R".repeat(32);
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv("PUBLIC_REQUEST_SHARING", "1"); vi.stubEnv("BUNDLEEN_APP_URL", "https://bundleen.com"); mocks.request.findUnique.mockResolvedValue({ communityId: "c1", kind: "optional_group", status: "collecting_interest", community: { status: "active", type: "hoa" } }); mocks.staff.findFirst.mockResolvedValue({ id: "assignment" }); mocks.community.upsert.mockResolvedValue({ token: ct }); mocks.share.upsert.mockResolvedValue({ token: rt }); });
describe("share capability controls", () => {
  it.each(["", "abc", "../x", "A".repeat(31), "A".repeat(33), "a/b".padEnd(32,"a")])("rejects malformed token %s", value => expect(validShareToken(value)).toBe(false));
  it("requires explicit feature activation without querying any private data", async () => { vi.stubEnv("PUBLIC_REQUEST_SHARING", "0"); expect(await getPublicRequest(ct,rt)).toBeNull(); expect(mocks.share.findFirst).not.toHaveBeenCalled(); await expect(setRequestSharing("u","r","enable")).rejects.toMatchObject({ status:404 }); });
  it("rejects another community's manager", async () => { mocks.staff.findFirst.mockResolvedValue(null); await expect(setRequestSharing("u","r","enable")).rejects.toMatchObject({status:403}); expect(mocks.share.upsert).not.toHaveBeenCalled(); });
  it.each(["draft","cancelled","failed","completed"])("does not publish %s requests", async status => { mocks.request.findUnique.mockResolvedValue({communityId:"c",kind:"optional_group",status,community:{status:"active",type:"hoa"}}); await expect(setRequestSharing("u","r","enable")).rejects.toMatchObject({status:409}); });
  it("does not publish compulsory requests", async () => { mocks.request.findUnique.mockResolvedValue({communityId:"c",kind:"compulsory_recurring",status:"open_for_bids",community:{status:"active",type:"hoa"}}); await expect(setRequestSharing("u","r","enable")).rejects.toMatchObject({status:409}); });
  it("creates cryptographically-sized capabilities and retries without rotating", async () => { expect(await setRequestSharing("u","r","enable")).toEqual({enabled:true,path:`/c/${ct}/r/${rt}`,communityPath:`/c/${ct}`}); const arg=mocks.share.upsert.mock.calls[0][0]; expect(validShareToken(arg.create.token)).toBe(true); expect(arg.update).toEqual({enabled:true}); });
  it("explicit rotation replaces the request capability", async () => { await setRequestSharing("u","r","rotate"); expect(validShareToken(mocks.share.upsert.mock.calls[0][0].update.token)).toBe(true); });
  it("revocation does not create records or return capability URLs", async () => { expect(await setRequestSharing("u","r","disable")).toEqual({enabled:false,path:null,communityPath:null}); expect(mocks.community.upsert).not.toHaveBeenCalled(); expect(mocks.share.updateMany).toHaveBeenCalledWith({where:{requestId:"r"},data:{enabled:false}}); });
});
describe("anonymous privacy projection", () => {
  it("returns only generic service/count/deadline/path fields", async () => {
    mocks.share.findFirst.mockResolvedValue({request:{category:"lawn",status:"collecting_interest",minHomes:5,enrollmentClosesAt:null,_count:{participations:2},title:"123 Private Street",description:"Jane Doe, gate 1234",participants:[{name:"Private"}]}});
    expect(await getPublicRequest(ct,rt)).toEqual({priceLadder:null,providerName:null,verifiedBidders:0,service:"Lawn care",status:"collecting_interest",joinedHomes:2,minimumHomes:5,enrollmentClosesAt:null,path:`/c/${ct}/r/${rt}`});
    const query=mocks.share.findFirst.mock.calls[0][0]; expect(query.where.enabled).toBe(true); expect(query.where.request.community.publicShare.token).toBe(ct); expect(query.select.request.select.title).toBeUndefined(); expect(query.select.request.select.description).toBeUndefined();
  });
  it("never exposes unknown category text", async () => { mocks.share.findFirst.mockResolvedValue({request:{category:"123 Private Street",status:"collecting_interest",minHomes:null,enrollmentClosesAt:null,_count:{participations:0}}}); expect((await getPublicRequest(ct,rt))?.service).toBe("Community service"); });
  it("public listing only queries enabled optional active requests", async () => { mocks.community.findFirst.mockResolvedValue(null); expect(await getPublicCommunity(ct)).toBeNull(); const where=mocks.community.findFirst.mock.calls[0][0].select.community.select.hoaRequests.where; expect(where.kind).toBe("optional_group"); expect(where.publicShare).toEqual({enabled:true}); expect(where.status.in).not.toContain("draft"); });
  it("binds flyers to configured HTTPS origin, never Host header", () => { expect(canonicalShareUrl(`/c/${ct}/r/${rt}`)).toBe(`https://bundleen.com/c/${ct}/r/${rt}`); vi.stubEnv("BUNDLEEN_APP_URL","http://evil.example"); expect(()=>canonicalShareUrl(`/c/${ct}/r/${rt}`)).toThrow(); });
  it("rejects absolute and malformed flyer URLs", () => { expect(()=>canonicalShareUrl("https://evil.example")).toThrow(); expect(()=>canonicalShareUrl("/c/a/r/b")).toThrow(); });
});

it("only publishes accepted, valid price commitments and strips private fields", async () => {
  const row={category:"lawn",status:"collecting_interest",minHomes:1,enrollmentClosesAt:null,_count:{participations:2},priceCommitment:{acceptedAt:null,guaranteedPerHomeCents:1000,providerUserId:"private",scope:"Private scope",tiers:[{minHomes:1,perHomeCents:1000},{minHomes:5,perHomeCents:800}]}};
  mocks.share.findFirst.mockResolvedValue({request:row});
  expect((await getPublicRequest(ct,rt))?.priceLadder).toBeNull();
  row.priceCommitment.acceptedAt=new Date() as never;
  expect((await getPublicRequest(ct,rt))?.priceLadder).toEqual({tiers:row.priceCommitment.tiers,guaranteedPerHomeCents:1000});
  expect(JSON.stringify(await getPublicRequest(ct,rt))).not.toContain("private");
});

it("returns the exact request anchor only after scoped roster eligibility", async () => {
  mocks.share.findFirst.mockResolvedValue({requestId:"request_123"});
  expect(await resolveSharedEnrollment("resident_1",ct,rt)).toBe("/app/homeowner/community#request-request_123");
  const where=mocks.share.findFirst.mock.calls[0][0].where;
  expect(where.enabled).toBe(true);
  expect(where.request.community.memberships.some).toEqual({userId:"resident_1",status:"active",unitId:{not:null},unit:{occupancyStatus:"occupied"}});
  expect(mocks.share.upsert).not.toHaveBeenCalled();
});
it("does not grant enrollment to an unmatched account", async () => {
  mocks.share.findFirst.mockResolvedValue(null);
  expect(await resolveSharedEnrollment("outsider",ct,rt)).toBeNull();
});
