import "server-only";

import { randomUUID } from "node:crypto";
import { normalizeServiceTrades } from "@/lib/service-categories";
import { providerVerificationSelect, providerVerificationState } from "@/lib/provider-verification";
import { parsePoolTemplate } from "@/lib/pool-bid-template";
import { buildAuditEntry } from "@/lib/server/audit";
import { db } from "@/lib/server/db";
import { HoaWorkflowError } from "@/lib/server/hoa";
import { areaCoversLocation } from "@/lib/server/hoa-market";
import { buildNotificationOps, scheduleOutboxDrain } from "@/lib/server/notifications";

/** Admin-only operations; neither invitation nor inclusion bypasses bid eligibility. */
async function requireActor(actorId: string) {
  const user = await db.user.findUnique({
    where: { id: actorId },
    select: { role: true, isVerified: true, email: true, adminAccess: { select: { status: true, email: true, isStaffAccount: true } } },
  });
  if (user?.role !== "admin" || !user.isVerified || user.adminAccess?.status !== "active" || user.adminAccess.isStaffAccount ||
    user.adminAccess.email !== user.email.toLowerCase()) {
    throw new HoaWorkflowError("Active Bundleen admin access is required.", 403);
  }
}

async function openRequest(communityId: string, requestId: string) {
  const request = await db.hoaServiceRequest.findFirst({
    where: { id: requestId, communityId, community: { status: "active" } },
    include: { community: { include: { hoaProfile: true } } },
  });
  if (!request || !parsePoolTemplate(request.poolTemplate)) throw new HoaWorkflowError("Pool request not found.", 404);
  if (request.status !== "open_for_bids" || !request.biddingClosesAt || request.biddingClosesAt <= new Date()) {
    throw new HoaWorkflowError("Invitations are available only while bidding is open.", 409);
  }
  return request;
}

type OpenRequest = Awaited<ReturnType<typeof openRequest>>;

async function candidates(request: OpenRequest, providerId?: string) {
  const profiles = await db.providerProfile.findMany({
    where: {
      accountStatus: "active", ...(providerId ? { userId: providerId } : {}),
      user: { role: "provider", isVerified: true },
    },
    orderBy: [{ companyName: "asc" }, { userId: "asc" }],
    take: providerId ? 1 : 500,
    select: {
      ...providerVerificationSelect, companyName: true, trades: true, notifyNewJobs: true,
      user: { select: { id: true, fullName: true, email: true, providerServiceAreas: {
        where: { status: "active" }, select: { centerLatitude: true, centerLongitude: true, radiusMiles: true, postalCodes: true },
      } } },
    },
  });
  const profile = request.community.hoaProfile;
  const verifiedLocation = profile?.addressVerificationStatus === "verified";
  const location = request.community.type === "hoa" ? {
    latitude: verifiedLocation ? profile.latitude : null,
    longitude: verifiedLocation ? profile.longitude : null,
    postalCode: profile?.postalCode ?? null,
    locality: profile?.locality ?? null,
    region: profile?.region ?? null,
  } : { latitude: request.community.centerLatitude, longitude: request.community.centerLongitude, postalCode: null, locality: null, region: null };
  return profiles.filter((p) => providerVerificationState(p).verified &&
    normalizeServiceTrades(p.trades).includes("pool_care") &&
    p.user.providerServiceAreas.some((area) => areaCoversLocation(area, location)));
}

export async function listProviderBidInvitations(actorId: string, communityId: string, requestId?: string) {
  await requireActor(actorId);
  const requests = await db.hoaServiceRequest.findMany({
    where: { communityId, status: "open_for_bids", biddingClosesAt: { gt: new Date() }, community: { status: "active" } },
    orderBy: { createdAt: "desc" }, take: 100,
    select: { id: true, title: true, poolTemplate: true },
  });
  const poolRequests = requests.filter((request) => parsePoolTemplate(request.poolTemplate));
  if (!requestId) return { requests: poolRequests.map(({ id, title }) => ({ id, title })), providers: [] };
  const request = await openRequest(communityId, requestId);
  const [eligible, invitations] = await Promise.all([
    candidates(request),
    db.providerBidInvitation.findMany({ where: { requestId }, select: { providerUserId: true } }),
  ]);
  const invited = new Set(invitations.map((invitation) => invitation.providerUserId));
  return {
    requests: poolRequests.map(({ id, title }) => ({ id, title })),
    providers: eligible.map((p) => ({ id: p.user.id, name: p.companyName || p.user.fullName, invited: invited.has(p.user.id) })),
  };
}

export async function inviteProviderToBid(actorId: string, communityId: string, requestId: string, providerId: string) {
  await requireActor(actorId);
  const request = await openRequest(communityId, requestId);
  const provider = (await candidates(request, providerId))[0];
  if (!provider) throw new HoaWorkflowError("Choose a current verified provider covering this request's category and location.", 400);
  const existing = await db.providerBidInvitation.findUnique({ where: { requestId_providerUserId: { requestId, providerUserId: providerId } } });
  if (existing) return { invited: true, alreadyInvited: true };
  const now = new Date();
  try {
    await db.$transaction([
      // Serializes invitations with closing/award; never invites against stale state.
      db.hoaServiceRequest.update({
        where: { id: request.id, updatedAt: request.updatedAt, status: "open_for_bids", biddingClosesAt: { gt: now } },
        data: { updatedAt: new Date(Math.max(now.getTime(), request.updatedAt.getTime() + 1)) },
      }),
      db.providerBidInvitation.create({ data: { id: randomUUID(), requestId, providerUserId: providerId, invitedByUserId: actorId } }),
      ...buildNotificationOps([{
        userId: providerId, email: provider.notifyNewJobs ? provider.user.email : null, kind: "request",
        title: `Invitation to quote: ${request.title}`,
        body: `${request.community.name} invites you to submit a pool-service quote. Review the locked tier counts and service terms in Bundleen.`,
        linkPath: "/app/provider/hoa", dedupeKey: `provider-bid-invite:${requestId}:${providerId}`,
      }]),
      db.adminAuditLog.create({ data: buildAuditEntry({
        actorUserId: actorId, action: "provider_bid_invited", targetType: "hoa_request", targetId: requestId,
        communityId, providerUserId: providerId, metadata: { category: request.category },
      }) }),
    ]);
  } catch (error) {
    const failure = error as { code?: string; meta?: { code?: string; driverAdapterError?: { cause?: { originalCode?: string } } }; cause?: { code?: string } } | null;
    const codes = [failure?.code, failure?.meta?.code, failure?.meta?.driverAdapterError?.cause?.originalCode, failure?.cause?.code];
    if (codes.some((code) => code && ["P2025", "P2002", "P1701", "P1702", "P1703", "40001", "40P01"].includes(code))) {
      throw new HoaWorkflowError("The request or invitation changed. Refresh before trying again.", 409);
    }
    throw error;
  }
  if (provider.notifyNewJobs) scheduleOutboxDrain();
  return { invited: true, alreadyInvited: false };
}
