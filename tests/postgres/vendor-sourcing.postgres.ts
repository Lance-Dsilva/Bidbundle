import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { PrismaPg } from "@prisma/adapter-pg";
import { Client as PgClient, Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { credentialClaimSnapshot, providerVerificationSelect, providerVerificationState } from "@/lib/provider-verification";
import { hoaRequestCreateSchema, bidSubmitSchema } from "@/lib/validation/hoa";
import { vendorImportSchema, vendorLeadSchema } from "@/lib/validation/vendor-sourcing";
import type { PoolQuote, PoolTemplate } from "@/lib/pool-bid-template";

const state = vi.hoisted(() => ({
  client: null as (() => PrismaClient) | null, drain: vi.fn(), after: vi.fn(), send: vi.fn(),
  clerkUsers: new Map<string, unknown>(),
}));
// Database routing only; SQL authorization, constraints, locks and rows are real.
vi.mock("@/lib/server/db", () => ({ db: new Proxy({}, { get(_target, key) {
  const db = state.client?.(); if (!db) throw new Error("Owned issue59 client is not initialized.");
  const value = Reflect.get(db, key, db); return typeof value === "function" ? value.bind(db) : value;
} }) }));
vi.mock("@clerk/nextjs/server", () => ({ clerkClient: async () => ({ users: { getUser: async (id: string) => {
  const user = state.clerkUsers.get(id); if (!user) throw new Error("No synthetic verified Clerk fixture."); return user;
} } }) }));
vi.mock("next/server", async actual => ({ ...await actual<typeof import("next/server")>(), after: state.after }));
vi.mock("@/lib/server/notifications", async actual => ({ ...await actual<typeof import("@/lib/server/notifications")>(), scheduleOutboxDrain: state.drain }));

import {
  addVendorReferral, claimVendorInvitation, getPublicBidSummary, importCslbLeads, ingestResendWebhook,
  inviteVendorBatch, listRequestSourcing, listVendorLeads, markProposalStarted, resolveVendorOutreach,
  submitInvitedProposal, unsubscribeVendor, upsertVendorLead,
} from "@/lib/server/vendor-sourcing";
import { createVendorBidToken, createVendorUnsubscribeToken, vendorEmailDigest } from "@/lib/server/vendor-invitation-tokens";
import { dispatchRegisteredVendorEmail } from "@/lib/server/vendor-outreach";
import { createHoaRequest, respondToOptionalRequest, transitionHoaRequest, submitBid, awardBid, listRequestBids } from "@/lib/server/hoa-market";
import { updateProviderAdministration } from "@/lib/server/providers-admin";

const context = new AsyncLocalStorage<PrismaClient>();
let first: PrismaClient, second: PrismaClient, fixtureIndex = 0, leadIndex = 0;
const pending: Promise<unknown>[] = [];
const releases: Array<() => void> = [];
function client(name: string) { return new PrismaClient({ adapter: new PrismaPg(new Pool({ connectionString: process.env.TEST_DATABASE_URL!, application_name: `issue59-${name}` }), { disposeExternalPool: true }) }); }
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
      const rows = await observer.query("SELECT pid FROM pg_stat_activity WHERE application_name='issue59-second' AND cardinality(pg_blocking_pids(pid))>0");
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
  return first.user.create({ data: { clerkUserId: tag, email, fullName: "Synthetic issue59 actor", role, isVerified: true,
    ...(role === "admin" ? { adminAccess: { create: { email: email.toLowerCase(), status: "active", level: "admin" } } } : {}) } });
}
async function seed() {
  const index = ++fixtureIndex, tag = `vendor59-${index}-${randomUUID()}`;
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
async function lead(f: Fixture, suffix = "one", changes: Record<string, unknown> = {}) {
  const result = await run(first, () => upsertVendorLead(f.admin.id, vendorLeadSchema.parse({ businessName: `${f.tag}-${suffix}`, categories: ["pool_care"], licenseClasses: ["D-35"],
    licenseNumber: `${Date.now()}${++leadIndex}`, licenseStatus: "active", licenseJurisdiction: "CA", licenseExpiresAt: "2099-12-31T00:00:00.000Z",
    email: `${f.tag}-${suffix}@example.invalid`, contactConfirmed: true, latitude: 34.05, longitude: -118.25, ...changes })));
  return result.lead;
}
async function invitation(f: Fixture, item: Awaited<ReturnType<typeof lead>>) {
  await run(first, () => inviteVendorBatch(f.admin.id, f.requestId, { leadIds: [item.id], providerUserIds: [] }));
  const saved = await first.vendorRequestInvitation.findUniqueOrThrow({ where: { leadId_requestId: { leadId: item.id, requestId: f.requestId } } });
  return { row: saved, token: createVendorBidToken(saved.id, saved.tokenNonce) };
}
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
function clerkEmail(user: { clerkUserId: string }, email: string, verified = true) {
  state.clerkUsers.set(user.clerkUserId, { id: user.clerkUserId, primaryEmailAddressId: "synthetic-primary", emailAddresses: [{ id: "synthetic-primary", emailAddress: email, verification: { status: verified ? "verified" : "unverified" } }] });
}

beforeAll(() => {
  const target = new URL(process.env.TEST_DATABASE_URL!);
  if (target.hostname !== "127.0.0.1" || target.port !== "54371" || !/^\/bundleen_issue59_test_[a-z0-9]+$/.test(target.pathname) || !/^bundleen_issue59_runner_[a-z0-9]+$/.test(target.username)) throw new Error("Refusing a non-owned issue59 database.");
  first = client("first"); second = client("second"); state.client = () => context.getStore() ?? first;
});
beforeEach(() => {
  state.send.mockReset(); state.send.mockRejectedValue(new Error("Transport is forbidden unless a test explicitly installs a synthetic Resend response.")); state.drain.mockClear(); state.after.mockClear();
  for (const [key, value] of Object.entries({ RESEND_API_KEY: "synthetic-never-send", VENDOR_OUTREACH_FROM_ADDRESS: "Bundleen <invites@invites.bundleen.example>", VENDOR_OUTREACH_POSTAL_ADDRESS: "1 Synthetic Office, Test City, CA 90001",
    RESEND_WEBHOOK_SECRET: "whsec_aXNzdWU1OS1zeW50aGV0aWMta2V5", VENDOR_INVITE_TOKEN_SECRET: "issue59-synthetic-signing-key-at-least-32-bytes", APP_URL: "https://bundleen.example", VENDOR_OUTREACH_ENABLED: "true", VENDOR_OUTREACH_DOMAIN_READY: "true", VENDOR_OUTREACH_DAILY_LIMIT: "200", VENDOR_OUTREACH_REQUEST_LIMIT: "100" })) vi.stubEnv(key, value);
  vi.stubGlobal("fetch", state.send);
});
afterEach(async () => { for (const release of releases.splice(0)) release(); await Promise.allSettled(pending.splice(0)); for (const [url] of state.send.mock.calls) expect(url).toBe("https://api.resend.com/emails"); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); });
afterAll(async () => { await Promise.all([first?.$disconnect(), second?.$disconnect()]); });

describe("real PostgreSQL vendor intake and authority", () => {
  it("uses distinct owned PostgreSQL sessions with all new sourcing tables", async () => {
    const [a, b] = await Promise.all([first.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`, second.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`]);
    expect(a[0].pid).not.toBe(b[0].pid);
    expect(await first.$queryRaw<Array<{ name: string }>>`SELECT tablename AS name FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'Vendor%'`).toHaveLength(7);
  });
  it("dry-runs native CSLB data without creating leads, then applies only eligible licenses idempotently", async () => {
    const f = await seed();
    const csv = readFileSync(new URL("../fixtures/vendor-sourcing/cslb-native.csv", import.meta.url), "utf8");
    const input = vendorImportSchema.parse({ csv, targetCounties: ["Los Angeles"] });
    const before = await first.vendorLead.count(); await run(first, () => importCslbLeads(f.admin.id, input)); expect(await first.vendorLead.count()).toBe(before);
    await run(first, () => importCslbLeads(f.admin.id, { ...input, dryRun: false })); await run(second, () => importCslbLeads(f.admin.id, { ...input, dryRun: false }));
    const active = await first.vendorLead.findMany({ where: { licenseNumber: { in: ["990001", "990006"] } } });
    expect(active).toHaveLength(2); for (const item of active) expect(item).toMatchObject({ licenseStatus: "active", email: null, contactConfirmed: false });
    expect(await first.vendorLead.count({ where: { licenseNumber: { in: ["990002", "990003", "990004", "990005", "990007", "990008"] }, licenseStatus: "active" } })).toBe(0);
  });
  it("does not grant staff or residents admin intake authority", async () => {
    const f = await seed();
    for (const user of [f.manager, f.residents[0].user]) await expect(run(first, () => listVendorLeads(user.id))).rejects.toMatchObject({ status: 403 });
  });
  it("records a referral only for an authorized request participant and keeps contact approval false", async () => {
    const f = await seed(), outsider = await actor(`${f.tag}-outsider`, "homeowner");
    const input = { businessName: `Fictional referred ${f.tag}`, email: `${f.tag}-referral@example.invalid`, phone: null, notes: null };
    await expect(run(first, () => addVendorReferral(outsider.id, f.requestId, input))).rejects.toMatchObject({ status: 403 });
    await run(first, () => addVendorReferral(f.residents[0].user.id, f.requestId, input));
    await run(first, () => addVendorReferral(f.residents[0].user.id, f.requestId, input));
    const saved = await first.vendorLead.findFirstOrThrow({ where: { email: input.email } });
    expect(saved).toMatchObject({ contactConfirmed: false, source: "resident_referral" });
    expect(await first.vendorLeadReferral.count({ where: { leadId: saved.id, requestId: f.requestId } })).toBe(1);
  });
});

describe("matching and reviewed invitations keep existing provider safeguards", () => {
  it("notifies current matching registered providers when bidding opens, excluding suspended approvals", async () => {
    const f = await seed();
    const matching = await provider(f, "matching"), suspended = await provider(f, "suspended", { approved: true, status: "suspended" });
    const pending = await provider(f, "pending", { verified: false, approved: true }), wrong = await provider(f, "wrong-category", { trades: ["landscaping"] });
    await open(f);
    const view = await run(first, () => listRequestSourcing(f.admin.id, f.requestId));
    expect(view.registered.map(p => p.providerUserId)).toContain(matching.id);
    for (const user of [suspended, pending, wrong]) expect(view.registered.map(p => p.providerUserId)).not.toContain(user.id);
    expect(await first.notification.count({ where: { userId: matching.id, dedupeKey: `provider-bid-invite:${f.requestId}:${matching.id}` } })).toBe(1);
    expect(await first.notification.count({ where: { userId: suspended.id, dedupeKey: `provider-bid-invite:${f.requestId}:${suspended.id}` } })).toBe(0);
  });
  it("reserves one invitation and three bounded message slots under competing repeat batches", async () => {
    const f = await seed(); await open(f); const item = await lead(f);
    const outcomes = await Promise.allSettled([run(first, () => inviteVendorBatch(f.admin.id, f.requestId, { leadIds: [item.id], providerUserIds: [] })), run(second, () => inviteVendorBatch(f.admin.id, f.requestId, { leadIds: [item.id], providerUserIds: [] }))]);
    expect(outcomes.some(result => result.status === "fulfilled")).toBe(true);
    const invites = await first.vendorRequestInvitation.findMany({ where: { leadId: item.id, requestId: f.requestId } }); expect(invites).toHaveLength(1);
    const messages = await first.vendorOutreachMessage.findMany({ where: { invitationId: invites[0].id }, orderBy: { slot: "asc" } });
    expect(messages.map(row => row.slot)).toEqual([0, 1, 2]);
    const rows = await first.outboxEvent.findMany({ where: { kind: "vendor_outreach", payload: { path: ["invitationId"], equals: invites[0].id } } });
    expect(rows).toHaveLength(3); for (const row of rows) expect(JSON.stringify(row.payload)).not.toMatch(/@|token|nonce|PRIVATE_|recipient|phone|street/i);
    expect(state.send).not.toHaveBeenCalled();
  });
  it("does not reserve outreach with missing live configuration", async () => {
    const f = await seed(); await open(f); const item = await lead(f); vi.stubEnv("VENDOR_OUTREACH_DOMAIN_READY", "false");
    await expect(run(first, () => inviteVendorBatch(f.admin.id, f.requestId, { leadIds: [item.id], providerUserIds: [] }))).rejects.toMatchObject({ status: 503 });
    expect(await first.vendorRequestInvitation.count({ where: { leadId: item.id, requestId: f.requestId } })).toBe(0); expect(state.send).not.toHaveBeenCalled();
  });
  it("publishes only the coarse frozen request summary through a purpose-signed expiring invitation", async () => {
    const f = await seed(); await open(f); const item = await lead(f); const invite = await invitation(f, item);
    const summary = await run(first, () => getPublicBidSummary(invite.token));
    expect(summary).toMatchObject({ request: { homeCount: 2, tierCounts: { standard: 1, large: 1 }, requiresAfterPhoto: true } });
    expect(JSON.stringify(summary)).not.toMatch(/PRIVATE_|@example|phone|street|notes|tokenNonce|recipientEmail/);
    await first.vendorRequestInvitation.update({ where: { id: invite.row.id }, data: { expiresAt: new Date(Date.now() - 1) } });
    await expect(run(first, () => getPublicBidSummary(invite.token))).rejects.toMatchObject({ status: 404 });
  });
});

async function invitedActor(f: Fixture, item: Awaited<ReturnType<typeof lead>>, suffix = "claimant") {
  const user = await actor(`${f.tag}-${suffix}`, "provider", item.email!);
  clerkEmail(user, item.email!);
  return user;
}
function syntheticResend() {
  state.send.mockImplementation(async () => Response.json({ id: `synthetic-${randomUUID()}` }));
}
function signedEvent(type: string, providerMessageId: string, id = `synthetic-event-${randomUUID()}`, timestamp = Math.floor(Date.now() / 1000)) {
  const raw = JSON.stringify({ type, created_at: new Date().toISOString(), data: { email_id: providerMessageId } });
  const key = Buffer.from(process.env.RESEND_WEBHOOK_SECRET!.slice(6), "base64");
  const signature = createHmac("sha256", key).update(`${id}.${timestamp}.${raw}`).digest("base64");
  return { raw, headers: { "svix-id": id, "svix-timestamp": String(timestamp), "svix-signature": `v1,${signature}` }, id };
}

describe("public claim and proposal permission remain narrow", () => {
  it("allows the same verified lead owner to claim another existing request invitation", async () => {
    const f = await seed(), other = await seed(); await open(f); await open(other); const item = await lead(f);
    const a = await invitation(f, item), b = await invitation(other, item), claimant = await invitedActor(f, item);
    await run(first, () => claimVendorInvitation(claimant.id, a.token));
    expect(await run(second, () => claimVendorInvitation(claimant.id, b.token))).toMatchObject({ providerUserId: claimant.id });
  });
  it("rechecks revocation after waiting behind the recipient lock", async () => {
    const f = await seed(); await open(f); const item = await lead(f); const invite = await invitation(f, item), claimant = await invitedActor(f, item);
    const locked = deferred(), release = deferred();
    const holder = run(first, () => first.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'vendor-email:' + invite.row.emailDigest},0))`;
      locked.resolve(); await release.promise;
      await tx.vendorRequestInvitation.update({ where: { id: invite.row.id }, data: { revokedAt: new Date() } });
    }, { timeout: 10000 }));
    await reached(locked);
    const claiming = run(second, () => claimVendorInvitation(claimant.id, invite.token));
    await secondSessionBlocked(); release.resolve(); await holder;
    await expect(claiming).rejects.toMatchObject({ status: 404 });
    expect((await first.vendorRequestInvitation.findUniqueOrThrow({ where: { id: invite.row.id } })).claimedProviderUserId).toBeNull();
  });
  it("rejects wrong email, stale Clerk email, unverified email and non-provider claims", async () => {
    const f = await seed(); await open(f); const item = await lead(f); const invite = await invitation(f, item);
    const wrong = await actor(`${f.tag}-wrong`, "provider"); clerkEmail(wrong, wrong.email);
    await expect(run(first, () => claimVendorInvitation(wrong.id, invite.token))).rejects.toMatchObject({ status: 403 });
    const claimant = await invitedActor(f, item);
    clerkEmail(claimant, "different-current-primary@example.invalid");
    await expect(run(first, () => claimVendorInvitation(claimant.id, invite.token))).rejects.toMatchObject({ status: 403 });
    clerkEmail(claimant, item.email!, false);
    await expect(run(first, () => claimVendorInvitation(claimant.id, invite.token))).rejects.toMatchObject({ status: 403 });
    clerkEmail(f.residents[0].user, f.residents[0].user.email);
    await expect(run(first, () => claimVendorInvitation(f.residents[0].user.id, invite.token))).rejects.toMatchObject({ status: 403 });
    expect((await first.vendorRequestInvitation.findUniqueOrThrow({ where: { id: invite.row.id } })).claimedProviderUserId).toBeNull();
  });
  it("idempotently claims only the invited verified identity and prefills without approving credentials", async () => {
    const f = await seed(); await open(f); const item = await lead(f); const invite = await invitation(f, item), claimant = await invitedActor(f, item);
    const results = await Promise.all([run(first, () => claimVendorInvitation(claimant.id, invite.token)), run(second, () => claimVendorInvitation(claimant.id, invite.token))]);
    for (const result of results) expect(result).toMatchObject({ providerUserId: claimant.id, verificationPending: true });
    const profile = await first.providerProfile.findUniqueOrThrow({ where: { userId: claimant.id }, select: { companyName: true, ...providerVerificationSelect } });
    expect(profile.companyName).toBe(item.businessName); expect(providerVerificationState(profile).verified).toBe(false);
    expect(await first.adminAuditLog.count({ where: { actorUserId: claimant.id, action: "vendor_invitation_claimed" } })).toBe(1);
  });
  it("stores an invited pending-verification proposal but cannot submit normally or award it", async () => {
    const f = await seed(); await open(f); const item = await lead(f); const invite = await invitation(f, item), claimant = await invitedActor(f, item);
    await run(first, () => claimVendorInvitation(claimant.id, invite.token));
    await expect(run(first, () => submitBid(claimant.id, f.requestId, proposalInput()))).rejects.toBeDefined();
    const bid = await run(first, () => submitInvitedProposal(claimant.id, invite.token, proposalInput()));
    const saved = await first.serviceBid.findUniqueOrThrow({ where: { id: bid.id } });
    expect(saved).toMatchObject({ providerUserId: claimant.id, requestId: f.requestId, vendorInvitationId: invite.row.id, status: "submitted", amountCents: 90012 });
    expect((await first.vendorRequestInvitation.findUniqueOrThrow({ where: { id: invite.row.id } })).submittedAt).not.toBeNull();
    await expect(run(first, () => awardBid(f.manager.id, f.requestId, { bidId: bid.id, expectedBidVersion: saved.version }))).rejects.toBeDefined();
    expect(await first.serviceAgreement.count({ where: { requestId: f.requestId } })).toBe(0);
  });
  it("does not let a different provider submit through someone else's invitation", async () => {
    const f = await seed(); await open(f); const item = await lead(f); const invite = await invitation(f, item), claimant = await invitedActor(f, item);
    await run(first, () => claimVendorInvitation(claimant.id, invite.token));
    const outsider = await provider(f, "other");
    await expect(run(first, () => submitInvitedProposal(outsider.id, invite.token, proposalInput()))).rejects.toMatchObject({ status: 403 });
    expect(await first.serviceBid.count({ where: { requestId: f.requestId } })).toBe(0);
  });
  it("withdraws proposal eligibility if the invited license becomes inactive", async () => {
    const f = await seed(); await open(f); const item = await lead(f); const invite = await invitation(f, item), claimant = await invitedActor(f, item);
    await run(first, () => claimVendorInvitation(claimant.id, invite.token));
    await first.vendorLead.update({ where: { id: item.id }, data: { licenseStatus: "inactive" } });
    await expect(run(first, () => submitInvitedProposal(claimant.id, invite.token, proposalInput()))).rejects.toBeDefined();
    expect(await first.serviceBid.count({ where: { requestId: f.requestId } })).toBe(0);
  });
});

describe("registered invitation delivery rechecks eligibility", () => {
  async function queued(f: Fixture, user: Awaited<ReturnType<typeof actor>>) {
    const row = await first.outboxEvent.findUniqueOrThrow({ where: { dedupeKey: `email:provider-bid-invite:${f.requestId}:${user.id}` } });
    const payload = row.payload as { to: string; subject: string; text: string };
    return { ...payload, idempotencyKey: row.dedupeKey, requestId: f.requestId, providerUserId: user.id };
  }
  it("skips a queued registered provider after account suspension", async () => {
    const f = await seed(), user = await provider(f, "registered-suspend"); await open(f); const message = await queued(f, user);
    const profile = await first.providerProfile.findUniqueOrThrow({ where: { userId: user.id } });
    await run(first, () => updateProviderAdministration(f.admin, user.id, { accountStatus: "suspended", expectedUpdatedAt: profile.updatedAt.toISOString() }));
    expect(await run(first, () => dispatchRegisteredVendorEmail(message))).toMatchObject({ skipped: true }); expect(state.send).not.toHaveBeenCalled();
  });
  it("skips a queued registered provider whose service area no longer covers the request", async () => {
    const f = await seed(), user = await provider(f, "registered-coverage"); await open(f); const message = await queued(f, user);
    await first.providerServiceArea.updateMany({ where: { providerUserId: user.id }, data: { centerLatitude: 0, centerLongitude: 0, postalCodes: [] } });
    expect(await run(first, () => dispatchRegisteredVendorEmail(message))).toMatchObject({ skipped: true }); expect(state.send).not.toHaveBeenCalled();
  });
  it("honors a global cold-email opt-out for registered invitation delivery too", async () => {
    const f = await seed(), user = await provider(f, "registered-optout"); await open(f); const message = await queued(f, user);
    await run(first, () => unsubscribeVendor(createVendorUnsubscribeToken(vendorEmailDigest(user.email))));
    expect(await run(first, () => dispatchRegisteredVendorEmail(message))).toMatchObject({ skipped: true }); expect(state.send).not.toHaveBeenCalled();
  });
  it("delivers legacy pool trades and maps registered-provider bounces to the same suppression registry", async () => {
    const f = await seed(), user = await provider(f, "registered-bounce", { trades: ["pool_cleaning"] }); await open(f); const message = await queued(f, user);
    vi.stubEnv("EMAIL_FROM_ADDRESS", "notifications@bundleen.example"); syntheticResend();
    const delivery = await run(first, () => dispatchRegisteredVendorEmail(message)); expect(delivery.providerMessageId).toBeTruthy();
    await first.outboxEvent.update({ where: { dedupeKey: message.idempotencyKey }, data: { providerMessageId: delivery.providerMessageId } });
    const bounce = signedEvent("email.bounced", delivery.providerMessageId!);
    await run(first, () => ingestResendWebhook(bounce.raw, bounce.headers));
    expect((await first.vendorEmailSuppression.findUniqueOrThrow({ where: { emailDigest: vendorEmailDigest(user.email) } })).reason).toBe("bounced");
    expect(state.send).toHaveBeenCalledOnce();
  });
});

describe("durable outreach limits and global suppression", () => {
  it("serializes a simultaneous unsubscribe with delivery, then prevents further sends", async () => {
    const f = await seed(); await open(f); const item = await lead(f); const invite = await invitation(f, item);
    const sending = deferred(), release = deferred();
    state.send.mockImplementation(async () => { sending.resolve(); await release.promise; return Response.json({ id: `synthetic-${randomUUID()}` }); });
    const delivery = run(first, () => resolveVendorOutreach(invite.row.id, 0)); await reached(sending);
    const optout = run(second, () => unsubscribeVendor(createVendorUnsubscribeToken(invite.row.emailDigest)));
    await secondSessionBlocked(); release.resolve(); await delivery; await optout;
    expect(await run(first, () => resolveVendorOutreach(invite.row.id, 0))).toMatchObject({ skipped: true });
    expect(state.send).toHaveBeenCalledOnce();
    expect(await first.vendorEmailSuppression.count({ where: { emailDigest: invite.row.emailDigest } })).toBe(1);
  });
  it("keeps a per-request invitation cap under competing batches and rolls back the rejected reservation", async () => {
    const f = await seed(); await open(f); const a = await lead(f, "cap-a"), b = await lead(f, "cap-b");
    vi.stubEnv("VENDOR_OUTREACH_REQUEST_LIMIT", "1");
    const outcomes = await Promise.allSettled([run(first, () => inviteVendorBatch(f.admin.id, f.requestId, { leadIds: [a.id], providerUserIds: [] })), run(second, () => inviteVendorBatch(f.admin.id, f.requestId, { leadIds: [b.id], providerUserIds: [] }))]);
    expect(outcomes.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(await first.vendorRequestInvitation.count({ where: { requestId: f.requestId } })).toBe(1);
    expect((await first.vendorOutreachBudget.findUniqueOrThrow({ where: { key: `request:${f.requestId}` } })).used).toBe(1);
    expect(state.send).not.toHaveBeenCalled();
  });
  it("suppresses an address across every request and rejects future batches immediately", async () => {
    const f = await seed(), other = await seed(); await open(f); await open(other); const item = await lead(f);
    const firstInvite = await invitation(f, item), secondInvite = await invitation(other, item);
    const optout = createVendorUnsubscribeToken(vendorEmailDigest(item.email!));
    await Promise.all([run(first, () => unsubscribeVendor(optout)), run(second, () => unsubscribeVendor(optout))]);
    expect(await first.vendorEmailSuppression.count({ where: { emailDigest: vendorEmailDigest(item.email!) } })).toBe(1);
    for (const invite of [firstInvite, secondInvite]) {
      await expect(run(first, () => getPublicBidSummary(invite.token))).rejects.toMatchObject({ status: 404 });
      expect(await run(first, () => resolveVendorOutreach(invite.row.id, 0))).toMatchObject({ providerMessageId: null, skipped: true });
    }
    const next = await seed(); await open(next);
    await expect(run(first, () => inviteVendorBatch(next.admin.id, next.requestId, { leadIds: [item.id], providerUserIds: [] }))).rejects.toBeDefined();
    expect(state.send).not.toHaveBeenCalled();
  });
  it("persists a single send and stable idempotency key under concurrent repeated workers", async () => {
    const f = await seed(); await open(f); const item = await lead(f); const invite = await invitation(f, item); syntheticResend();
    const outcomes = await Promise.all([run(first, () => resolveVendorOutreach(invite.row.id, 0)), run(second, () => resolveVendorOutreach(invite.row.id, 0))]);
    expect(state.send).toHaveBeenCalledOnce();
    expect(outcomes.some(result => !!result.providerMessageId)).toBe(true);
    const [url, options] = state.send.mock.calls[0]; expect(url).toBe("https://api.resend.com/emails");
    expect(new Headers(options.headers).get("Idempotency-Key")).toBeTruthy();
    const body = JSON.parse(options.body);
    expect(body.to).toContain(item.email); expect(body.text).toContain("1 Synthetic Office");
    expect(JSON.stringify(body)).toContain("vendor-unsubscribe"); expect(JSON.stringify(body)).not.toMatch(/PRIVATE_|PRIVATE_RESIDENT_STREET/);
    const message = await first.vendorOutreachMessage.findUniqueOrThrow({ where: { invitationId_slot: { invitationId: invite.row.id, slot: 0 } } });
    expect(message.status).toBe("sent"); expect(message.firstAttemptAt).not.toBeNull();
  });
  it("does not send reminders early or after the invitation has been opened", async () => {
    const f = await seed(); await open(f); const item = await lead(f); const invite = await invitation(f, item);
    await expect(run(first, () => resolveVendorOutreach(invite.row.id, 1))).rejects.toMatchObject({ status: 409 });
    expect(state.send).not.toHaveBeenCalled();
    syntheticResend(); await run(first, () => resolveVendorOutreach(invite.row.id, 0)); state.send.mockClear();
    await first.vendorRequestInvitation.update({ where: { id: invite.row.id }, data: { openedAt: new Date() } });
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(Date.now() + 7 * 86400000 + 1000));
    expect(await run(first, () => resolveVendorOutreach(invite.row.id, 2))).toMatchObject({ providerMessageId: null, skipped: true });
    expect(state.send).not.toHaveBeenCalled();
  });
  it("rechecks inactive licenses immediately before send", async () => {
    const f = await seed(); await open(f); const item = await lead(f); const invite = await invitation(f, item);
    await first.vendorLead.update({ where: { id: item.id }, data: { licenseStatus: "inactive" } });
    expect(await run(first, () => resolveVendorOutreach(invite.row.id, 0))).toMatchObject({ providerMessageId: null, skipped: true });
    expect(state.send).not.toHaveBeenCalled();
  });
  it("reuses the committed original body and key after an ambiguous network error", async () => {
    const f = await seed(); await open(f); const item = await lead(f); const invite = await invitation(f, item);
    state.send.mockRejectedValueOnce(new Error("Synthetic response lost after remote acceptance"));
    await expect(run(first, () => resolveVendorOutreach(invite.row.id, 0))).rejects.toThrow("response lost");
    const attempted = await first.vendorOutreachMessage.findUniqueOrThrow({ where: { invitationId_slot: { invitationId: invite.row.id, slot: 0 } } });
    expect(attempted.status).toBe("pending"); expect(attempted.firstAttemptAt).not.toBeNull(); expect(attempted.payload).not.toBeNull();
    vi.stubEnv("VENDOR_OUTREACH_POSTAL_ADDRESS", "2 Changed Synthetic Office, Test City, CA 90002");
    state.send.mockResolvedValueOnce(Response.json({ id: `synthetic-${randomUUID()}` }));
    await run(second, () => resolveVendorOutreach(invite.row.id, 0));
    expect(state.send).toHaveBeenCalledTimes(2);
    expect(state.send.mock.calls[0][1].body).toBe(state.send.mock.calls[1][1].body);
    expect(new Headers(state.send.mock.calls[0][1].headers).get("Idempotency-Key")).toBe(new Headers(state.send.mock.calls[1][1].headers).get("Idempotency-Key"));
  });
  it("stops ambiguous retries before the provider key expires and never reminds without an acknowledged first send", async () => {
    const f = await seed(); await open(f); const item = await lead(f); const invite = await invitation(f, item);
    state.send.mockRejectedValueOnce(new Error("Synthetic network loss"));
    await expect(run(first, () => resolveVendorOutreach(invite.row.id, 0))).rejects.toThrow("network loss");
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(Date.now() + 23 * 60 * 60 * 1000 + 1000));
    expect(await run(second, () => resolveVendorOutreach(invite.row.id, 0))).toMatchObject({ skipped: true });
    expect((await first.vendorOutreachMessage.findUniqueOrThrow({ where: { invitationId_slot: { invitationId: invite.row.id, slot: 0 } } })).status).toBe("uncertain");
    vi.setSystemTime(new Date(Date.now() + 3 * 86400000));
    expect(await run(second, () => resolveVendorOutreach(invite.row.id, 1))).toMatchObject({ skipped: true });
    expect(state.send).toHaveBeenCalledOnce();
  });
});

describe("database guard regressions independent of HTTP services", () => {
  it("rejects a non-admin direct invitation and prevents recipient or nonce retargeting", async () => {
    const f = await seed(); await open(f); const item = await lead(f); const invite = await invitation(f, item);
    for (const data of [{ recipientEmail: "attacker@example.invalid" }, { tokenNonce: "forged-nonce-that-is-long-enough" }, { expiresAt: new Date(+invite.row.expiresAt + 1) }]) {
      await expect(first.vendorRequestInvitation.update({ where: { id: invite.row.id }, data })).rejects.toBeDefined();
    }
    const other = await lead(f, "direct");
    await expect(first.vendorRequestInvitation.create({ data: { id: randomUUID(), leadId: other.id, requestId: f.requestId, invitedByUserId: f.manager.id,
      recipientEmail: other.email!, emailDigest: vendorEmailDigest(other.email!), tokenNonce: "synthetic-nonce-at-least-24-characters", expiresAt: invite.row.expiresAt } })).rejects.toBeDefined();
    expect(await first.vendorRequestInvitation.count({ where: { requestId: f.requestId } })).toBe(1);
  });
  it("cannot create a fourth message, rewrite a due time or erase a global opt-out", async () => {
    const f = await seed(); await open(f); const item = await lead(f); const invite = await invitation(f, item);
    await expect(first.vendorOutreachMessage.create({ data: { invitationId: invite.row.id, slot: 3, dueAt: new Date() } })).rejects.toBeDefined();
    await expect(first.vendorOutreachMessage.update({ where: { invitationId_slot: { invitationId: invite.row.id, slot: 1 } }, data: { dueAt: new Date() } })).rejects.toBeDefined();
    await run(first, () => unsubscribeVendor(createVendorUnsubscribeToken(invite.row.emailDigest)));
    await expect(first.vendorEmailSuppression.delete({ where: { emailDigest: invite.row.emailDigest } })).rejects.toBeDefined();
  });
});

describe("signed Resend events are replay-safe and globally suppress bounces", () => {
  it("reconciles an event arriving before the transport response persisted the message id", async () => {
    const f = await seed(); await open(f); const item = await lead(f); const invite = await invitation(f, item);
    const providerId = `synthetic-${randomUUID()}`, delivered = signedEvent("email.delivered", providerId);
    state.send.mockImplementation(async () => {
      await run(second, () => ingestResendWebhook(delivered.raw, delivered.headers));
      expect((await second.vendorWebhookEvent.findUniqueOrThrow({ where: { id: delivered.id } })).processedAt).toBeNull();
      return Response.json({ id: providerId });
    });
    await run(first, () => resolveVendorOutreach(invite.row.id, 0));
    expect((await first.vendorWebhookEvent.findUniqueOrThrow({ where: { id: delivered.id } })).processedAt).not.toBeNull();
    expect((await first.vendorOutreachMessage.findUniqueOrThrow({ where: { providerMessageId: providerId } })).deliveredAt).not.toBeNull();
  });
  it("rejects forged, mutated and expired signatures without writing event rows", async () => {
    const sample = signedEvent("email.opened", "synthetic-unknown");
    const expired = signedEvent("email.opened", "synthetic-unknown", `expired-${randomUUID()}`, Math.floor(Date.now() / 1000) - 3600);
    for (const [raw, headers] of [[sample.raw + " ", sample.headers], [sample.raw, { ...sample.headers, "svix-signature": "v1,forged" }], [expired.raw, expired.headers]] as const) await expect(run(first, () => ingestResendWebhook(raw, headers))).rejects.toBeDefined();
    expect(await first.vendorWebhookEvent.count({ where: { id: { in: [sample.id, expired.id] } } })).toBe(0);
  });
  it("processes concurrent opened-event replays once and suppresses all invitation mail on bounce", async () => {
    const f = await seed(); await open(f); const item = await lead(f); const invite = await invitation(f, item); syntheticResend();
    const delivery = await run(first, () => resolveVendorOutreach(invite.row.id, 0)); expect(delivery.providerMessageId).toBeTruthy();
    const opened = signedEvent("email.opened", delivery.providerMessageId!);
    await Promise.all([run(first, () => ingestResendWebhook(opened.raw, opened.headers)), run(second, () => ingestResendWebhook(opened.raw, opened.headers))]);
    expect(await first.vendorWebhookEvent.count({ where: { id: opened.id } })).toBe(1);
    expect((await first.vendorRequestInvitation.findUniqueOrThrow({ where: { id: invite.row.id } })).openedAt).not.toBeNull();
    const bounced = signedEvent("email.bounced", delivery.providerMessageId!);
    await run(first, () => ingestResendWebhook(bounced.raw, bounced.headers));
    expect((await first.vendorEmailSuppression.findUniqueOrThrow({ where: { emailDigest: vendorEmailDigest(item.email!) } })).reason).toBe("bounced");
    expect((await first.vendorLead.findUniqueOrThrow({ where: { id: item.id } })).status).toBe("bounced");
    expect(state.send).toHaveBeenCalledOnce();
  });
});
