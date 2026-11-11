import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { Client as PgClient, Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient, type Prisma } from "@/generated/prisma/client";
import { credentialClaimSnapshot } from "@/lib/provider-verification";
import { hoaRequestCreateSchema, bidSubmitSchema } from "@/lib/validation/hoa";
import type { PoolQuote, PoolTemplate } from "@/lib/pool-bid-template";

const state = vi.hoisted(() => ({
  client: null as (() => PrismaClient) | null, drain: vi.fn(), after: vi.fn(), send: vi.fn(),
  clerkUsers: new Map<string, unknown>(),
}));
// Database routing only; SQL authorization, constraints, locks and rows are real.
vi.mock("@/lib/server/db", () => ({ db: new Proxy({}, { get(_target, key) {
  const db = state.client?.(); if (!db) throw new Error("Owned issue60 client is not initialized.");
  const value = Reflect.get(db, key, db); return typeof value === "function" ? value.bind(db) : value;
} }) }));
vi.mock("@clerk/nextjs/server", () => ({ clerkClient: async () => ({ users: { getUser: async (id: string) => {
  const user = state.clerkUsers.get(id); if (!user) throw new Error("No synthetic verified Clerk fixture."); return user;
} } }) }));
vi.mock("next/server", async actual => ({ ...await actual<typeof import("next/server")>(), after: state.after }));
vi.mock("@/lib/server/notifications", async actual => ({ ...await actual<typeof import("@/lib/server/notifications")>(), scheduleOutboxDrain: state.drain }));

import { requireBoardViewer, listBoardCommunities, getBoardReview, setBoardPolicy, openBoardReview,
  castBoardVote, addBoardComment, revokeBoardMember, cancelBoardReview, resolveBoardReminder } from "@/lib/server/board-review";
import { createHoaRequest, respondToOptionalRequest, transitionHoaRequest, submitBid, awardBid } from "@/lib/server/hoa-market";
import { acceptBoardInvitation } from "@/lib/server/hoa-board-invitations";
import { updateProviderAdministration } from "@/lib/server/providers-admin";

const context = new AsyncLocalStorage<PrismaClient>();
let first: PrismaClient, second: PrismaClient, fixtureIndex = 0;
const pending: Promise<unknown>[] = [];
const releases: Array<() => void> = [];
function client(name: string) { return new PrismaClient({ adapter: new PrismaPg(new Pool({ connectionString: process.env.TEST_DATABASE_URL!, application_name: `issue60-${name}` }), { disposeExternalPool: true }) }); }
function run<T>(db: PrismaClient, work: () => Promise<T>): Promise<T> { const result = context.run(db, work); pending.push(result); void result.catch(() => undefined); return result; }
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); releases.push(resolve); return { promise, resolve }; }
async function reached(signal: ReturnType<typeof deferred>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { await Promise.race([signal.promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Expected real database stage not reached.")), 5000); })]); }
  finally { if (timer) clearTimeout(timer); }
}
async function secondSessionBlocked() {
  const observer = new PgClient({ connectionString: process.env.TEST_DATABASE_URL! }); await observer.connect();
  try {
    for (let n = 0; n < 100; n++) {
      const rows = await observer.query("SELECT pid FROM pg_stat_activity WHERE application_name='issue60-second' AND cardinality(pg_blocking_pids(pid))>0");
      if (rows.rowCount) return;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    throw new Error("Second owned session never reached a real PostgreSQL lock wait.");
  } finally { await observer.end(); }
}
const TEMPLATE: PoolTemplate = { version: 1, serviceMonths: 3, visitsPerMonth: 1, tiers: ["standard", "large"], hideProviderNamesUntilAward: true };
const QUOTE: PoolQuote = { monthlyCents: { standard: 10001, large: 20003 }, chemicalsIncluded: true, equipmentRepairsExcluded: true,
  earliestStartDate: "2028-01-31T12:00:00.000Z", routeDay: "flexible", cancellationNoticeDays: 30 };
const proposalInput = (changes: Record<string, unknown> = {}) => bidSubmitSchema.parse({ scope: "Synthetic full pool service", pricingBasis: "total", poolQuote: QUOTE,
  validUntil: new Date(Date.now() + 86400000).toISOString(), ...changes });

async function actor(tag: string, role: "admin" | "hoa_staff" | "homeowner" | "provider", email = `${tag}@example.invalid`) {
  return first.user.create({ data: { clerkUserId: tag, email, fullName: "Synthetic issue60 actor", role, isVerified: true,
    ...(role === "admin" ? { adminAccess: { create: { email: email.toLowerCase(), status: "active", level: "admin" } } } : {}) } });
}
async function seed() {
  const index = ++fixtureIndex, tag = `board60-${index}-${randomUUID()}`;
  const admin = await actor(`${tag}-admin`, "admin"), manager = await actor(`${tag}-manager`, "hoa_staff");
  const community = await first.community.create({ data: { name: "PRIVATE_COMMUNITY_NAME", type: "hoa", hoaProfile: { create: {
    legalName: "PRIVATE_LEGAL_NAME", addressLine1: "PRIVATE_RESIDENT_STREET", locality: "Synthetic City", region: "CA", postalCode: "90001", totalHomes: 2,
    latitude: 34.05, longitude: -118.25, addressVerificationStatus: "verified", minimumInsuranceCoverageCents: 50000000, requiresAdditionalInsured: true,
  } } } });
  await first.communityStaffAssignment.create({ data: { communityId: community.id, userId: manager.id, role: "hoa_manager", status: "active" } });
  const residents: Array<{ user: Awaited<ReturnType<typeof actor>>; unit: { id: string } }> = [];
  for (let n = 0; n < 2; n++) {
    const user = await actor(`${tag}-resident-${n}`, "homeowner");
    const unit = await first.communityUnit.create({ data: { communityId: community.id, label: `PRIVATE_UNIT_${n}` } });
    await first.communityMembership.create({ data: { communityId: community.id, userId: user.id, unitId: unit.id, status: "active" } });
    residents.push({ user, unit });
  }
  const requestId = await run(first, () => createHoaRequest(manager.id, community.id, hoaRequestCreateSchema.parse({ title: "PRIVATE_REQUEST_TITLE", category: "pool_care",
    description: "PRIVATE_ACCESS_NOTES", kind: "optional_group", publish: true, recurrenceLabel: null, recurrenceIntervalDays: null, totalOccurrences: 1,
    minHomes: 1, maxHomes: null, enrollmentClosesAt: new Date(Date.now() + 3600000).toISOString(), biddingClosesAt: null, poolTemplate: TEMPLATE })));
  await run(first, () => respondToOptionalRequest(residents[0].user.id, requestId, { response: "joined", poolTier: "standard" }));
  await run(first, () => respondToOptionalRequest(residents[1].user.id, requestId, { response: "joined", poolTier: "large" }));
  return { tag, index, admin, manager, community, residents, requestId };
}
type Fixture = Awaited<ReturnType<typeof seed>>;
const open = (f: Fixture) => run(first, () => transitionHoaRequest(f.manager.id, f.requestId, { action: "open_bidding", biddingClosesAt: new Date(Date.now() + 8 * 86400000).toISOString() }));
async function provider(f: Fixture, suffix: string, options: { verified?: boolean; approved?: boolean; status?: "active" | "pending" | "suspended"; postalCodes?: string[]; trades?: string[] } = {}) {
  const user = await actor(`${f.tag}-provider-${suffix}`, "provider");
  let profile = await first.providerProfile.create({ data: { userId: user.id, companyName: `${f.tag}-${suffix}`, trades: options.trades ?? ["pool_care"], accountStatus: "active",
    licenseNumber: `${f.tag}-${suffix}-LICENSE`, licenseState: "CA", insuranceProvider: "Fictional Insurer", insurancePolicyNumber: `${f.tag}-${suffix}-POLICY` } });
  await first.providerServiceArea.create({ data: { providerUserId: user.id, label: "Synthetic location", centerLatitude: 34.05, centerLongitude: -118.25, radiusMiles: 10, postalCodes: options.postalCodes ?? [] } });
  if (options.verified !== false) for (const kind of ["license", "insurance"] as const) {
    const id = randomUUID(), checksum = createHash("sha256").update(`${f.tag}-${suffix}-${kind}`).digest("hex");
    // Synthetic metadata fixture; no Blob call or credential bytes are needed.
    await first.mediaAsset.create({ data: { id, purpose: `provider_${kind}`, providerProfileId: profile.id, uploaderUserId: user.id,
      storagePath: `provider-credentials/${profile.id}/provider_${kind}/${id}.pdf`, storageUrl: "", contentType: "application/pdf", byteSize: 32, checksum,
      credentialSnapshot: credentialClaimSnapshot(profile, kind) } });
    profile = await first.providerProfile.update({ where: { id: profile.id }, data: { [`${kind}DocumentId`]: id } });
    await run(first, () => updateProviderAdministration(f.admin, user.id, { [`${kind}`]: "verify", expectedUpdatedAt: profile.updatedAt.toISOString(),
      [`${kind}DocumentId`]: id, [`${kind}DocumentChecksum`]: checksum, [`${kind}ExpiresOn`]: "2099-12-31",
      ...(kind === "insurance" ? { insuranceCoverageCents: 100000000, insuranceAdditionalInsured: true } : {}) }));
    profile = await first.providerProfile.findUniqueOrThrow({ where: { id: profile.id } });
  }
  if (options.approved) await first.providerCommunityApproval.create({ data: { communityId: f.community.id, providerUserId: user.id, createdByUserId: f.admin.id } });
  if (options.status && options.status !== "active") await run(first, () => updateProviderAdministration(f.admin, user.id, { accountStatus: options.status, expectedUpdatedAt: profile.updatedAt.toISOString() }));
  return user;
}
beforeAll(() => {
  const target = new URL(process.env.TEST_DATABASE_URL!);
  if (target.hostname !== "127.0.0.1" || target.port !== "54371" || !/^\/bundleen_issue60_test_[a-z0-9]+$/.test(target.pathname) || !/^bundleen_issue60_runner_[a-z0-9]+$/.test(target.username)) throw new Error("Refusing a non-owned issue60 database.");
  first = client("first"); second = client("second"); state.client = () => context.getStore() ?? first;
});
beforeEach(() => {
  state.send.mockReset(); state.send.mockRejectedValue(new Error("Real transport is forbidden in board tests."));
  state.drain.mockClear(); state.after.mockClear(); vi.stubGlobal("fetch", state.send);
});
afterEach(async () => { for (const release of releases.splice(0)) release(); await Promise.allSettled(pending.splice(0)); expect(state.send).not.toHaveBeenCalled(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); });
afterAll(async () => { await Promise.all([first?.$disconnect(), second?.$disconnect()]); });


async function boardMember(f: Fixture, user = f.residents[0].user) {
  const invitation = await first.communityInvitation.create({ data: { communityId: f.community.id, email: user.email,
    role: "hoa_board", invitedByUserId: f.manager.id, expiresAt: new Date(Date.now() + 86400000) } });
  await run(first, () => acceptBoardInvitation({ invitationId: invitation.id, clerkUserId: user.clerkUserId,
    email: user.email, emailVerified: true, fullName: user.fullName }));
  return first.communityBoardMember.findUniqueOrThrow({ where: { communityId_userId: { communityId: f.community.id, userId: user.id } } });
}
async function boardFixture(rule: "board_majority" | "board_unanimous" | "board_quorum_n" = "board_majority", count = 3, quorumN?: number) {
  const f = await seed();
  const voters = [...f.residents.map(r => r.user)];
  while (voters.length < count) voters.push(await actor(`${f.tag}-board-${voters.length}`, "homeowner"));
  const members = [];
  for (const voter of voters.slice(0, count)) members.push(await boardMember(f, voter));
  await run(first, () => setBoardPolicy(f.manager.id, f.community.id, { rule, quorumN: quorumN ?? null, expectedVersion: 0 }));
  const providers = [await provider(f, "one", { approved: true }), await provider(f, "two", { approved: true })];
  await open(f);
  const bids = [];
  for (const p of providers) bids.push(await run(first, () => submitBid(p.id, f.requestId, proposalInput())));
  return { ...f, voters: voters.slice(0, count), members, providers, bids };
}
type BoardFixture = Awaited<ReturnType<typeof boardFixture>>;
const newRound = (f: BoardFixture, bidIds = f.bids.map(b => b.id)) => run(first, () => openBoardReview(f.manager.id, f.requestId,
  { bidIds, deadline: new Date(Date.now() + 3600000).toISOString() }));
const vote = (f: BoardFixture, roundId: string, voter: number, bid = 0, decision: "approve" | "reject" = "approve") =>
  run(first, () => castBoardVote(f.voters[voter].id, roundId, { bidId: f.bids[bid].id, decision }));
const award = (f: BoardFixture, bid = 0, db = first) => run(db, () => awardBid(f.manager.id, f.requestId, { bidId: f.bids[bid].id, expectedBidVersion: f.bids[bid].version }));

describe("board invitation identity and role boundaries", () => {
  it("preserves an existing homeowner role, profile, and residence when accepting the exact invited email", async () => {
    const f = await seed(), user = f.residents[0].user;
    const member = await boardMember(f, user);
    expect(member).toMatchObject({ userId: user.id, communityId: f.community.id, status: "active" });
    expect(await first.user.findUniqueOrThrow({ where: { id: user.id } })).toMatchObject({ role: "homeowner" });
    expect(await first.communityMembership.findFirst({ where: { userId: user.id, communityId: f.community.id, status: "active" } })).not.toBeNull();
    expect(await run(first, () => requireBoardViewer(user.id, f.community.id))).toMatchObject({ canManage: false });
    await expect(run(first, () => setBoardPolicy(user.id, f.community.id, { rule: "board_unanimous", expectedVersion: 0 }))).rejects.toMatchObject({ status: 403 });
    await expect(run(first, () => transitionHoaRequest(user.id, f.requestId, { action: "open_bidding", biddingClosesAt: new Date(Date.now()+86400000).toISOString() }))).rejects.toMatchObject({ status: 403 });
  });
  it("does not let verified-but-different accounts or unverified emails redeem a board invitation", async () => {
    const f = await seed(), user = f.residents[0].user, stranger = f.residents[1].user;
    const invitation = await first.communityInvitation.create({ data: { communityId: f.community.id, role: "hoa_board", email: user.email,
      invitedByUserId: f.manager.id, expiresAt: new Date(Date.now()+86400000) } });
    const input = { invitationId: invitation.id, clerkUserId: user.clerkUserId, email: user.email, emailVerified: false, fullName: user.fullName };
    await expect(run(first, () => acceptBoardInvitation(input))).rejects.toMatchObject({ status: 403 });
    await expect(run(first, () => acceptBoardInvitation({ ...input, emailVerified: true, clerkUserId: stranger.clerkUserId }))).rejects.toMatchObject({ status: 403 });
    await expect(run(first, () => acceptBoardInvitation({ ...input, emailVerified: true, email: stranger.email }))).rejects.toMatchObject({ status: 403 });
    expect(await first.communityBoardMember.count({ where: { communityId: f.community.id } })).toBe(0);
  });
  it("rejects expired and revoked invitations without creating membership", async () => {
    const f = await seed();
    for (const [i,status] of (["pending", "revoked"] as const).entries()) {
      const user = f.residents[i].user;
      const invitation = await first.communityInvitation.create({ data: { communityId: f.community.id, role: "hoa_board", email: user.email,
        invitedByUserId: f.manager.id, status, expiresAt: new Date(Date.now()+(status === "pending" ? 400 : -86400000)), ...(status === "revoked" ? { revokedAt: new Date() } : {}) } });
      if (status === "pending") await new Promise(resolve => setTimeout(resolve,450));
      await expect(run(first, () => acceptBoardInvitation({ invitationId: invitation.id, clerkUserId: user.clerkUserId, email: user.email,
        emailVerified: true, fullName: user.fullName }))).rejects.toMatchObject({ status: 410 });
    }
    expect(await first.communityBoardMember.count({ where: { communityId: f.community.id } })).toBe(0);
  });
  it("rejects direct membership insertion without accepted invitation evidence", async () => {
    const f = await seed();
    await expect(first.communityBoardMember.create({ data: { communityId: f.community.id, userId: f.residents[0].user.id,
      invitedByUserId: f.manager.id } })).rejects.toBeDefined();
  });
});

describe("scoped board review and approval thresholds", () => {
  it("excludes ordinary residents, providers and other-community managers from private review and discussions", async () => {
    const f = await boardFixture(), other = await seed(), { roundId } = await newRound(f);
    const outsider = await actor(`${f.tag}-outsider`, "homeowner");
    for (const user of [outsider, f.providers[0], other.manager]) {
      await expect(run(first, () => getBoardReview(user.id, f.requestId))).rejects.toMatchObject({ status: 403 });
      await expect(run(first, () => castBoardVote(user.id, roundId, { bidId: f.bids[0].id, decision: "approve" }))).rejects.toMatchObject({ status: 403 });
      await expect(run(first, () => addBoardComment(user.id, roundId, { body: "Private board discussion" }))).rejects.toMatchObject({ status: 403 });
    }
    expect(await run(first, () => listBoardCommunities(outsider.id))).toEqual([]);
    const view = await run(first, () => getBoardReview(f.voters[0].id, f.requestId));
    expect(view.proposals.map(p => p.providerName)).toContain(`${f.tag}-one`);
    expect(JSON.stringify(view)).not.toContain("PRIVATE_RESIDENT_STREET");
    expect(JSON.stringify(view)).not.toContain("PRIVATE_ACCESS_NOTES");
    expect(JSON.stringify(view)).not.toContain("PRIVATE_UNIT_");
  });
  it("uses majority of the full electorate and keeps board members unable to award", async () => {
    const f = await boardFixture(), { roundId } = await newRound(f);
    expect(await first.boardReviewRound.findUniqueOrThrow({ where: { id: roundId } })).toMatchObject({ threshold: 2 });
    await vote(f,roundId,0);
    await expect(award(f)).rejects.toMatchObject({ status: 409 });
    await vote(f,roundId,1);
    await expect(run(first, () => awardBid(f.voters[0].id, f.requestId, { bidId: f.bids[0].id, expectedBidVersion: f.bids[0].version }))).rejects.toMatchObject({ status: 403 });
    await award(f);
    expect(await first.boardReviewRound.findUniqueOrThrow({ where: { id: roundId } })).toMatchObject({ status: "awarded", awardedBidId: f.bids[0].id });
    expect(await first.providerCommunityApproval.findFirst({ where: { communityId: f.community.id, providerUserId: f.providers[0].id } })).not.toBeNull();
    expect(await first.boardAuditEvent.count({ where: { roundId } })).toBeGreaterThanOrEqual(3);
  });
  it("counts approvals, not turnout, for at-least-N and refuses impossible quorum", async () => {
    const f = await boardFixture("board_quorum_n",3,2), { roundId } = await newRound(f);
    await vote(f,roundId,0); await vote(f,roundId,1,0,"reject");
    await expect(award(f)).rejects.toMatchObject({ status: 409 });
    await vote(f,roundId,2); await award(f);
    const g = await boardFixture("board_quorum_n",1,2);
    await expect(newRound(g)).rejects.toMatchObject({status:409});
  });
  it("requires every member to approve under unanimous policy", async () => {
    const f = await boardFixture("board_unanimous"), { roundId } = await newRound(f);
    await vote(f,roundId,0); await vote(f,roundId,1);
    await expect(award(f)).rejects.toMatchObject({ status: 409 });
    await vote(f,roundId,2); await award(f);
  });
  it("requires one final ballot per proposal and rejects a non-shortlisted proposal", async () => {
    const f = await boardFixture(), { roundId } = await newRound(f,[f.bids[0].id]);
    await vote(f,roundId,0);
    await expect(vote(f,roundId,0,0,"reject")).rejects.toMatchObject({ status: 409 });
    await expect(vote(f,roundId,1,1)).rejects.toBeDefined();
    expect(await first.boardProposalVote.findMany({ where: { roundId } })).toMatchObject([{ decision: "approve" }]);
    await expect(first.boardProposalVote.updateMany({ where: { roundId }, data: { decision: "reject" } })).rejects.toBeDefined();
    await expect(first.boardProposalVote.deleteMany({ where: { roundId } })).rejects.toBeDefined();
  });
  it("serializes duplicate opposing ballots so exactly one is recorded", async () => {
    const f = await boardFixture(), { roundId } = await newRound(f);
    const results = await Promise.allSettled([
      vote(f,roundId,0), run(second,() => castBoardVote(f.voters[0].id,roundId,{bidId:f.bids[0].id,decision:"reject"})),
    ]);
    expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);
    expect(await first.boardProposalVote.count({where:{roundId}})).toBe(1);
  });
  it("preserves private discussion and audit records as append-only data", async () => {
    const f = await boardFixture(), { roundId } = await newRound(f);
    await run(first,()=>addBoardComment(f.voters[0].id,roundId,{body:"Private rationale with concrete comparison"}));
    const message = await first.boardDiscussionMessage.findFirstOrThrow({where:{roundId}});
    await expect(first.boardDiscussionMessage.update({where:{id:message.id},data:{body:"rewritten"}})).rejects.toBeDefined();
    await expect(first.boardDiscussionMessage.delete({where:{id:message.id}})).rejects.toBeDefined();
    await expect(first.boardAuditEvent.deleteMany({where:{roundId}})).rejects.toBeDefined();
  });
});

describe("stale snapshots and manager-confirmed award races", () => {
  it("invalidates a round after membership revocation and blocks that member's reads and writes", async () => {
    const f = await boardFixture(), {roundId}=await newRound(f);
    await vote(f,roundId,0); await vote(f,roundId,1);
    await run(first,()=>revokeBoardMember(f.manager.id,f.community.id,f.members[2].id));
    const view=await run(first,()=>getBoardReview(f.manager.id,f.requestId));
    expect(view.rounds.find(r=>r.id===roundId)?.stale).toBe(true);
    await expect(award(f)).rejects.toMatchObject({status:409});
    await expect(run(first,()=>getBoardReview(f.voters[2].id,f.requestId))).rejects.toMatchObject({status:403});
    await expect(vote(f,roundId,2)).rejects.toBeDefined();
    const next=await newRound(f); await vote(f,next.roundId,0); await vote(f,next.roundId,1); await award(f);
  });
  it("invalidates policy revisions rather than reinterpreting prior ballots", async () => {
    const f=await boardFixture(), {roundId}=await newRound(f);
    await vote(f,roundId,0); await vote(f,roundId,1);
    const policy=await first.communityBoardPolicy.findUniqueOrThrow({where:{communityId:f.community.id}});
    await run(first,()=>setBoardPolicy(f.manager.id,f.community.id,{rule:"board_unanimous",expectedVersion:policy.version}));
    await expect(award(f)).rejects.toMatchObject({status:409});
    expect((await first.boardReviewRound.findUniqueOrThrow({where:{id:roundId}})).threshold).toBe(2);
    await expect(first.boardReviewRound.update({where:{id:roundId},data:{threshold:1}})).rejects.toBeDefined();
  });
  it("requires a new round if a shortlisted bid changes version", async () => {
    const f=await boardFixture(), {roundId}=await newRound(f);
    await vote(f,roundId,0); await vote(f,roundId,1);
    await run(first,()=>submitBid(f.providers[0].id,f.requestId,proposalInput({scope:"Revised contractual scope",expectedBidVersion:f.bids[0].version})));
    expect((await run(first,()=>getBoardReview(f.manager.id,f.requestId))).rounds.find(r=>r.id===roundId)?.stale).toBe(true);
    await expect(award(f)).rejects.toMatchObject({status:409});
  });
  it("rejects simultaneous conflicting awards even when both proposals satisfy the board rule", async () => {
    const f=await boardFixture(), {roundId}=await newRound(f);
    for(const bid of [0,1]) for(const voter of [0,1]) await vote(f,roundId,voter,bid);
    const results=await Promise.allSettled([award(f,0,first),award(f,1,second)]);
    expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);
    expect(await first.serviceAgreement.count({where:{requestId:f.requestId}})).toBe(1);
    const round=await first.boardReviewRound.findUniqueOrThrow({where:{id:roundId}});
    expect(round.status).toBe("awarded");
    expect(f.bids.map(b=>b.id)).toContain(round.awardedBidId);
  });
});

describe("board deadline, replacement and capability regression", () => {
  it("does not open a vacuous unanimous round with zero members",async()=>{
    const f=await boardFixture("board_unanimous",0);
    await expect(newRound(f)).rejects.toMatchObject({status:409});
  });
  it("leaves default manager-only awards usable without any board round",async()=>{
    const f=await boardFixture();
    await run(first,()=>setBoardPolicy(f.manager.id,f.community.id,{rule:"manager_only",expectedVersion:1}));
    await award(f);
    expect(await first.boardReviewRound.count({where:{requestId:f.requestId}})).toBe(0);
  });
  it("requires a fresh round after roster additions and prevents replay into the replacement round",async()=>{
    const f=await boardFixture(),previous=await newRound(f);
    await vote(f,previous.roundId,0);await vote(f,previous.roundId,1);
    const newcomer=await actor(`${f.tag}-newcomer`,"homeowner");await boardMember(f,newcomer);
    await expect(award(f)).rejects.toMatchObject({status:409});
    const next=await newRound(f);
    expect((await first.boardReviewRound.findUniqueOrThrow({where:{id:next.roundId}})).threshold).toBe(3);
    expect((await first.boardReviewRound.findUniqueOrThrow({where:{id:previous.roundId}})).status).toBe("cancelled");
    await expect(vote(f,previous.roundId,2)).rejects.toBeDefined();
    expect(await first.boardProposalVote.count({where:{roundId:next.roundId}})).toBe(0);
  });
  it("permits same-ballot retries but never creates duplicate audit events",async()=>{
    const f=await boardFixture(),{roundId}=await newRound(f);
    await vote(f,roundId,0);await vote(f,roundId,0);
    expect(await first.boardProposalVote.count({where:{roundId}})).toBe(1);
    expect(await first.boardAuditEvent.count({where:{roundId,kind:"vote_cast"}})).toBe(1);
  });
  it("rejects expired and overlong review deadlines and offers expiring before the vote deadline",async()=>{
    const f=await boardFixture();
    for(const delta of [-1000,32*86400000,2*86400000]) await expect(run(first,()=>openBoardReview(f.manager.id,f.requestId,{bidIds:[f.bids[0].id],deadline:new Date(Date.now()+delta).toISOString()}))).rejects.toBeDefined();
    expect(await first.boardReviewRound.count({where:{requestId:f.requestId}})).toBe(0);
  });
  it("uses compare-and-swap policy versions when concurrent managers save",async()=>{
    const f=await boardFixture();
    const results=await Promise.allSettled([
      run(first,()=>setBoardPolicy(f.manager.id,f.community.id,{rule:"board_unanimous",expectedVersion:1})),
      run(second,()=>setBoardPolicy(f.manager.id,f.community.id,{rule:"board_quorum_n",quorumN:2,expectedVersion:1})),
    ]);
    expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);
    expect((await first.communityBoardPolicy.findUniqueOrThrow({where:{communityId:f.community.id}})).version).toBe(2);
  });
  it("rechecks membership after a vote waits on a real request lock",async()=>{
    const f=await boardFixture(),{roundId}=await newRound(f), locked=deferred(),release=deferred();
    const revoke=first.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM "HoaServiceRequest" WHERE id=${f.requestId} FOR UPDATE`;
      locked.resolve();await release.promise;
      await tx.communityBoardMember.update({where:{id:f.members[0].id},data:{status:"revoked",revokedAt:new Date()}});
    });pending.push(revoke);void revoke.catch(()=>undefined);await reached(locked);
    const ballot=run(second,()=>castBoardVote(f.voters[0].id,roundId,{bidId:f.bids[0].id,decision:"approve"}));
    await secondSessionBlocked();release.resolve();await revoke;
    await expect(ballot).rejects.toBeDefined();
    expect(await first.boardProposalVote.count({where:{roundId}})).toBe(0);
  });
});

describe("board SQL policy invariants and reminder lifecycle",()=>{
 it("rejects NULL quorum and fabricated threshold at the database boundary",async()=>{
  const f=await boardFixture();
  await expect(first.communityBoardPolicy.update({where:{communityId:f.community.id},data:{rule:"board_quorum_n",quorumN:null,version:2}})).rejects.toBeDefined();
  const {roundId}=await newRound(f);const round=await first.boardReviewRound.findUniqueOrThrow({where:{id:roundId}});
  await run(first,()=>cancelBoardReview(f.manager.id,roundId));
  for(const changes of [{threshold:0},{threshold:1},{rule:"board_quorum_n",quorumN:null}]) await expect(first.boardReviewRound.create({data:{...round,electorate:round.electorate as Prisma.InputJsonValue,proposals:round.proposals as Prisma.InputJsonValue,id:randomUUID(),status:"open",closedAt:null,awardedBidId:null,...changes}})).rejects.toBeDefined();
 });
 it("preserves prior ballots when a manager cancels and requires another qualifying review before award",async()=>{
  const f=await boardFixture(),{roundId}=await newRound(f);await vote(f,roundId,0);await vote(f,roundId,1);
  await expect(run(first,()=>cancelBoardReview(f.voters[0].id,roundId))).rejects.toMatchObject({status:403});
  await run(first,()=>cancelBoardReview(f.manager.id,roundId));await run(first,()=>cancelBoardReview(f.manager.id,roundId));
  expect(await first.boardProposalVote.count({where:{roundId}})).toBe(2);expect(await first.boardAuditEvent.count({where:{roundId,kind:"review_cancelled"}})).toBe(1);
  await expect(award(f)).rejects.toMatchObject({status:409});
 });
 it("deduplicates reminders and skips voters who completed every proposal",async()=>{
  const f=await boardFixture(),{roundId}=await newRound(f);
  const payload={roundId,userId:f.voters[0].id};
  expect(await run(first,()=>resolveBoardReminder(payload))).toEqual({kind:"sent"});
  expect(await run(second,()=>resolveBoardReminder(payload))).toEqual({kind:"sent"});
  expect(await first.notification.count({where:{dedupeKey:`board-reminder:${roundId}:${f.voters[0].id}`}})).toBe(1);
  await vote(f,roundId,0,0);await vote(f,roundId,0,1,"reject");
  expect(await run(first,()=>resolveBoardReminder(payload))).toEqual({kind:"skipped"});
 });
 it("skips reminders for revoked, stale, cancelled and malformed targets",async()=>{
  const f=await boardFixture(),{roundId}=await newRound(f);
  for(const payload of [null,{}, {roundId}, {roundId,userId:7}])expect(await run(first,()=>resolveBoardReminder(payload))).toEqual({kind:"skipped"});
  await run(first,()=>revokeBoardMember(f.manager.id,f.community.id,f.members[0].id));
  expect(await run(first,()=>resolveBoardReminder({roundId,userId:f.voters[0].id}))).toEqual({kind:"skipped"});
  expect(await run(first,()=>resolveBoardReminder({roundId,userId:f.voters[1].id}))).toEqual({kind:"skipped"});
  await run(first,()=>cancelBoardReview(f.manager.id,roundId));
  expect(await run(first,()=>resolveBoardReminder({roundId,userId:f.voters[1].id}))).toEqual({kind:"skipped"});
  expect(await first.notification.count({where:{dedupeKey:{startsWith:`board-reminder:${roundId}:`}}})).toBe(0);
 });
 it("cannot reactivate a revoked member by replaying an old accepted invitation",async()=>{
  const f=await boardFixture();await run(first,()=>revokeBoardMember(f.manager.id,f.community.id,f.members[0].id));
  await expect(first.communityBoardMember.update({where:{id:f.members[0].id},data:{status:"active",revokedAt:null,joinedAt:new Date()}})).rejects.toBeDefined();
 });
});

describe("deadline and final award revalidation",()=>{
 it("rejects a late ballot but permits manager confirmation of approvals recorded before the deadline",async()=>{
  const f=await boardFixture();const {roundId}=await run(first,()=>openBoardReview(f.manager.id,f.requestId,{bidIds:[f.bids[0].id],deadline:new Date(Date.now()+1300).toISOString()}));
  await vote(f,roundId,0);await vote(f,roundId,1);
  await new Promise(resolve=>setTimeout(resolve,1400));
  await expect(vote(f,roundId,2)).rejects.toBeDefined();
  await award(f);expect((await first.boardReviewRound.findUniqueOrThrow({where:{id:roundId}})).status).toBe("awarded");
 });
 it("blocks accepted-bid SQL bypass when no proposal has board approval and rolls back the parent",async()=>{
  const f=await boardFixture();await newRound(f);
  const bypass=first.$transaction(async tx=>{
   await tx.hoaServiceRequest.update({where:{id:f.requestId},data:{status:"awarded",awardedAt:new Date(),biddingClosesAt:new Date()}});
   await tx.serviceBid.update({where:{id:f.bids[0].id},data:{status:"accepted"}});
  });
  await expect(bypass).rejects.toThrow(/P1762/);
  expect((await first.hoaServiceRequest.findUniqueOrThrow({where:{id:f.requestId}})).status).toBe("open_for_bids");
  expect(await first.serviceAgreement.count({where:{requestId:f.requestId}})).toBe(0);
 });
 it("rechecks provider suspension after voting instead of treating board approval as credential authority",async()=>{
  const f=await boardFixture(),{roundId}=await newRound(f);await vote(f,roundId,0);await vote(f,roundId,1);
  const profile=await first.providerProfile.findUniqueOrThrow({where:{userId:f.providers[0].id}});
  await run(first,()=>updateProviderAdministration(f.admin,f.providers[0].id,{accountStatus:"suspended",expectedUpdatedAt:profile.updatedAt.toISOString()}));
  await expect(award(f)).rejects.toBeDefined();
  expect(await first.serviceAgreement.count({where:{requestId:f.requestId}})).toBe(0);
 });
 it("invalidates recorded approval if an electorate member loses verified identity",async()=>{
  const f=await boardFixture(),{roundId}=await newRound(f);await vote(f,roundId,0);await vote(f,roundId,1);
  await first.user.update({where:{id:f.voters[1].id},data:{isVerified:false}});
  await expect(award(f)).rejects.toMatchObject({status:409});
  expect(await first.serviceAgreement.count({where:{requestId:f.requestId}})).toBe(0);
 });
});

describe("complete board setup and reminder schedule",()=>{
 it("preserves a provider's global account role when granting separate board membership",async()=>{
  const f=await seed(),user=await actor(`${f.tag}-provider-board`,"provider");await boardMember(f,user);
  expect((await first.user.findUniqueOrThrow({where:{id:user.id}})).role).toBe("provider");
  expect(await run(first,()=>requireBoardViewer(user.id,f.community.id))).toMatchObject({canManage:false});
  expect(await first.communityStaffAssignment.count({where:{communityId:f.community.id,userId:user.id}})).toBe(0);
 });
 it("creates a missing invited user as homeowner without creating staff authority",async()=>{
  const f=await seed(),email=`${f.tag}-new@example.invalid`;
  const invitation=await first.communityInvitation.create({data:{communityId:f.community.id,email,role:"hoa_board",invitedByUserId:f.manager.id,expiresAt:new Date(Date.now()+86400000)}});
  await run(first,()=>acceptBoardInvitation({invitationId:invitation.id,clerkUserId:`${f.tag}-new`,email,emailVerified:true,fullName:"New synthetic board member"}));
  const user=await first.user.findUniqueOrThrow({where:{email},include:{homeownerProfile:true}});
  expect(user.role).toBe("homeowner");expect(user.homeownerProfile).not.toBeNull();
  expect(await first.communityStaffAssignment.count({where:{userId:user.id}})).toBe(0);
 });
 it("refuses a new round while an active electorate member lacks verified identity",async()=>{
  const f=await boardFixture();await first.user.update({where:{id:f.voters[0].id},data:{isVerified:false}});
  await expect(newRound(f)).rejects.toBeDefined();
  expect(await first.boardReviewRound.count({where:{requestId:f.requestId}})).toBe(0);
 });
 it("schedules one durable reminder per voter exactly 24 hours before the deadline",async()=>{
  const f=await boardFixture();
  const revised=await run(first,()=>submitBid(f.providers[0].id,f.requestId,proposalInput({validUntil:new Date(Date.now()+5*86400000).toISOString(),expectedBidVersion:f.bids[0].version})));
  const deadline=new Date(Date.now()+3*86400000);
  const {roundId}=await run(first,()=>openBoardReview(f.manager.id,f.requestId,{bidIds:[revised.id],deadline:deadline.toISOString()}));
  const reminders=await first.outboxEvent.findMany({where:{kind:"board_vote_reminder",dedupeKey:{startsWith:`board-reminder:${roundId}:`}}});
  expect(reminders).toHaveLength(3);for(const reminder of reminders){expect(reminder.nextAttemptAt.getTime()).toBe(deadline.getTime()-86400000);expect(reminder.payload).toMatchObject({roundId});expect(JSON.stringify(reminder.payload)).not.toContain("PRIVATE_ACCESS_NOTES");}
  expect(await first.notification.count({where:{dedupeKey:{startsWith:`board-open:${roundId}:`}}})).toBe(3);
 });
});

it("allows exact admin manager confirmation, adds the new approved vendor, and queues a polite losing-bid notification once",async()=>{
 const f=await boardFixture();
 await first.providerCommunityApproval.deleteMany({where:{communityId:f.community.id}});
 expect(await run(first,()=>requireBoardViewer(f.admin.id,f.community.id))).toMatchObject({canManage:true});
 const {roundId}=await newRound(f);await vote(f,roundId,0);await vote(f,roundId,1);
 const input={bidId:f.bids[0].id,expectedBidVersion:f.bids[0].version};
 const id=await run(first,()=>awardBid(f.admin.id,f.requestId,input));expect(await run(first,()=>awardBid(f.admin.id,f.requestId,input))).toBe(id);
 expect(await first.providerCommunityApproval.findMany({where:{communityId:f.community.id}})).toMatchObject([{providerUserId:f.providers[0].id,createdByUserId:f.admin.id}]);
 const key=`award-rejected:${f.requestId}:${f.providers[1].id}`;
 expect(await first.notification.count({where:{dedupeKey:key}})).toBe(1);
 const mail=await first.outboxEvent.findMany({where:{dedupeKey:`email:${key}`}});expect(mail).toHaveLength(1);
 expect(mail[0].payload).toMatchObject({subject:"Bid not selected",to:f.providers[1].email});
});
