import "server-only";
import { db } from "@/lib/server/db";
import { lockVendorEmail, reserveVendorBudget, vendorLeadMatch, vendorRequest, publicVendorRequest, vendorRequestLocation } from "@/lib/server/vendor-core";
import { createVendorBidToken, createVendorUnsubscribeToken, vendorEmailDigest, vendorOutreachConfiguration } from "@/lib/server/vendor-invitation-tokens";
import { VendorSourcingError } from "@/lib/server/vendor-errors";
import { circleCoversLocation } from "@/lib/server/provider-coverage";
import { normalizeServiceCategory, normalizeServiceTrades } from "@/lib/service-categories";
import { getEmailProvider, type EmailMessage } from "@/lib/server/email";
import { providerVerificationSelect, providerVerificationState } from "@/lib/provider-verification";
import { reconcileVendorWebhookEvents } from "@/lib/server/vendor-webhook";

type OutreachPayload = { from: string; to: string[]; subject: string; text: string; headers: Record<string, string> };
export async function sendVendorOutreachEmail(payload: OutreachPayload, idempotencyKey: string) {
  const response = await fetch("https://api.resend.com/emails", { method: "POST", headers: {
    Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": idempotencyKey,
  }, body: JSON.stringify(payload), signal: AbortSignal.timeout(8_000) });
  if (!response.ok) throw new VendorSourcingError(`Vendor email delivery failed (${response.status}).`, 503);
  const body = await response.json() as { id?: unknown };
  if (typeof body.id !== "string" || !body.id || body.id.length > 200) throw new VendorSourcingError("Vendor email delivery was not acknowledged.", 503);
  return { providerMessageId: body.id };
}

/** First attempt and its immutable body commit before network I/O. A retry has
 * the same key/body and is forbidden after 23h, before Resend's 24h expiry. */
export async function dispatchVendorOutreach(invitationId: string, slot: number): Promise<{ providerMessageId: string | null; skipped?: boolean }> {
  if (!Number.isInteger(slot) || slot < 0 || slot > 2) throw new VendorSourcingError("Invalid outreach message.", 400);
  const initial = await db.vendorRequestInvitation.findUnique({ where: { id: invitationId }, select: { emailDigest: true } });
  if (!initial) return { providerMessageId: null, skipped: true };
  const config = vendorOutreachConfiguration();
  if (!config.ready) throw new VendorSourcingError("Vendor outreach is disabled or not fully configured.", 503);
  await db.$transaction(async tx => {
    await lockVendorEmail(tx, initial.emailDigest);
    const message = await tx.vendorOutreachMessage.findUnique({ where: { invitationId_slot: { invitationId, slot } }, include: { invitation: { include: { lead: true } } } });
    if (!message || message.status !== "pending" || message.firstAttemptAt) return;
    const now = new Date();
    if (message.dueAt > now) throw new VendorSourcingError("Vendor outreach is not due yet.", 409);
    const invitation = message.invitation;
    const firstMessage = slot > 0 ? await tx.vendorOutreachMessage.findUnique({ where: { invitationId_slot: { invitationId, slot: 0 } } }) : null;
    if (slot > 0 && (!firstMessage || firstMessage.status !== "sent" || !firstMessage.providerMessageId)) {
      await tx.vendorOutreachMessage.update({ where: { id: message.id }, data: { status: "skipped" } }); return;
    }
    const request = await vendorRequest(invitation.requestId, tx).catch(error => { if (error instanceof VendorSourcingError && error.status === 404) return null; throw error; });
    if (!request || invitation.revokedAt || invitation.expiresAt <= now || invitation.claimedProviderUserId || invitation.submittedAt ||
        (slot > 0 && (invitation.openedAt || invitation.clickedAt || invitation.proposalStartedAt)) ||
        await tx.vendorEmailSuppression.findUnique({ where: { emailDigest: initial.emailDigest } }) || vendorLeadMatch(invitation.lead, request).reason ||
        invitation.lead.emailDigest !== invitation.emailDigest) {
      await tx.vendorOutreachMessage.update({ where: { id: message.id }, data: { status: "skipped" } }); return;
    }
    const day = now.toISOString().slice(0, 10);
    await reserveVendorBudget(tx, `send-day:${day}`, 1, config.dailyLimit);
    const summary = publicVendorRequest(request);
    const unsubscribe = `${config.appUrl}/api/vendor-unsubscribe/${createVendorUnsubscribeToken(invitation.emailDigest)}`;
    const bid = `${config.appUrl}/bid/${createVendorBidToken(invitation.id, invitation.tokenNonce)}`;
    const payload: OutreachPayload = { from: config.from, to: [invitation.recipientEmail],
      subject: slot ? "Reminder: community proposal invitation" : "Invitation to quote for a community request",
      text: `Bundleen invites your business to submit a proposal.\nService: ${summary.category}\nArea: ${summary.areaLabel}\nHomes: ${summary.homeCount}\nBid deadline: ${summary.biddingClosesAt}\n\nReview and propose: ${bid}\n\nVerification is required before any award.\n${config.postalAddress}\nUnsubscribe from all provider invitations: ${config.appUrl}/vendor-unsubscribe/${createVendorUnsubscribeToken(invitation.emailDigest)}`,
      headers: { "List-Unsubscribe": `<${unsubscribe}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } };
    await tx.vendorOutreachMessage.update({ where: { id: message.id }, data: { firstAttemptAt: now, reservationDay: day, payload } });
  });
  const result = await db.$transaction(async tx => {
    await lockVendorEmail(tx, initial.emailDigest);
    const message = await tx.vendorOutreachMessage.findUnique({ where: { invitationId_slot: { invitationId, slot } }, include: { invitation: { include: { lead: true } } } });
    if (!message || message.status !== "pending") return { providerMessageId: message?.providerMessageId ?? null, skipped: true };
    const now = new Date(), invitation = message.invitation;
    if (!message.firstAttemptAt || !message.payload) throw new VendorSourcingError("Outreach reservation is unavailable.", 503);
    if (+now - +message.firstAttemptAt >= 23 * 60 * 60 * 1000) {
      await tx.vendorOutreachMessage.update({ where: { id: message.id }, data: { status: "uncertain" } }); return { providerMessageId: null, skipped: true };
    }
    // Email lock serializes suppression, duplicate workers, and claim with sends.
    // Lock request/lead as well: eligibility cannot be revoked during delivery.
    await tx.$queryRaw`SELECT id FROM "HoaServiceRequest" WHERE id=${invitation.requestId} FOR SHARE`;
    await tx.$queryRaw`SELECT id FROM "VendorLead" WHERE id=${invitation.leadId} FOR SHARE`;
    const context = await tx.hoaServiceRequest.findUniqueOrThrow({ where: { id: invitation.requestId }, select: { communityId: true } });
    await tx.$queryRaw`SELECT id FROM "Community" WHERE id=${context.communityId} FOR SHARE`;
    await tx.$queryRaw`SELECT id FROM "HoaProfile" WHERE "communityId"=${context.communityId} FOR SHARE`;
    const request = await vendorRequest(invitation.requestId, tx).catch(error => { if (error instanceof VendorSourcingError && error.status === 404) return null; throw error; });
    const lead = await tx.vendorLead.findUniqueOrThrow({ where: { id: invitation.leadId } });
    if (!request || invitation.revokedAt || invitation.expiresAt <= now || invitation.claimedProviderUserId || invitation.submittedAt ||
        (slot > 0 && (invitation.openedAt || invitation.clickedAt || invitation.proposalStartedAt)) ||
        await tx.vendorEmailSuppression.findUnique({ where: { emailDigest: initial.emailDigest } }) || vendorLeadMatch(lead, request).reason || lead.emailDigest !== invitation.emailDigest) {
      await tx.vendorOutreachMessage.update({ where: { id: message.id }, data: { status: "skipped" } }); return { providerMessageId: null, skipped: true };
    }
    const delivery = await sendVendorOutreachEmail(message.payload as OutreachPayload, `vendor-outreach:${message.id}`);
    await tx.vendorOutreachMessage.update({ where: { id: message.id }, data: { status: "sent", sentAt: new Date(), providerMessageId: delivery.providerMessageId } });
    return delivery;
  }, { maxWait: 5_000, timeout: 15_000 });
  if (result.providerMessageId) await reconcileVendorWebhookEvents(result.providerMessageId);
  return result;
}
export const resolveVendorOutreach = dispatchVendorOutreach;

export async function dispatchRegisteredVendorEmail(message: EmailMessage & { requestId?: string; providerUserId?: string }): Promise<{ providerMessageId: string | null; skipped?: boolean }> {
  const digest = vendorEmailDigest(message.to);
  const parts = /(?:provider-bid-invite|provider-request-open):([^:]+):([^:]+)$/.exec(message.idempotencyKey ?? "");
  const requestId = message.requestId ?? parts?.[1], providerUserId = message.providerUserId ?? parts?.[2];
  if (!requestId || !providerUserId) return { providerMessageId: null, skipped: true };
  return db.$transaction(async tx => {
    await lockVendorEmail(tx, digest);
    // Existing outbox creation time is a conservative retry horizon. Delayed
    // old invitations are skipped rather than replayed after Resend expires a key.
    const outbox = message.idempotencyKey ? await tx.outboxEvent.findUnique({ where: { dedupeKey: message.idempotencyKey } }) : null;
    if (!outbox || outbox.status === "delivered" || Date.now() - +outbox.createdAt >= 23 * 60 * 60 * 1000) return { providerMessageId: outbox?.providerMessageId ?? null, skipped: true };
    await tx.$queryRaw`SELECT id FROM "HoaServiceRequest" WHERE id=${requestId} FOR SHARE`;
    const context = await tx.hoaServiceRequest.findUnique({ where: { id: requestId }, select: { communityId: true } });
    if (!context) return { providerMessageId: null, skipped: true };
    await tx.$queryRaw`SELECT id FROM "Community" WHERE id=${context.communityId} FOR SHARE`;
    await tx.$queryRaw`SELECT id FROM "HoaProfile" WHERE "communityId"=${context.communityId} FOR SHARE`;
    const request = await vendorRequest(requestId, tx).catch(error => { if (error instanceof VendorSourcingError && error.status === 404) return null; throw error; });
    if (!request) return { providerMessageId: null, skipped: true };
    await tx.$queryRaw`SELECT id FROM "ProviderServiceArea" WHERE "providerUserId"=${providerUserId} FOR SHARE`;
    await tx.$queryRaw`SELECT id FROM "ProviderCommunityApproval" WHERE "communityId"=${request.communityId} AND "providerUserId"=${providerUserId} FOR SHARE`;
    await tx.$queryRaw`SELECT id FROM "User" WHERE id=${providerUserId} FOR SHARE`;
    await tx.$queryRaw`SELECT id FROM "ProviderProfile" WHERE "userId"=${providerUserId} FOR SHARE`;
    const profile = await tx.providerProfile.findUnique({ where: { userId: providerUserId }, select: { ...providerVerificationSelect, accountStatus: true, notifyNewJobs: true, trades: true, user: { select: { role: true, isVerified: true, email: true, providerServiceAreas: { where: { status: "active" }, select: { centerLatitude: true, centerLongitude: true, radiusMiles: true, postalCodes: true } } } } } });
    const category = normalizeServiceCategory(request.category);
    const approved = await tx.providerCommunityApproval.findUnique({ where: { communityId_providerUserId: { communityId: request.communityId, providerUserId } } });
    if (await tx.vendorEmailSuppression.findUnique({ where: { emailDigest: digest } }) || !request || request.status !== "open_for_bids" || request.community.status !== "active" ||
        !request.biddingClosesAt || request.biddingClosesAt <= new Date() || !profile || profile.accountStatus !== "active" || !profile.notifyNewJobs || profile.user.role !== "provider" ||
        !profile.user.isVerified || vendorEmailDigest(profile.user.email) !== digest || !category || !normalizeServiceTrades(profile.trades).includes(category) || !providerVerificationState(profile).verified || (!approved && !profile.user.providerServiceAreas.some(area => circleCoversLocation(area, vendorRequestLocation(request)).covered))) return { providerMessageId: null, skipped: true };
    return getEmailProvider().send(message);
  }, { maxWait: 5_000, timeout: 15_000 });
}
