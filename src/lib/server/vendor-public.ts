import "server-only";
import { clerkClient } from "@clerk/nextjs/server";
import { db } from "@/lib/server/db";
import { buildAuditEntry } from "@/lib/server/audit";
import { lockVendorEmail, vendorLeadMatch, vendorRequest } from "@/lib/server/vendor-core";
import { resolveVendorInvitationToken } from "@/lib/server/vendor-token-resolution";
import { parseVendorUnsubscribeToken } from "@/lib/server/vendor-invitation-tokens";
import { VendorSourcingError } from "@/lib/server/vendor-errors";
import { providerVerificationSelect, providerVerificationState } from "@/lib/provider-verification";
import { bidSubmitSchema, type BidSubmitInput } from "@/lib/validation/hoa";
import { submitInvitedBid } from "@/lib/server/hoa-market";

export async function claimVendorInvitation(actorId: string, token: string) {
  const { invitation, request } = await resolveVendorInvitationToken(token);
  const localActor = await db.user.findUnique({ where: { id: actorId }, select: { clerkUserId: true } });
  if (!localActor) throw new VendorSourcingError("Use the invited provider account.", 403);
  const clerk = await (await clerkClient()).users.getUser(localActor.clerkUserId);
  const primary = clerk.emailAddresses.find(address => address.id === clerk.primaryEmailAddressId);
  if (primary?.verification?.status !== "verified" || primary.emailAddress.trim().toLowerCase() !== invitation.recipientEmail) throw new VendorSourcingError("Verify the invited email address on your provider account.", 403);
  return db.$transaction(async (tx) => {
    await lockVendorEmail(tx, invitation.emailDigest);
    await tx.$queryRaw`SELECT id FROM "HoaServiceRequest" WHERE id=${request.id} FOR UPDATE`;
    const current = await tx.vendorRequestInvitation.findUniqueOrThrow({ where: { id: invitation.id }, include: { lead: true } });
    const liveRequest = await vendorRequest(request.id, tx);
    if (current.revokedAt || current.expiresAt <= new Date() || current.tokenNonce !== invitation.tokenNonce) throw new VendorSourcingError("This invitation is unavailable.", 404);
    const actor = await tx.user.findUnique({ where: { id: actorId }, include: { providerProfile: { include: { licenseDocument: true, insuranceDocument: true } } } });
    if (actor?.role !== "provider" || !actor.isVerified || actor.email.trim().toLowerCase() !== current.recipientEmail ||
        actor.providerProfile?.accountStatus === "suspended" || (current.claimedProviderUserId && current.claimedProviderUserId !== actorId) ||
        (current.lead.convertedProviderUserId && current.lead.convertedProviderUserId !== actorId)) {
      throw new VendorSourcingError("Use the verified provider account matching the invited email address.", 403);
    }
    if (!current.claimedProviderUserId) {
      if (await tx.vendorEmailSuppression.findUnique({ where: { emailDigest: current.emailDigest } })) throw new VendorSourcingError("This invitation has been withdrawn.", 403);
      const match = vendorLeadMatch(current.lead.convertedProviderUserId === actorId ? { ...current.lead, status: "engaged" } : current.lead, liveRequest);
      if (match.reason) throw new VendorSourcingError(match.reason, 403);
      await tx.providerProfile.upsert({ where: { userId: actorId }, create: { userId: actorId, companyName: current.lead.businessName,
        licenseNumber: current.lead.licenseNumber, licenseState: current.lead.licenseJurisdiction, trades: current.lead.categories },
        update: { ...(actor.providerProfile?.companyName ? {} : { companyName: current.lead.businessName }),
          ...(actor.providerProfile?.licenseNumber ? {} : { licenseNumber: current.lead.licenseNumber, licenseState: current.lead.licenseJurisdiction }),
          ...(actor.providerProfile?.trades.length ? {} : { trades: current.lead.categories }) } });
      await tx.vendorRequestInvitation.update({ where: { id: current.id, claimedProviderUserId: null }, data: { claimedProviderUserId: actorId, claimedAt: new Date() } });
      await tx.vendorLead.update({ where: { id: current.leadId }, data: { convertedProviderUserId: actorId, status: "signed_up" } });
      await tx.adminAuditLog.create({ data: buildAuditEntry({ actorUserId: actorId, action: "vendor_invitation_claimed", targetType: "vendor_invitation", targetId: current.id,
        communityId: request.communityId, providerUserId: actorId, metadata: { category: request.category } }) });
    }
    const profile = await tx.providerProfile.findUniqueOrThrow({ where: { userId: actorId }, select: { accountStatus: true, payoutStatus: true, ...providerVerificationSelect } });
    return { invitationId: current.id, requestId: current.requestId, providerUserId: actorId,
      verificationPending: profile.accountStatus !== "active" || !providerVerificationState(profile).verified || profile.licenseNumber !== current.lead.licenseNumber || profile.licenseState !== current.lead.licenseJurisdiction,
      requiresPayoutSetup: profile.payoutStatus !== "active" };
  });
}
export async function submitInvitedProposal(actorId: string, token: string, raw: BidSubmitInput) {
  const parsed = bidSubmitSchema.safeParse(raw);
  if (!parsed.success) throw new VendorSourcingError("Check the proposal fields.", 400);
  const { invitation } = await resolveVendorInvitationToken(token);
  if (invitation.claimedProviderUserId !== actorId) throw new VendorSourcingError("Claim this invitation with its verified provider account before submitting.", 403);
  const bid = await submitInvitedBid(actorId, invitation.requestId, invitation.id, parsed.data);
  return bid;
}
export async function unsubscribeVendor(token: string) {
  const emailDigest = parseVendorUnsubscribeToken(token);
  await db.$transaction(async (tx) => {
    await lockVendorEmail(tx, emailDigest);
    await tx.vendorEmailSuppression.upsert({ where: { emailDigest }, create: { emailDigest, reason: "unsubscribed" }, update: { reason: "unsubscribed" } });
    await tx.vendorLead.updateMany({ where: { emailDigest }, data: { status: "unsubscribed" } });
    // Email opt-out is not cancellation of an already authenticated proposal.
    await tx.vendorRequestInvitation.updateMany({ where: { emailDigest, claimedProviderUserId: null, revokedAt: null }, data: { revokedAt: new Date() } });
  });
  return { unsubscribed: true };
}
