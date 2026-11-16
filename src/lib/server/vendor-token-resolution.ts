import "server-only";
import { db } from "@/lib/server/db";
import { vendorRequest } from "@/lib/server/vendor-core";
import { parseVendorBidToken } from "@/lib/server/vendor-invitation-tokens";
import { VendorSourcingError } from "@/lib/server/vendor-errors";
export async function resolveVendorInvitationToken(token: string) {
  const parsed = parseVendorBidToken(token);
  const invitation = await db.vendorRequestInvitation.findUnique({ where: { id: parsed.id }, include: { lead: true } });
  if (!invitation || invitation.tokenNonce !== parsed.nonce || invitation.revokedAt || invitation.expiresAt <= new Date()) throw new VendorSourcingError("This invitation is unavailable.", 404);
  const request = await vendorRequest(invitation.requestId);
  return { invitation, request };
}
