import "server-only";
import { Prisma, type VendorLead } from "@/generated/prisma/client";
import { db } from "@/lib/server/db";
import { VendorSourcingError } from "@/lib/server/vendor-errors";
import { parsePoolTemplate, poolTierCounts } from "@/lib/pool-bid-template";
import { distanceMiles } from "@/lib/geo";
import type { VendorRequestSummary } from "@/lib/vendor-sourcing-types";
import { normalizeVendorClass } from "@/lib/server/vendor-cslb";

export function vendorLicenseClassCovers(category: string, classes: string[]): boolean {
  const normalized = classes.map(normalizeVendorClass);
  return category === "pool_care" ? normalized.some((value) => ["D-35", "C-53"].includes(value))
    : category === "landscaping" ? normalized.includes("C-27") : false;
}

export type VendorDb = Pick<typeof db, "user" | "hoaServiceRequest" | "vendorEmailSuppression">;
export async function requireVendorAdmin(actorId: string, client: Pick<typeof db, "user"> = db) {
  const actor = await client.user.findUnique({ where: { id: actorId }, select: {
    id: true, role: true, isVerified: true, email: true, adminAccess: { select: { status: true, email: true, isStaffAccount: true } },
  } });
  if (actor?.role !== "admin" || !actor.isVerified || actor.adminAccess?.status !== "active" || actor.adminAccess.isStaffAccount ||
      actor.adminAccess.email !== actor.email.toLowerCase()) throw new VendorSourcingError("Active Bundleen admin access is required.", 403);
  return actor;
}
export async function vendorRequest(requestId: string, client: Pick<typeof db, "hoaServiceRequest"> = db) {
  const request = await client.hoaServiceRequest.findUnique({ where: { id: requestId }, include: {
    community: { include: { hoaProfile: true } }, participations: { where: { response: "joined" }, select: { poolTier: true } },
  } });
  if (!request || request.community.status !== "active" || request.status !== "open_for_bids" ||
      !request.biddingClosesAt || request.biddingClosesAt <= new Date()) throw new VendorSourcingError("This bidding request is unavailable.", 404);
  return request;
}
export type VendorRequest = Awaited<ReturnType<typeof vendorRequest>>;
export function vendorRequestLocation(request: VendorRequest) {
  const p = request.community.hoaProfile;
  const verified = p?.addressVerificationStatus === "verified";
  return request.community.type === "hoa"
    ? { latitude: verified ? p.latitude : null, longitude: verified ? p.longitude : null, postalCode: p?.postalCode ?? null, locality: p?.locality ?? null, region: p?.region ?? null }
    : { latitude: request.community.centerLatitude, longitude: request.community.centerLongitude, postalCode: null, locality: null, region: null };
}
export function publicVendorRequest(request: VendorRequest): VendorRequestSummary {
  const location = vendorRequestLocation(request);
  return { id: request.id, category: request.category, areaLabel: [location.locality, location.region].filter(Boolean).join(", ") || "the community service area",
    homeCount: request.participations.length, biddingClosesAt: request.biddingClosesAt!.toISOString(),
    poolTemplate: parsePoolTemplate(request.poolTemplate), tierCounts: poolTierCounts(request.participations), requiresAfterPhoto: request.requiresAfterPhoto };
}
export function vendorLeadMatch(lead: VendorLead, request: VendorRequest, now = new Date()): { distanceMi: number | null; reason: string | null } {
  const location = vendorRequestLocation(request);
  const distance = lead.latitude != null && lead.longitude != null && location.latitude != null && location.longitude != null
    ? distanceMiles({ latitude: lead.latitude, longitude: lead.longitude }, { latitude: location.latitude, longitude: location.longitude }) : null;
  const region = location.region?.trim().toUpperCase() === "CALIFORNIA" ? "CA" : location.region?.trim().toUpperCase();
  const configured = Number(process.env.VENDOR_MATCH_RADIUS_MILES ?? 25);
  const radius = Number.isFinite(configured) && configured > 0 ? Math.min(configured, 100) : 25;
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const reason = ["declined", "unsubscribed", "bounced", "signed_up"].includes(lead.status) ? "This lead is not available for outreach."
    : !lead.categories.includes(request.category) ? "Service category does not match."
    : lead.licenseStatus !== "active" || !lead.licenseNumber || !lead.licenseExpiresAt || +lead.licenseExpiresAt < today || !vendorLicenseClassCovers(request.category, lead.licenseClasses) ? "A current active license in the required classification is required."
    : !region || region !== lead.licenseJurisdiction.toUpperCase() ? "License jurisdiction does not match the service region."
    : distance === null ? "Confirm the vendor location before matching by distance."
    : distance > radius ? "Vendor is outside the configured matching radius."
    : !lead.email || !lead.emailDigest || !lead.contactConfirmed ? "An admin must confirm the vendor email address." : null;
  return { distanceMi: distance === null ? null : Math.round(distance * 10) / 10, reason };
}
export async function lockVendorEmail(tx: Prisma.TransactionClient, digest: string): Promise<void> {
  await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${'vendor-email:' + digest}, 0))`);
}
export async function reserveVendorBudget(tx: Prisma.TransactionClient, key: string, amount: number, limit: number): Promise<void> {
  await tx.vendorOutreachBudget.upsert({ where: { key }, create: { key }, update: {} });
  const claim = await tx.vendorOutreachBudget.updateMany({ where: { key, used: { lte: limit - amount } }, data: { used: { increment: amount }, updatedAt: new Date() } });
  if (claim.count !== 1) throw new VendorSourcingError("The vendor invitation limit has been reached. Try a later approved batch.", 429);
}
