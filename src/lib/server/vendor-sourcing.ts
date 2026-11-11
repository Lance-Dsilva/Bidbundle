import "server-only";
import { resolveVendorInvitationToken } from "@/lib/server/vendor-token-resolution";
export { resolveVendorInvitationToken } from "@/lib/server/vendor-token-resolution";
export { dispatchVendorOutreach, resolveVendorOutreach, dispatchRegisteredVendorEmail } from "@/lib/server/vendor-outreach";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/server/db";
import { buildAuditEntry } from "@/lib/server/audit";
import { scheduleOutboxDrain } from "@/lib/server/notifications";
import { providerVerificationSelect, providerVerificationState } from "@/lib/provider-verification";
import { normalizeServiceTrades } from "@/lib/service-categories";
import { circleCoversLocation } from "@/lib/server/provider-coverage";
import { publicVendorRequest, vendorRequest, vendorRequestLocation, vendorLeadMatch, requireVendorAdmin, lockVendorEmail, reserveVendorBudget } from "@/lib/server/vendor-core";
import { createVendorInvitationNonce, parseVendorBidToken, vendorOutreachConfiguration } from "@/lib/server/vendor-invitation-tokens";
import { VendorSourcingError } from "@/lib/server/vendor-errors";
import { serializeVendorLead } from "@/lib/server/vendor-leads";
import { vendorInviteBatchSchema, type VendorInviteBatchInput } from "@/lib/validation/vendor-sourcing";
import type { VendorSourcingView, PublicVendorBidSummary } from "@/lib/vendor-sourcing-types";
export { listVendorLeads, upsertVendorLead, importCslbLeads, addVendorReferral } from "@/lib/server/vendor-leads";
export { claimVendorInvitation, submitInvitedProposal, unsubscribeVendor } from "@/lib/server/vendor-public";
export { ingestResendWebhook } from "@/lib/server/vendor-webhook";

export async function listVendorSourcingRequests(actorId: string, communityId: string) {
  await requireVendorAdmin(actorId);
  return { requests: await db.hoaServiceRequest.findMany({ where: { communityId, status: "open_for_bids", biddingClosesAt: { gt: new Date() }, community: { status: "active" } },
    select: { id: true, title: true, category: true }, orderBy: { createdAt: "desc" }, take: 100 }) };
}
export async function listRequestSourcing(actorId: string, requestId: string): Promise<VendorSourcingView> {
  await requireVendorAdmin(actorId);
  const request = await vendorRequest(requestId), location = vendorRequestLocation(request);
  const [profiles, leads, approvals, invited, invitations, suppressed] = await Promise.all([
    db.providerProfile.findMany({ where: { accountStatus: "active", user: { role: "provider", isVerified: true } },
      select: { ...providerVerificationSelect, companyName: true, trades: true, user: { select: { id: true, fullName: true, providerServiceAreas: { where: { status: "active" }, select: { centerLatitude: true, centerLongitude: true, radiusMiles: true, postalCodes: true } } } } }, take: 500, orderBy: { userId: "asc" } }),
    db.vendorLead.findMany({ where: { categories: { has: request.category } }, orderBy: { updatedAt: "desc" }, take: 500 }),
    db.providerCommunityApproval.findMany({ where: { communityId: request.communityId }, select: { providerUserId: true } }),
    db.providerBidInvitation.findMany({ where: { requestId }, select: { providerUserId: true } }),
    db.vendorRequestInvitation.findMany({ where: { requestId }, select: { id: true, openedAt: true, proposalStartedAt: true, submittedAt: true } }),
    db.vendorEmailSuppression.findMany({ select: { emailDigest: true } }),
  ]);
  const approved = new Set(approvals.map((row) => row.providerUserId)), invitedIds = new Set(invited.map((row) => row.providerUserId));
  const suppressedDigests = new Set(suppressed.map((row) => row.emailDigest));
  return { request: publicVendorRequest(request),
    registered: profiles.filter((profile) => providerVerificationState(profile).verified && normalizeServiceTrades(profile.trades).includes(request.category as never) &&
      (approved.has(profile.user.id) || profile.user.providerServiceAreas.some((area) => circleCoversLocation(area, location).covered))).map((profile) => ({
      providerUserId: profile.user.id, name: profile.companyName ?? profile.user.fullName, verified: true, approved: approved.has(profile.user.id), distanceMi: null, invited: invitedIds.has(profile.user.id),
    })),
    leads: leads.map((lead) => { const match = vendorLeadMatch(lead, request); const reason = lead.emailDigest && suppressedDigests.has(lead.emailDigest) ? "This address is globally suppressed." : match.reason;
      return { ...serializeVendorLead(lead), distanceMi: match.distanceMi, eligible: reason === null, exclusionReason: reason }; }),
    funnel: { invited: invitations.length + invited.length, opened: invitations.filter((row) => row.openedAt).length,
      proposalStarted: invitations.filter((row) => row.proposalStartedAt).length, submitted: invitations.filter((row) => row.submittedAt).length },
    outreach: { ready: vendorOutreachConfiguration().ready, missing: vendorOutreachConfiguration().missing },
  };
}

export async function inviteVendorBatch(actorId: string, requestId: string, raw: VendorInviteBatchInput) {
  await requireVendorAdmin(actorId);
  const parsed = vendorInviteBatchSchema.safeParse(raw);
  if (!parsed.success) throw new VendorSourcingError("Select a bounded invitation batch.", 400);
  const leadIds = [...new Set(parsed.data.leadIds)], providerIds = [...new Set(parsed.data.providerUserIds)];
  const config = vendorOutreachConfiguration();
  if (leadIds.length && !config.ready) throw new VendorSourcingError("Lead outreach is disabled until the dedicated sender, address, signing and webhook configuration are approved.", 503);
  const view = await listRequestSourcing(actorId, requestId);
  if (providerIds.some((id) => !view.registered.some((row) => row.providerUserId === id))) throw new VendorSourcingError("Select a current verified registered provider.", 400);
  const initial = await db.vendorLead.findMany({ where: { id: { in: leadIds } } });
  if (initial.length !== leadIds.length) throw new VendorSourcingError("A selected vendor lead was not found.", 404);
  const now = new Date();
  const result = await db.$transaction(async (tx) => {
    // This is also the order used by suppression and dispatch; never invert it.
    for (const digest of [...new Set(initial.map((lead) => lead.emailDigest).filter((value): value is string => !!value))].sort()) await lockVendorEmail(tx, digest);
    await tx.$queryRaw`SELECT id FROM "HoaServiceRequest" WHERE id=${requestId} FOR UPDATE`;
    await tx.$executeRaw`SELECT bundleen_assert_vendor_admin(${actorId})`;
    const request = await vendorRequest(requestId, tx);
    for (const id of [...leadIds].sort()) await tx.$queryRaw`SELECT id FROM "VendorLead" WHERE id=${id} FOR SHARE`;
    const leads = await tx.vendorLead.findMany({ where: { id: { in: leadIds } } });
    if (leads.some(lead => initial.find(before => before.id === lead.id)?.emailDigest !== lead.emailDigest)) throw new VendorSourcingError("A vendor contact changed. Refresh the batch before sending.", 409);
    const old = await tx.vendorRequestInvitation.findMany({ where: { requestId, leadId: { in: leadIds } }, select: { leadId: true } });
    const oldLeadIds = new Set(old.map((row) => row.leadId));
    const pending = leads.filter((lead) => !oldLeadIds.has(lead.id));
    for (const lead of pending) {
      const match = vendorLeadMatch(lead, request, now);
      if (match.reason || !lead.emailDigest || await tx.vendorEmailSuppression.findUnique({ where: { emailDigest: lead.emailDigest } })) throw new VendorSourcingError(match.reason ?? "This vendor address is suppressed.", 400);
    }
    const oldRegistered = await tx.providerBidInvitation.findMany({ where: { requestId, providerUserId: { in: providerIds } }, select: { providerUserId: true } });
    const oldProviderIds = new Set(oldRegistered.map((row) => row.providerUserId));
    const pendingProviders = providerIds.filter((id) => !oldProviderIds.has(id));
    const count = pending.length + pendingProviders.length;
    if (count) { await reserveVendorBudget(tx, `queue-day:${now.toISOString().slice(0, 10)}`, count, config.dailyLimit);
      await reserveVendorBudget(tx, `request:${requestId}`, count, config.requestLimit); }
    const invitationIds: string[] = [];
    for (const lead of pending) {
      const id = randomUUID(); invitationIds.push(id);
      await tx.vendorRequestInvitation.create({ data: { id, leadId: lead.id, requestId, invitedByUserId: actorId,
        recipientEmail: lead.email!, emailDigest: lead.emailDigest!, tokenNonce: createVendorInvitationNonce(), expiresAt: request.biddingClosesAt! } });
      const day3 = new Date(+now + 3 * 86_400_000), dayBefore = new Date(+request.biddingClosesAt! - 86_400_000);
      const slots = [{ slot: 0, dueAt: now }, ...(day3 < dayBefore ? [{ slot: 1, dueAt: day3 }] : []), ...(dayBefore > now ? [{ slot: 2, dueAt: dayBefore }] : [])];
      for (const slot of slots) {
        await tx.vendorOutreachMessage.create({ data: { id: randomUUID(), invitationId: id, ...slot } });
        await tx.outboxEvent.create({ data: { id: randomUUID(), kind: "vendor_outreach", dedupeKey: `vendor-outreach:${id}:${slot.slot}`,
          payload: { invitationId: id, slot: slot.slot }, nextAttemptAt: slot.dueAt } });
      }
      await tx.vendorLead.update({ where: { id: lead.id }, data: { status: "invited", lastInvitedAt: now } });
    }
    for (const providerUserId of pendingProviders) {
      await tx.$queryRaw`SELECT id FROM "ProviderProfile" WHERE "userId"=${providerUserId} FOR SHARE`;
      await tx.$queryRaw`SELECT id FROM "ProviderServiceArea" WHERE "providerUserId"=${providerUserId} FOR SHARE`;
      await tx.$queryRaw`SELECT id FROM "ProviderCommunityApproval" WHERE "communityId"=${request.communityId} AND "providerUserId"=${providerUserId} FOR SHARE`;
      const profile = await tx.providerProfile.findUniqueOrThrow({ where: { userId: providerUserId }, select: { ...providerVerificationSelect, trades: true, notifyNewJobs: true,
        user: { select: { email: true, role: true, isVerified: true, providerServiceAreas: { where: { status: "active" }, select: { centerLatitude: true, centerLongitude: true, radiusMiles: true, postalCodes: true } } } } } });
      const approved = await tx.providerCommunityApproval.findUnique({ where: { communityId_providerUserId: { communityId: request.communityId, providerUserId } } });
      if (profile.user.role !== "provider" || !profile.user.isVerified || !providerVerificationState(profile).verified || !normalizeServiceTrades(profile.trades).includes(request.category as never) ||
          (!approved && !profile.user.providerServiceAreas.some(area => circleCoversLocation(area, vendorRequestLocation(request)).covered))) throw new VendorSourcingError("Provider eligibility changed. Refresh the batch.", 409);
      await tx.providerBidInvitation.create({ data: { id: randomUUID(), requestId, providerUserId, invitedByUserId: actorId } });
      await tx.notification.createMany({ data: [{ id: randomUUID(), userId: providerUserId, kind: "request", title: "Invitation to quote", body: "Review the service terms and deadline in Bundleen; all bidding eligibility checks still apply.", linkPath: "/app/provider/hoa", dedupeKey: `provider-bid-invite:${requestId}:${providerUserId}` }], skipDuplicates: true });
      if (profile.notifyNewJobs) await tx.outboxEvent.createMany({ data: [{ id: randomUUID(), kind: "notification_email", dedupeKey: `email:provider-bid-invite:${requestId}:${providerUserId}`,
        payload: { to: profile.user.email, subject: "Invitation to quote", text: `${config.appUrl || process.env.APP_URL || ""}/app/provider/hoa`, vendorOutreach: true } }], skipDuplicates: true });
    }
    await tx.adminAuditLog.create({ data: buildAuditEntry({ actorUserId: actorId, action: "vendor_invites_queued", targetType: "hoa_request", targetId: requestId, communityId: request.communityId,
      metadata: { importedCount: pending.length, updatedCount: pendingProviders.length, duplicateCount: old.length + oldRegistered.length } }) });
    return { queuedCount: pending.length, registeredCount: pendingProviders.length, alreadyInvitedCount: old.length + oldRegistered.length, invitationIds };
  }, { timeout: 20_000 });
  // No cold outreach drain is triggered here. The authenticated existing worker
  // resolves only due, still-enabled messages after the committed review batch.
  if (result.registeredCount) scheduleOutboxDrain();
  return { ...result, outreach: { ready: config.ready, missing: config.missing } };
}

export async function getPublicBidSummary(token: string): Promise<PublicVendorBidSummary> {
  const { invitation, request } = await resolveVendorInvitationToken(token);
  return { request: publicVendorRequest(request), invitation: { expiresAt: invitation.expiresAt.toISOString(), claimed: !!invitation.claimedProviderUserId, submitted: !!invitation.submittedAt },
    prefill: { businessName: invitation.lead.businessName, licenseNumber: invitation.lead.licenseNumber, licenseState: invitation.lead.licenseJurisdiction, categories: invitation.lead.categories } };
}
export async function markProposalStarted(token: string) {
  const { invitation } = await resolveVendorInvitationToken(token);
  await db.$transaction(async tx => {
    await lockVendorEmail(tx, invitation.emailDigest);
    const current = await tx.vendorRequestInvitation.findUniqueOrThrow({ where: { id: invitation.id } });
    if (current.revokedAt || current.expiresAt <= new Date() || current.tokenNonce !== invitation.tokenNonce) throw new VendorSourcingError("This invitation is unavailable.", 404);
    await vendorRequest(current.requestId, tx);
    await tx.vendorRequestInvitation.updateMany({ where: { id: current.id, proposalStartedAt: null, revokedAt: null, expiresAt: { gt: new Date() } }, data: { proposalStartedAt: new Date() } });
    await tx.vendorLead.updateMany({ where: { id: current.leadId, status: { in: ["new", "invited"] } }, data: { status: "engaged" } });
  });
  return { started: true };
}
