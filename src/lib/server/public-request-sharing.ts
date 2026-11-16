import "server-only";
import { randomBytes } from "node:crypto";
import { db } from "@/lib/server/db";
import { HoaWorkflowError } from "@/lib/server/hoa";
import { normalizeServiceCategory, CATEGORY_LABELS } from "@/lib/service-categories";

export const validShareToken = (value: string) => /^[A-Za-z0-9_-]{32}$/.test(value);
export const publicSharingEnabled = () => process.env.PUBLIC_REQUEST_SHARING === "1";
export const PUBLIC_REQUEST_STATUSES = ["collecting_interest", "open_for_bids", "bidding_closed", "awarded", "scheduled", "in_progress"] as const;
const token = () => randomBytes(24).toString("base64url");
function enabled() { if (!publicSharingEnabled()) throw new HoaWorkflowError("Request sharing is not available yet.", 404); }

/** Explicit manager action publishes only an optional request and generic
 * service data. No private titles, descriptions, participants or roster. */
export async function setRequestSharing(userId: string, requestId: string, action: "enable" | "disable" | "rotate") {
  enabled();
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "HoaServiceRequest" WHERE "id" = ${requestId} FOR UPDATE`;
    const request = await tx.hoaServiceRequest.findUnique({ where: { id: requestId }, select: { communityId: true, kind: true, status: true, community: { select: { status: true, type: true } } } });
    if (!request || request.community.type !== "hoa" || request.community.status !== "active") throw new HoaWorkflowError("That request is unavailable.", 404);
    await tx.$queryRaw`SELECT "id" FROM "CommunityStaffAssignment" WHERE "userId" = ${userId} AND "communityId" = ${request.communityId} FOR SHARE`;
    const assignment = await tx.communityStaffAssignment.findFirst({ where: { userId, communityId: request.communityId, status: "active", role: { in: ["hoa_manager", "hoa_team"] } }, select: { id: true } });
    if (!assignment) throw new HoaWorkflowError("You do not manage this request.", 403);
    if (request.kind !== "optional_group" || (action !== "disable" && !(PUBLIC_REQUEST_STATUSES as readonly string[]).includes(request.status))) throw new HoaWorkflowError("Only published optional requests can be shared.", 409);
    if (action === "disable") {
      await tx.requestPublicShare.updateMany({ where: { requestId }, data: { enabled: false } });
      return { enabled: false, path: null, communityPath: null };
    }
    const community = await tx.communityPublicShare.upsert({ where: { communityId: request.communityId }, create: { communityId: request.communityId, token: token() }, update: {} });
    const share = await tx.requestPublicShare.upsert({ where: { requestId }, create: { requestId, token: token() }, update: { enabled: true, ...(action === "rotate" ? { token: token() } : {}) } });
    return { enabled: true, path: `/c/${community.token}/r/${share.token}`, communityPath: `/c/${community.token}` };
  });
}

// Every field sent to an anonymous visitor is selected explicitly. User-authored
// request titles/descriptions can contain home addresses and are never selected.
const publicSelect = {
  category: true, status: true, enrollmentClosesAt: true, minHomes: true,
  _count: { select: { participations: { where: { response: "joined" as const, unitId: { not: null } } } } },
} as const;
export type PublicRequestSummary = { service: string; status: string; joinedHomes: number; minimumHomes: number | null; enrollmentClosesAt: string | null; path: string };
function serialize(row: { category: string; status: string; minHomes: number | null; enrollmentClosesAt: Date | null; _count: { participations: number } }, path: string): PublicRequestSummary {
  const category = normalizeServiceCategory(row.category);
  return { service: category ? CATEGORY_LABELS[category] : "Community service", status: row.status, joinedHomes: row._count.participations, minimumHomes: row.minHomes, enrollmentClosesAt: row.enrollmentClosesAt?.toISOString() ?? null, path };
}

export async function getPublicCommunity(communityToken: string): Promise<{ name: string; requests: PublicRequestSummary[] } | null> {
  if (!publicSharingEnabled() || !validShareToken(communityToken)) return null;
  const share = await db.communityPublicShare.findFirst({ where: { token: communityToken, community: { status: "active", type: "hoa" } }, select: { community: { select: { name: true, hoaRequests: { where: { kind: "optional_group", status: { in: [...PUBLIC_REQUEST_STATUSES] }, publicShare: { enabled: true } }, select: { ...publicSelect, publicShare: { select: { token: true } } }, orderBy: { createdAt: "desc" }, take: 100 } } } } });
  if (!share) return null;
  return { name: share.community.name, requests: share.community.hoaRequests.map(row => serialize(row, `/c/${communityToken}/r/${row.publicShare!.token}`)) };
}

export async function getPublicRequest(communityToken: string, requestToken: string): Promise<PublicRequestSummary | null> {
  if (!publicSharingEnabled() || !validShareToken(communityToken) || !validShareToken(requestToken)) return null;
  const share = await db.requestPublicShare.findFirst({ where: { token: requestToken, enabled: true, request: { kind: "optional_group", status: { in: [...PUBLIC_REQUEST_STATUSES] }, community: { status: "active", type: "hoa", publicShare: { token: communityToken } } } }, select: { request: { select: publicSelect } } });
  return share ? serialize(share.request, `/c/${communityToken}/r/${requestToken}`) : null;
}

export async function getManagedRequestShare(userId: string, requestId: string) {
  enabled();
  const request = await db.hoaServiceRequest.findUnique({ where: { id: requestId }, select: { communityId: true, publicShare: { select: { token: true, enabled: true } }, community: { select: { publicShare: { select: { token: true } } } } } });
  if (!request) throw new HoaWorkflowError("That request is unavailable.", 404);
  const { requireManagedHoa } = await import("@/lib/server/hoa");
  await requireManagedHoa(userId, request.communityId);
  if (!request.publicShare?.enabled || !request.community.publicShare) throw new HoaWorkflowError("Enable sharing before downloading a flyer.", 409);
  const summary = await getPublicRequest(request.community.publicShare.token, request.publicShare.token);
  if (!summary) throw new HoaWorkflowError("That shared request is no longer available.", 404);
  return summary;
}

export function canonicalShareUrl(path: string): string {
  const origin = new URL(process.env.BUNDLEEN_APP_URL ?? "https://bundleen.com");
  if (origin.protocol !== "https:" || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== "/") throw new Error("Invalid public sharing origin.");
  if (!/^\/c\/[A-Za-z0-9_-]{32}\/r\/[A-Za-z0-9_-]{32}$/.test(path)) throw new Error("Invalid public sharing path.");
  return new URL(path, origin).toString();
}
