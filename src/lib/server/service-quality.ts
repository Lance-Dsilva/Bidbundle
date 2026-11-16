import "server-only";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/server/db";
import { HoaWorkflowError } from "@/lib/server/hoa";
import { withinQualityReportWindow, serviceQualityReportSchema, serviceQualityResolutionSchema, serviceQualityResponseSchema } from "@/lib/validation/service-quality";
import type { z } from "zod";

function requireEnabled() {
  if (process.env.SERVICE_QUALITY_INTAKE !== "1") throw new HoaWorkflowError("Service quality reporting is not available yet.", 404);
}

export async function reportServiceQuality(userId: string, visitId: string, input: z.infer<typeof serviceQualityReportSchema>) {
  requireEnabled();
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "ServiceVisit" WHERE "id" = ${visitId} FOR UPDATE`;
    const visit = await tx.serviceVisit.findUnique({ where: { id: visitId }, select: {
      id: true, status: true, completedAt: true, unitId: true, homeownerUserId: true,
      occurrence: { select: { agreement: { select: { communityId: true, providerUserId: true, requestId: true, community: { select: { type: true } } } } } },
    } });
    if (!visit) throw new HoaWorkflowError("That visit is unavailable.", 404);
    const agreement = visit.occurrence.agreement;
    await tx.$queryRaw`SELECT "id" FROM "CommunityMembership" WHERE "userId" = ${userId} AND "communityId" = ${agreement.communityId} FOR SHARE`;
    const membership = await tx.communityMembership.findUnique({ where: { communityId_userId: { communityId: agreement.communityId, userId } }, select: { status: true, unitId: true, joinedAt: true, createdAt: true, updatedAt: true } });
    if (!membership || membership.status !== "active" ||
        (visit.completedAt && ((membership.joinedAt ?? membership.createdAt) > visit.completedAt || membership.updatedAt > visit.completedAt)) ||
        (agreement.community.type === "hoa" ? !visit.unitId || membership.unitId !== visit.unitId : visit.homeownerUserId !== userId)) {
      throw new HoaWorkflowError("That visit is unavailable.", 404);
    }
    const prior = await tx.serviceQualityClaim.findUnique({ where: { visitId }, select: { id: true, ticketId: true, requesterUserId: true, resolution: true } });
    if (prior) {
      if (prior.requesterUserId !== userId) throw new HoaWorkflowError("A report is already being reviewed for this visit.", 409);
      return { id: prior.id, ticketId: prior.ticketId, resolution: prior.resolution };
    }
    const [{ now }] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
    if (visit.status !== "completed" || !withinQualityReportWindow(visit.completedAt, now)) {
      throw new HoaWorkflowError("Report a completed visit within 72 hours. Contact support for older visits.", 409);
    }
    const id = randomUUID(), ticketId = randomUUID();
    await tx.supportTicket.create({ data: {
      id: ticketId, ticketNumber: `QUALITY-${id}`, requesterUserId: userId, requesterRole: "homeowner",
      communityId: agreement.communityId, category: "service_quality", subject: "Problem with a completed service visit",
      relatedVisitId: visitId, relatedRequestId: agreement.requestId, lastCustomerMessageAt: now, lastActivityAt: now,
      messages: { create: { id: randomUUID(), authorUserId: userId, kind: "customer_reply", body: input.description } },
      events: { create: { id: randomUUID(), actorUserId: userId, type: "created", toValue: "new" } },
    } });
    await tx.serviceQualityClaim.create({ data: { id, visitId, ticketId, requesterUserId: userId, providerUserId: agreement.providerUserId, reason: input.reason, createdAt: now } });
    await tx.notification.createMany({ data: [
      { id: randomUUID(), userId, kind: "request", title: "Visit problem reported", body: "Your service quality report is in the support queue.", linkPath: "/app/support", dedupeKey: `quality:${id}:resident` },
      { id: randomUUID(), userId: agreement.providerUserId, kind: "request", title: "Service quality report", body: "A resident reported a problem with a completed visit. Review and respond in your quality reports.", linkPath: "/app/provider/quality", dedupeKey: `quality:${id}:provider` },
    ], skipDuplicates: true });
    return { id, ticketId, resolution: "reported" };
  });
}

export async function listProviderQualityClaims(userId: string) {
  requireEnabled();
  // No resident identity, location, photos or internal support conversation.
  return db.serviceQualityClaim.findMany({ where: { providerUserId: userId }, select: {
    id: true, visitId: true, reason: true, resolution: true, providerResponse: true, createdAt: true,
    ticket: { select: { messages: { where: { kind: "customer_reply" }, orderBy: { createdAt: "asc" }, take: 1, select: { body: true } } } },
  }, orderBy: { createdAt: "desc" }, take: 100 });
}

export async function respondToQualityClaim(userId: string, claimId: string, input: z.infer<typeof serviceQualityResponseSchema>) {
  requireEnabled();
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "ServiceQualityClaim" WHERE "id" = ${claimId} FOR UPDATE`;
    const claim = await tx.serviceQualityClaim.findFirst({ where: { id: claimId, providerUserId: userId } });
    if (!claim) throw new HoaWorkflowError("That report is unavailable.", 404);
    if (claim.providerResponse) {
      if (claim.providerResponse === input.response) return { ok: true };
      throw new HoaWorkflowError("Your response is already recorded. Contact support to add information.", 409);
    }
    await tx.serviceQualityClaim.update({ where: { id: claim.id }, data: { providerResponse: input.response, providerRespondedAt: new Date() } });
    await tx.supportTicketMessage.create({ data: { ticketId: claim.ticketId, authorUserId: userId, kind: "internal_note", body: `Provider response: ${input.response}` } });
    await tx.supportTicket.update({ where: { id: claim.ticketId }, data: { lastActivityAt: new Date() } });
    await tx.supportTicketEvent.create({ data: { ticketId: claim.ticketId, actorUserId: userId, type: "internal_note_added" } });
    return { ok: true };
  });
}

/** Record intent only. Payment integration must durably execute and reconcile it. */
export async function requestQualityResolution(adminId: string, claimId: string, input: z.infer<typeof serviceQualityResolutionSchema>) {
  requireEnabled();
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "AdminAccessGrant" WHERE "userId" = ${adminId} FOR SHARE`;
    const grant = await tx.adminAccessGrant.findUnique({ where: { userId: adminId }, select: { status: true } });
    const admin = await tx.user.findUnique({ where: { id: adminId }, select: { role: true } });
    if (admin?.role !== "admin" || grant?.status !== "active") throw new HoaWorkflowError("Administrator access is required.", 403);
    await tx.$queryRaw`SELECT "id" FROM "ServiceQualityClaim" WHERE "id" = ${claimId} FOR UPDATE`;
    const claim = await tx.serviceQualityClaim.findUnique({ where: { id: claimId } });
    if (!claim) throw new HoaWorkflowError("That report is unavailable.", 404);
    const resolution = input.action === "request_redo" ? "redo_pending" : "refund_pending";
    if (claim.resolution !== "reported") {
      if (claim.resolution === resolution) return { resolution, executed: false };
      throw new HoaWorkflowError("A resolution has already been requested. Review it before changing action.", 409);
    }
    await tx.serviceQualityClaim.update({ where: { id: claimId }, data: { resolution, resolutionNote: input.note, resolutionRequestedBy: adminId, resolutionRequestedAt: new Date() } });
    await tx.supportTicketMessage.create({ data: { ticketId: claim.ticketId, authorUserId: adminId, kind: "internal_note", body: `${resolution}: ${input.note}. Not executed; pending payment/scheduling integration.` } });
    await tx.supportTicket.update({ where: { id: claim.ticketId }, data: { lastActivityAt: new Date() } });
    await tx.supportTicketEvent.create({ data: { ticketId: claim.ticketId, actorUserId: adminId, type: "internal_note_added" } });
    return { resolution, executed: false };
  });
}
