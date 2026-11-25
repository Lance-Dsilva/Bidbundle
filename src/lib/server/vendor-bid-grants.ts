import "server-only";
import { db } from "@/lib/server/db";
import { VendorSourcingError } from "@/lib/server/vendor-errors";
import { vendorLicenseClassCovers } from "@/lib/server/vendor-core";

/** Narrow proposal permission; it never supplies award or verification authority. */
export async function requireInvitedBidGrant(providerUserId: string, requestId: string, invitationId: string) {
  const [invitation, provider] = await Promise.all([
    db.vendorRequestInvitation.findUnique({ where: { id: invitationId }, include: { lead: true, request: { include: { community: true } } } }),
    db.user.findUnique({ where: { id: providerUserId }, include: { providerProfile: true } }),
  ]);
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  if (!invitation || invitation.requestId !== requestId || invitation.claimedProviderUserId !== providerUserId || !invitation.claimedAt || invitation.revokedAt ||
      invitation.expiresAt <= now || invitation.request.status !== "open_for_bids" || invitation.request.community.status !== "active" ||
      !invitation.request.biddingClosesAt || invitation.request.biddingClosesAt <= now ||
      provider?.role !== "provider" || !provider.isVerified || provider.email.toLowerCase() !== invitation.recipientEmail ||
      !provider.providerProfile || !["active", "pending"].includes(provider.providerProfile.accountStatus) ||
      invitation.lead.licenseStatus !== "active" || !invitation.lead.licenseNumber || !invitation.lead.licenseExpiresAt || +invitation.lead.licenseExpiresAt < today ||
      !invitation.lead.categories.includes(invitation.request.category) || !vendorLicenseClassCovers(invitation.request.category, invitation.lead.licenseClasses)) {
    throw new VendorSourcingError("This provider invitation is no longer eligible for a proposal.", 403);
  }
  return { userId: providerUserId, trades: invitation.lead.categories, eligible: true, ineligibleReason: null };
}
