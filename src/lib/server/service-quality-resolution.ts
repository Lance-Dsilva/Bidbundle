import "server-only";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/server/db";
import { HoaWorkflowError } from "@/lib/server/hoa";
import { processStripeTestRefund, reserveStripeTestRefund, requireStripeRefundOwner } from "@/lib/server/stripe-test-refunds";

async function lockedClaim(tx: Prisma.TransactionClient, claimId: string) {
  const identity = await tx.serviceQualityClaim.findUnique({ where: { id: claimId }, select: { visitId: true } });
  if (!identity) throw new HoaWorkflowError("That report is unavailable.", 404);
  await tx.$queryRaw`SELECT "id" FROM "ServiceVisit" WHERE "id"=${identity.visitId} FOR UPDATE`;
  await tx.$queryRaw`SELECT "visitId" FROM "StripeTestPayment" WHERE "visitId"=${identity.visitId} FOR UPDATE`;
  await tx.$queryRaw`SELECT "id" FROM "ServiceQualityClaim" WHERE "id"=${claimId} FOR UPDATE`;
  return tx.serviceQualityClaim.findUniqueOrThrow({ where: { id: claimId } });
}
async function activity(tx: Prisma.TransactionClient, claim: { id: string; ticketId: string; requesterUserId: string; providerUserId: string; financialPayerUserId?: string | null }, actorId: string | null, outcome: string, body: string, terminal = false) {
  await tx.supportTicketMessage.create({ data: { ticketId: claim.ticketId, authorUserId: actorId, kind: "internal_note", body } });
  await tx.supportTicketEvent.create({ data: { ticketId: claim.ticketId, actorUserId: actorId, type: "internal_note_added", toValue: outcome } });
  await tx.supportTicket.update({ where: { id: claim.ticketId }, data: { lastActivityAt: new Date(), ...(terminal ? { status: "resolved", resolvedAt: new Date() } : {}) } });
  await tx.notification.createMany({ data: [...new Set([claim.requesterUserId, claim.providerUserId, ...(claim.financialPayerUserId ? [claim.financialPayerUserId] : [])])].map(userId => ({ id: randomUUID(), userId, kind: "request" as const,
    title: terminal ? "Service quality resolution completed" : "Service quality resolution update", body: terminal ? "Your service quality resolution is complete. Review the support report for details." : "Your service quality resolution has been updated. Review the support report for details.",
    linkPath: userId === claim.providerUserId ? "/app/provider/quality" : "/app/support", dedupeKey: `quality:${claim.id}:${outcome}:${userId}` })), skipDuplicates: true });
}

/** Explicit owner-approved amount; reservation and claim linkage commit together. */
export async function executeQualityRefund(actorId: string, claimId: string, input: { operationId: string; amountCents: number; note: string }) {
  const operation = await db.$transaction(async tx => {
    const claim = await lockedClaim(tx, claimId);
    await requireStripeRefundOwner(tx, actorId);
    if (!["refund_pending", "refund_complete"].includes(claim.resolution)) throw new HoaWorkflowError("Request a refund resolution first.", 409);
    if (claim.refundOperationId && claim.refundOperationId !== input.operationId) throw new HoaWorkflowError("This claim already has a refund operation. Retry that operation.", 409);
    const payment = await tx.stripeTestPayment.findUnique({ where: { visitId: claim.visitId } });
    if (!payment || !claim.financialPayerUserId || payment.residentUserId !== claim.financialPayerUserId) throw new HoaWorkflowError("The original paid visit needs billing review.", 409);
    if ((payment as typeof payment & { reconciliationHoldReason?: string | null }).reconciliationHoldReason) throw new HoaWorkflowError("Payment reconciliation is required before a refund.", 409);
    const op = await reserveStripeTestRefund(tx, actorId, claim.visitId, { id: input.operationId, amountCents: input.amountCents, reason: "service_quality" });
    if (!claim.refundOperationId) {
      await tx.serviceQualityClaim.update({ where: { id: claimId }, data: { refundOperationId: op.id } });
      await activity(tx, claim, actorId, "refund_reserved", `Approved refund of ${(input.amountCents / 100).toFixed(2)} ${payment.currency.toUpperCase()} as the resolution for this claim. ${input.note}`);
    }
    return op;
  });
  await processStripeTestRefund(operation.id);
  return reconcileQualityResolution(claimId);
}

/** No new charge or rewritten original work: a separate, zero-price visit. */
export async function scheduleQualityRedo(actorId: string, claimId: string, serviceDate: Date, note: string) {
  return db.$transaction(async tx => {
    const claim = await lockedClaim(tx, claimId);
    await requireStripeRefundOwner(tx, actorId);
    if (claim.redoVisitId) return { redoVisitId: claim.redoVisitId, resolution: claim.resolution };
    if (claim.resolution !== "redo_pending" || claim.refundOperationId) throw new HoaWorkflowError("Request a redo resolution first.", 409);
    const original = await tx.serviceVisit.findUniqueOrThrow({ where: { id: claim.visitId }, include: { occurrence: { include: { agreement: true } } } });
    if (!["active", "completed"].includes(original.occurrence.agreement.status) || original.status !== "completed" || original.redoOfVisitId || !Number.isFinite(serviceDate.getTime()) || serviceDate.getTime() < Date.now()) throw new HoaWorkflowError("Choose a future date for the completed visit's redo.", 409);
    await tx.$queryRaw`SELECT "id" FROM "ServiceAgreement" WHERE "id"=${original.occurrence.agreementId} FOR UPDATE`;
    const latest = await tx.serviceOccurrence.aggregate({ where: { agreementId: original.occurrence.agreementId }, _max: { sequence: true } });
    const occurrence = await tx.serviceOccurrence.create({ data: { agreementId: original.occurrence.agreementId, sequence: (latest._max.sequence ?? 0) + 1, serviceDate, schedulePublishedAt: new Date() } });
    const redo = await tx.serviceVisit.create({ data: { occurrenceId: occurrence.id, redoOfVisitId: original.id,
      unitId: original.unitId, homeownerUserId: original.homeownerUserId, billingPayerUserId: original.billingPayerUserId,
      allocatedVisitCents: 0, requiresAfterPhoto: original.requiresAfterPhoto, scheduledDate: serviceDate, status: "scheduled", stopRank: 1,
      serviceLabel: original.serviceLabel, serviceAddressLine1: original.serviceAddressLine1, serviceAddressLine2: original.serviceAddressLine2,
      serviceLocality: original.serviceLocality, serviceRegion: original.serviceRegion, servicePostalCode: original.servicePostalCode,
      serviceCountry: original.serviceCountry, serviceLatitude: original.serviceLatitude, serviceLongitude: original.serviceLongitude, serviceAccessNotes: original.serviceAccessNotes } });
    await tx.serviceQualityClaim.update({ where: { id: claimId }, data: { redoVisitId: redo.id } });
    await activity(tx, claim, actorId, "redo_scheduled", `A no-charge redo has been scheduled for ${serviceDate.toISOString().slice(0, 10)}. ${note}`);
    return { redoVisitId: redo.id, resolution: "redo_pending" };
  });
}

/** Truthful terminal state only after the existing ledger or actual redo completes. */
export async function reconcileQualityResolution(claimId: string) {
  return db.$transaction(async tx => {
    const claim = await lockedClaim(tx, claimId);
    if (claim.resolvedAt) return { resolution: claim.resolution, executed: true };
    let resolution: string | null = null;
    if (claim.resolution === "refund_pending" && claim.refundOperationId) {
      const refund = await tx.stripeTestRefund.findUnique({ where: { id: claim.refundOperationId } });
      if (refund?.visitId === claim.visitId && refund.state === "succeeded") resolution = "refund_complete";
    }
    if (claim.resolution === "redo_pending" && claim.redoVisitId) {
      const redo = await tx.serviceVisit.findUnique({ where: { id: claim.redoVisitId } });
      if (redo?.redoOfVisitId === claim.visitId && redo.status === "completed" && redo.completedAt) resolution = "redo_complete";
    }
    if (!resolution) return { resolution: claim.resolution, executed: false };
    await tx.serviceQualityClaim.update({ where: { id: claimId }, data: { resolution, resolvedAt: new Date() } });
    await activity(tx, claim, null, resolution, resolution === "refund_complete" ? "The approved refund and any required provider reversal are complete." : "The no-charge redo has been completed.", true);
    return { resolution, executed: true };
  });
}
export async function reconcileQualityResolutions() {
  const claims = await db.serviceQualityClaim.findMany({ where: { resolvedAt: null, OR: [{ refundOperationId: { not: null } }, { redoVisitId: { not: null } }] }, orderBy: { createdAt: "asc" }, take: 100 });
  for (const claim of claims) await reconcileQualityResolution(claim.id);
}
