import "server-only";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { buildAuditEntry } from "@/lib/server/audit";
import { db } from "@/lib/server/db";
import { HoaWorkflowError } from "@/lib/server/hoa";
import { publicSharingEnabled, validShareToken, PUBLIC_REQUEST_STATUSES } from "@/lib/server/public-request-sharing";
import { CATEGORY_LABELS, normalizeServiceCategory } from "@/lib/service-categories";
import { getEnrollmentBillingOffer, startEnrollmentBilling, confirmEnrollmentBilling } from "@/lib/server/enrollment-billing";

export type SharedEnrollmentAddress = { addressLine1: string; locality: string; region: string; postalCode: string; unitLabel?: string };
export type SharedEnrollmentState = { stage: "address" | "card" | "joined" | "review" | "closed"; requestPath: string; service: string; expiresAt: string; ownAddress?: SharedEnrollmentAddress; message?: string };
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const unavailable = () => new HoaWorkflowError("This enrollment link is unavailable. Open the shared request again.", 404);
const normalize = (value: string | null | undefined) => (value ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
function enabled() { if (!publicSharingEnabled()) throw unavailable(); }

/** Request first matches publication/rotation and enrollment's existing lock order. */
async function context(tx: Prisma.TransactionClient, token: string, userId?: string, lock = false, exclusiveUser = false) {
  enabled();
  if (!validShareToken(token)) throw unavailable();
  let flow = await tx.sharedEnrollmentFlow.findUnique({ where: { token } });
  if (!flow) throw unavailable();
  if (lock) {
    await tx.$queryRaw`SELECT "id" FROM "HoaServiceRequest" WHERE "id"=${flow.requestId} FOR UPDATE`;
    if (userId) {
      if (exclusiveUser) await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id"=${userId} FOR UPDATE`;
      else await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id"=${userId} FOR SHARE`;
    }
    await tx.$queryRaw`SELECT "token" FROM "SharedEnrollmentFlow" WHERE "token"=${token} FOR UPDATE`;
    flow = await tx.sharedEnrollmentFlow.findUniqueOrThrow({ where: { token } });
  }
  const request = await tx.hoaServiceRequest.findUnique({ where: { id: flow.requestId }, include: { publicShare: true, community: { include: { publicShare: true, hoaProfile: true } }, priceCommitment: true } });
  if (!request || flow.expiresAt <= new Date() || !request.publicShare?.enabled || request.kind !== "optional_group" || !(PUBLIC_REQUEST_STATUSES as readonly string[]).includes(request.status) || request.community.type !== "hoa" || request.community.status !== "active" ||
      !request.community.publicShare || hash(request.publicShare.token) !== flow.requestTokenHash || hash(request.community.publicShare.token) !== flow.communityTokenHash) throw unavailable();
  const user = userId ? await tx.user.findUnique({ where: { id: userId } }) : null;
  if (userId && (!user || !user.isVerified || user.role !== "homeowner" || (flow.userId && flow.userId !== userId))) throw unavailable();
  return { flow, request, user, path: `/c/${request.community.publicShare.token}/r/${request.publicShare.token}` };
}
function open(c: Awaited<ReturnType<typeof context>>) {
  return c.request.status === "collecting_interest" && !c.request.participantsLockedAt && !!c.request.priceCommitment?.acceptedAt && (!c.request.enrollmentClosesAt || c.request.enrollmentClosesAt > new Date());
}
async function membership(tx: Prisma.TransactionClient, userId: string, communityId: string) {
  return tx.communityMembership.findFirst({ where: { userId, communityId, status: "active", unitId: { not: null }, unit: { occupancyStatus: "occupied" } }, include: { unit: true } });
}
function address(unit: {addressLine1:string|null;locality:string|null;region:string|null;postalCode:string|null;label:string}, community: {hoaProfile: {addressLine1:string;locality:string;region:string;postalCode:string}|null}): SharedEnrollmentAddress {
  return { addressLine1: unit.addressLine1 ?? community.hoaProfile?.addressLine1 ?? "", locality: unit.locality ?? community.hoaProfile?.locality ?? "", region: unit.region ?? community.hoaProfile?.region ?? "", postalCode: unit.postalCode ?? community.hoaProfile?.postalCode ?? "", unitLabel: unit.label };
}
function matches(input: SharedEnrollmentAddress, expected: SharedEnrollmentAddress) {
  return ["addressLine1", "locality", "region", "postalCode"].every(key => normalize(input[key as keyof SharedEnrollmentAddress]) !== "" && normalize(input[key as keyof SharedEnrollmentAddress]) === normalize(expected[key as keyof SharedEnrollmentAddress])) && (!input.unitLabel || normalize(input.unitLabel) === normalize(expected.unitLabel));
}
async function state(tx: Prisma.TransactionClient, c: Awaited<ReturnType<typeof context>>, userId: string): Promise<SharedEnrollmentState> {
  const own = await membership(tx, userId, c.request.communityId);
  const joined = own && await tx.hoaRequestParticipation.findFirst({ where: { requestId: c.request.id, unitId: own.unitId, userId, response: "joined" } });
  const category = normalizeServiceCategory(c.request.category);
  return { stage: joined ? "joined" : !open(c) ? "closed" : own && c.flow.confirmedMembershipId === own.id && c.flow.confirmedUnitId === own.unitId ? "card" : "address", requestPath: c.path, service: category ? CATEGORY_LABELS[category] : "Community service", expiresAt: c.flow.expiresAt.toISOString(), ...(own?.unit ? { ownAddress: address(own.unit, c.request.community) } : {}) };
}
export async function createSharedEnrollmentFlow(communityToken: string, requestToken: string) {
  enabled();
  if (!validShareToken(communityToken) || !validShareToken(requestToken)) throw unavailable();
  const share = await db.requestPublicShare.findUnique({ where: { token: requestToken } });
  if (!share) throw unavailable();
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "HoaServiceRequest" WHERE "id"=${share.requestId} FOR UPDATE`;
    const token = randomBytes(24).toString("base64url"), createdAt = new Date(), expiresAt = new Date(createdAt.getTime() + 2 * 60 * 60 * 1000);
    await tx.sharedEnrollmentFlow.create({ data: { token, requestId: share.requestId, communityTokenHash: hash(communityToken), requestTokenHash: hash(requestToken), consentId: randomUUID(), createdAt, expiresAt } });
    const c = await context(tx, token);
    return { token, path: `${c.path}/join`, expiresAt };
  });
}
export async function getSharedEnrollmentReturnPath(token: string) {
  try { return `${(await context(db, token)).path}/join`; } catch (error) { if (error instanceof HoaWorkflowError && error.status === 404) return null; throw error; }
}
export async function claimSharedEnrollmentFlow(userId: string, token: string) {
  return db.$transaction(async tx => { const c = await context(tx, token, userId, true); if (!c.flow.userId) c.flow = await tx.sharedEnrollmentFlow.update({ where: { token }, data: { userId } }); return state(tx, c, userId); });
}
export async function getSharedEnrollmentState(userId: string, token: string) {
  return db.$transaction(async tx => { const c = await context(tx, token, userId, true); if (c.flow.userId !== userId) throw unavailable(); return state(tx, c, userId); });
}
export async function confirmSharedEnrollmentAddress(userId: string, token: string, input: SharedEnrollmentAddress) {
  if (!input || [input.addressLine1, input.locality, input.region, input.postalCode].some(v => typeof v !== "string" || !v.trim() || v.length > 200) || (input.unitLabel !== undefined && (typeof input.unitLabel !== "string" || input.unitLabel.length > 200))) throw new HoaWorkflowError("Enter your complete home address.", 400);
  return db.$transaction(async tx => {
    const c = await context(tx, token, userId, true, true);
    if (c.flow.userId !== userId) throw unavailable();
    if (!open(c)) return state(tx, c, userId);
    await tx.$queryRaw`SELECT "id" FROM "Community" WHERE "id"=${c.request.communityId} FOR SHARE`;
    let own = await membership(tx, userId, c.request.communityId);
    const review = async (): Promise<SharedEnrollmentState> => ({ ...(await state(tx, c, userId)), stage: "review", message: "Ask your community manager to confirm your home and invitation, then return to this request." });
    if (!own) {
      const candidates = await tx.communityInvitation.findMany({ take: 2, where: { communityId: c.request.communityId, email: { equals: c.user!.email, mode: "insensitive" }, role: "homeowner", status: "pending", unitId: { not: null }, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } });
      const candidate = candidates.length === 1 ? candidates[0] : null;
      if (!candidate?.unitId) return review();
      await tx.$queryRaw`SELECT "id" FROM "CommunityInvitation" WHERE "id"=${candidate.id} FOR UPDATE`;
      await tx.$queryRaw`SELECT "id" FROM "CommunityUnit" WHERE "id"=${candidate.unitId} FOR UPDATE`;
      const invite = await tx.communityInvitation.findUnique({ where: { id: candidate.id }, include: { unit: true } });
      if (!invite?.unit || !["vacant", "invite_pending"].includes(invite.unit.occupancyStatus) || invite.status !== "pending" || invite.role !== "homeowner" || invite.revokedAt || invite.acceptedByUserId || (invite.expiresAt && invite.expiresAt <= new Date()) || invite.communityId !== c.request.communityId || normalize(invite.email) !== normalize(c.user!.email) || invite.unit.communityId !== c.request.communityId || !matches(input, address(invite.unit, c.request.community))) return review();
      if (await tx.communityMembership.findFirst({ where: { status: "active", OR: [{ unitId: invite.unitId, userId: { not: userId } }, { userId, communityId: { not: c.request.communityId } }] } })) return review();
      const existing = await tx.communityMembership.findUnique({ where: { communityId_userId: { communityId: c.request.communityId, userId } } });
      if (existing) return review(); // A revoked or different prior home needs explicit manager review.
      await tx.communityUnit.update({ where: { id: invite.unit.id }, data: { occupancyStatus: "occupied" } });
      await tx.communityMembership.create({ data: { id: randomUUID(), communityId: c.request.communityId, userId, unitId: invite.unit.id, status: "active", isPrimary: true, joinedAt: new Date() } });
      await tx.communityInvitation.update({ where: { id: invite.id }, data: { status: "accepted", acceptedByUserId: userId, acceptedAt: new Date() } });
      await tx.adminAuditLog.create({ data: buildAuditEntry({ actorUserId: userId, action: "community_invitation_accepted", targetType: "community_invitation", targetId: invite.id, communityId: c.request.communityId, metadata: { role: "homeowner", status: "accepted" } }) });
      own = await membership(tx, userId, c.request.communityId);
    }
    if (!own?.unit) return review();
    await tx.$queryRaw`SELECT "id" FROM "CommunityMembership" WHERE "id"=${own.id} FOR SHARE`;
    await tx.$queryRaw`SELECT "id" FROM "CommunityUnit" WHERE "id"=${own.unit.id} FOR SHARE`;
    own = await membership(tx, userId, c.request.communityId);
    if (!own?.unit || !matches(input, address(own.unit, c.request.community))) return review();
    c.flow = await tx.sharedEnrollmentFlow.update({ where: { token }, data: { confirmedMembershipId: own.id, confirmedUnitId: own.unit.id } });
    return state(tx, c, userId);
  });
}
async function authorized(tx: Prisma.TransactionClient, userId: string, token: string) {
  const c = await context(tx, token, userId, true);
  const own = await membership(tx, userId, c.request.communityId);
  if (c.flow.userId !== userId || !own || c.flow.confirmedMembershipId !== own.id || c.flow.confirmedUnitId !== own.unitId) throw new HoaWorkflowError("Confirm your current home before enrolling.", 409);
  return c;
}
export async function getSharedEnrollmentOffer(userId: string, token: string) {
  const c = await db.$transaction(tx => authorized(tx, userId, token));
  return getEnrollmentBillingOffer(userId, c.request.id);
}
export async function startSharedEnrollmentBilling(userId: string, token: string, input: { accepted: true; termsToken: string; savedCardReference?: string }) {
  if (input.accepted !== true) throw new HoaWorkflowError("Accept the maximum price and payment terms first.", 400);
  const c = await db.$transaction(tx => authorized(tx, userId, token));
  return startEnrollmentBilling(userId, c.request.id, c.flow.consentId, input.termsToken, input.savedCardReference, async tx => { const current = await authorized(tx, userId, token); if (current.flow.consentId !== c.flow.consentId) throw new HoaWorkflowError("Card enrollment was restarted. Review the current card step.", 409); });
}
export async function confirmSharedEnrollmentBilling(userId: string, token: string, setupIntentId: string) {
  const c = await db.$transaction(tx => authorized(tx, userId, token));
  await confirmEnrollmentBilling(userId, c.request.id, c.flow.consentId, setupIntentId, async tx => { const current = await authorized(tx, userId, token); if (current.flow.consentId !== c.flow.consentId) throw new HoaWorkflowError("Card enrollment was restarted. Review the current card step.", 409); });
  return { joined: true, path: `${c.path}/join` };
}

export async function restartSharedEnrollmentBilling(userId: string, token: string) {
  return db.$transaction(async tx => {
    const c = await authorized(tx, userId, token);
    if (!open(c) || await tx.hoaRequestParticipation.findFirst({ where: { requestId: c.request.id, unitId: c.flow.confirmedUnitId, response: "joined" } })) throw new HoaWorkflowError("This enrollment cannot be restarted.", 409);
    await tx.enrollmentBillingConsent.updateMany({ where: { id: c.flow.consentId, payerUserId: userId, revokedAt: null }, data: { revokedAt: new Date() } });
    await tx.sharedEnrollmentFlow.update({ where: { token }, data: { consentId: randomUUID() } });
    return { restarted: true };
  });
}
