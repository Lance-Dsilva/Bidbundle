import "server-only";
import { randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/server/db";
import { HoaWorkflowError } from "@/lib/server/hoa";
import { validatePriceLadder, ladderUnlockDedupeKey } from "@/lib/price-ladder";
import { normalizeServiceCategory, normalizeServiceTrades } from "@/lib/service-categories";

/** Pilot entry of already agreed provider terms; only primary administrators. */
export async function commitPriceLadder(actorId: string, communityId: string, input: { requestId: string; providerUserId: string; scope: string; tiers: unknown; providerAgreementConfirmed: true }) {
  const tiers = validatePriceLadder(input.tiers);
  return db.$transaction(async (tx) => {
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "HoaServiceRequest" WHERE "id"=${input.requestId} FOR UPDATE`);
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "User" WHERE "id"=${actorId} FOR SHARE`);
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "AdminAccessGrant" WHERE "userId"=${actorId} FOR SHARE`);
    const actor = await tx.user.findUnique({ where: { id: actorId }, include: { adminAccess: true } });
    if (actor?.role !== "admin" || !actor.isVerified || actor.adminAccess?.status !== "active" || actor.adminAccess.isStaffAccount || actor.adminAccess.level !== "owner" || actor.adminAccess.email !== actor.email.toLowerCase()) throw new HoaWorkflowError("Primary admin access required.", 403);
    const request = await tx.hoaServiceRequest.findFirst({ where: { id: input.requestId, communityId, community: { status: "active", type: "hoa" } }, include: { _count: { select: { participations: true } } } });
    if (!request || request.kind !== "optional_group" || !["draft", "collecting_interest"].includes(request.status) || request.poolTemplate || request.participantsLockedAt || request._count.participations) throw new HoaWorkflowError("Choose an optional request before enrollment starts.", 409);
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "User" WHERE "id"=${input.providerUserId} FOR SHARE`);
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "ProviderProfile" WHERE "userId"=${input.providerUserId} FOR SHARE`);
    const provider = await tx.user.findUnique({ where: { id: input.providerUserId }, include: { providerProfile: true } });
    const category = normalizeServiceCategory(request.category);
    if (provider?.role !== "provider" || provider.providerProfile?.accountStatus !== "active" || !category || !normalizeServiceTrades(provider.providerProfile.trades).includes(category)) throw new HoaWorkflowError("Choose an active provider offering this service.", 400);
    const id = randomUUID();
    const commitment = await tx.priceLadderCommitment.create({ data: { id, requestId: request.id, providerUserId: provider.id, actorUserId: actorId, scope: input.scope, guaranteedPerHomeCents: tiers[0].perHomeCents, tiers: { create: tiers.map((tier) => ({ id: randomUUID(), ...tier })) } }, include: { tiers: true } });
    // Existing audited action vocabulary; metadata identifies the immutable pilot commitment.
    await tx.adminAuditLog.create({ data: { id: randomUUID(), actorUserId: actorId, action: "hoa_request_status_changed", targetType: "hoa_request", targetId: request.id, communityId, metadata: { requestId: request.id, providerUserId: provider.id, providerAgreementConfirmed: true, terms: "full-term-per-home-cents; discounts retained after withdrawals", tiers } } });
    return commitment;
  });
}

/** Same transaction and request lock as enrollment; durable per-tier delivery identity. */
export async function notifyPriceLadderUnlock(tx: Prisma.TransactionClient, requestId: string, beforePrice: number | null) {
  const commitment = await tx.priceLadderCommitment.findUnique({ where: { requestId }, include: { tiers: true } });
  if (!commitment || beforePrice == null || commitment.guaranteedPerHomeCents >= beforePrice) return;
  const tier = commitment.tiers.find((row) => row.perHomeCents === commitment.guaranteedPerHomeCents);
  if (!tier) throw new Error("Committed price has no corresponding tier");
  const recipients = await tx.hoaRequestParticipation.findMany({ where: { requestId, response: "joined", userId: { not: null } }, select: { user: { select: { id: true, email: true, homeownerProfile: { select: { notifyEmail: true } } } } } });
  const price = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(tier.perHomeCents / 100);
  for (const { user } of recipients) {
    if (!user) continue;
    const dedupeKey = ladderUnlockDedupeKey(commitment.id, tier.minHomes, user.id);
    const title = `Your group price just dropped to ${price}`;
    const body = `${price} per home for the full service term. This lower price is protected even if another home leaves.`;
    await tx.notification.createMany({ data: [{ id: randomUUID(), userId: user.id, kind: "request", title, body, linkPath: "/app/homeowner/community", dedupeKey }], skipDuplicates: true });
    if (user.homeownerProfile?.notifyEmail !== false) await tx.outboxEvent.createMany({ data: [{ id: randomUUID(), kind: "notification_email", dedupeKey: `email:${dedupeKey}`, payload: { to: user.email, subject: title, text: body }, updatedAt: new Date() }], skipDuplicates: true });
  }
}

export async function acceptPriceLadder(providerUserId: string, commitmentId: string) {
 return db.$transaction(async(tx)=>{
  const initial=await tx.priceLadderCommitment.findUnique({where:{id:commitmentId}});
  if(!initial || initial.providerUserId!==providerUserId) throw new HoaWorkflowError("Price commitment not found.",404);
  await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "HoaServiceRequest" WHERE "id"=${initial.requestId} FOR UPDATE`);
  await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "User" WHERE "id"=${providerUserId} FOR SHARE`);
  await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "ProviderProfile" WHERE "userId"=${providerUserId} FOR SHARE`);
  const provider=await tx.user.findUnique({where:{id:providerUserId},include:{providerProfile:true}});
  if(provider?.role!=="provider" || provider.providerProfile?.accountStatus!=="active") throw new HoaWorkflowError("Active provider account required.",403);
  const current=await tx.priceLadderCommitment.findUniqueOrThrow({where:{id:commitmentId},include:{request:true}});
  if(current.acceptedAt) return {acceptedAt:current.acceptedAt.toISOString()};
  if(!["draft","collecting_interest"].includes(current.request.status) || current.request.participantsLockedAt || (current.request.enrollmentClosesAt && current.request.enrollmentClosesAt<=new Date())) throw new HoaWorkflowError("Enrollment window has closed.",409);
  const accepted=await tx.priceLadderCommitment.update({where:{id:commitmentId},data:{acceptedAt:new Date()}});
  return {acceptedAt:accepted.acceptedAt!.toISOString()};
 });
}
