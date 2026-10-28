import "server-only";

import { randomUUID } from "node:crypto";

import type { Prisma } from "@/generated/prisma/client";
import type {
  AgreementSummary,
  BidSummary,
  HoaManagerDashboard,
  HoaRequestSummary,
  OccurrenceSummary,
  ProviderFeedItem,
  ProviderHoaWorkspace,
  ResidentHoaHub,
  ServiceAreaSummary,
  VisitSummary,
} from "@/lib/hoa-types";
import { distanceMiles, roundDistanceMiles } from "@/lib/geo";
import { buildAuditEntry } from "@/lib/server/audit";
import { db } from "@/lib/server/db";
import { circleCoversLocation } from "@/lib/server/provider-coverage";
import {
  HoaWorkflowError,
  requireActiveResident,
  requireManagedHoa,
  serializeInvitation,
  serializeSurvey,
} from "@/lib/server/hoa";
import { getHoaProfile } from "@/lib/server/hoa-units";
import {
  findNeighborhoodManager,
  requireActiveNeighborhoodMember,
  requireCommunityManager,
} from "@/lib/server/market-auth";
import {
  homeownerTargets,
  type ServiceTarget,
  unitTargets,
  visitDataForTarget,
} from "@/lib/server/service-targets";
import {
  serializeOccurrenceForViewer,
  serializeVisitForViewer,
  visitViewInclude,
  type VisitViewRow,
} from "@/lib/server/visit-views";
import {
  buildPreferenceAwareNotificationOps,
  contentHash,
  type NotificationIntent,
} from "@/lib/server/notifications";
import type {
  AwardInput,
  BidSubmitInput,
  DayPlanInput,
  HoaRequestCreateInput,
  HoaRequestTransitionInput,
  ParticipationResponseInput,
  ReviewCreateInput,
  ServiceAreaInput,
  VisitStatusInput,
} from "@/lib/validation/hoa";

/**
 * The HOA service marketplace: request lifecycle, provider discovery, bids,
 * the single-award agreement, materialized occurrences/visits, the provider
 * day plan, completion, and reviews.
 *
 * Everything here re-derives authority from live Neon rows on every call —
 * a request/unit/bid id in the URL never grants access by itself.
 */

/* ── Serializers ─────────────────────────────────────────────────────────── */

type RequestRow = {
  id: string;
  communityId: string;
  title: string;
  category: string;
  description: string;
  kind: "compulsory_recurring" | "optional_group";
  recurrenceLabel: string | null;
  recurrenceIntervalDays: number | null;
  totalOccurrences: number;
  status: HoaRequestSummary["status"];
  opensAt: Date | null;
  enrollmentClosesAt: Date | null;
  biddingClosesAt: Date | null;
  startDate: Date | null;
  minHomes: number | null;
  maxHomes: number | null;
  participantsLockedAt: Date | null;
  awardedAt: Date | null;
  createdAt: Date;
  participations: Array<{ userId: string | null; response: "joined" | "declined" }>;
  _count: { bids: number };
};

const requestInclude = {
  participations: { select: { userId: true, response: true } },
  _count: { select: { bids: { where: { status: { in: ["submitted", "accepted", "rejected"] } } } } },
} satisfies Prisma.HoaServiceRequestInclude;

function serializeRequest(row: RequestRow, viewerUserId?: string): HoaRequestSummary {
  const joined = row.participations.filter((item) => item.response === "joined");
  const declined = row.participations.filter((item) => item.response === "declined");
  const viewerRow = viewerUserId
    ? row.participations.find((item) => item.userId === viewerUserId)
    : undefined;
  return {
    id: row.id,
    communityId: row.communityId,
    title: row.title,
    category: row.category,
    description: row.description,
    kind: row.kind,
    recurrenceLabel: row.recurrenceLabel,
    recurrenceIntervalDays: row.recurrenceIntervalDays,
    totalOccurrences: row.totalOccurrences,
    status: row.status,
    opensAt: row.opensAt?.toISOString() ?? null,
    enrollmentClosesAt: row.enrollmentClosesAt?.toISOString() ?? null,
    biddingClosesAt: row.biddingClosesAt?.toISOString() ?? null,
    startDate: row.startDate?.toISOString() ?? null,
    minHomes: row.minHomes,
    maxHomes: row.maxHomes,
    participantsLockedAt: row.participantsLockedAt?.toISOString() ?? null,
    awardedAt: row.awardedAt?.toISOString() ?? null,
    joinedCount: joined.length,
    declinedCount: declined.length,
    bidCount: row._count.bids,
    viewerResponse: viewerRow?.response ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

type BidRow = {
  id: string;
  requestId: string;
  providerUserId: string;
  status: BidSummary["status"];
  amountCents: number;
  currency: string;
  pricingBasis: BidSummary["pricingBasis"];
  perHomeCents: number | null;
  proposedStartDate: Date | null;
  estimatedDurationLabel: string | null;
  scope: string;
  exclusions: string | null;
  cadenceLabel: string | null;
  validUntil: Date | null;
  version: number;
  submittedAt: Date;
  provider: {
    fullName: string;
    providerProfile: {
      companyName: string | null;
      licenseVerifiedAt: Date | null;
      insuranceVerifiedAt: Date | null;
    } | null;
  };
};

const bidInclude = {
  provider: {
    select: {
      fullName: true,
      providerProfile: {
        select: { companyName: true, licenseVerifiedAt: true, insuranceVerifiedAt: true },
      },
    },
  },
} satisfies Prisma.ServiceBidInclude;

function serializeBid(row: BidRow): BidSummary {
  return {
    id: row.id,
    requestId: row.requestId,
    providerUserId: row.providerUserId,
    providerName: row.provider.fullName,
    providerCompany: row.provider.providerProfile?.companyName ?? null,
    providerVerified: Boolean(
      row.provider.providerProfile?.licenseVerifiedAt &&
        row.provider.providerProfile.insuranceVerifiedAt,
    ),
    status: row.status,
    amountCents: row.amountCents,
    currency: row.currency,
    pricingBasis: row.pricingBasis,
    perHomeCents: row.perHomeCents,
    proposedStartDate: row.proposedStartDate?.toISOString() ?? null,
    estimatedDurationLabel: row.estimatedDurationLabel,
    scope: row.scope,
    exclusions: row.exclusions,
    cadenceLabel: row.cadenceLabel,
    validUntil: row.validUntil?.toISOString() ?? null,
    version: row.version,
    submittedAt: row.submittedAt.toISOString(),
  };
}

type AgreementRow = {
  id: string;
  requestId: string;
  communityId: string;
  providerUserId: string;
  amountCents: number;
  currency: string;
  pricingBasis: BidSummary["pricingBasis"];
  perHomeCents: number | null;
  scope: string;
  cadenceLabel: string | null;
  lockedHomeCount: number;
  startDate: Date | null;
  endDate: Date | null;
  status: AgreementSummary["status"];
  createdAt: Date;
  request: { title: string };
  community: { name: string };
  provider: { fullName: string; providerProfile: { companyName: string | null } | null };
};

const agreementInclude = {
  request: { select: { title: true } },
  community: { select: { name: true } },
  provider: {
    select: { fullName: true, providerProfile: { select: { companyName: true } } },
  },
} satisfies Prisma.ServiceAgreementInclude;

function serializeAgreement(row: AgreementRow): AgreementSummary {
  return {
    id: row.id,
    requestId: row.requestId,
    requestTitle: row.request.title,
    communityId: row.communityId,
    communityName: row.community.name,
    providerUserId: row.providerUserId,
    providerName: row.provider.fullName,
    providerCompany: row.provider.providerProfile?.companyName ?? null,
    amountCents: row.amountCents,
    currency: row.currency,
    pricingBasis: row.pricingBasis,
    perHomeCents: row.perHomeCents,
    scope: row.scope,
    cadenceLabel: row.cadenceLabel,
    lockedHomeCount: row.lockedHomeCount,
    startDate: row.startDate?.toISOString() ?? null,
    endDate: row.endDate?.toISOString() ?? null,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Visit and occurrence views come from `visit-views.ts`.
 *
 * They are shared with the neighbourhood pages deliberately: "who may see this
 * address" must have exactly one implementation, and a second copy here would
 * be the obvious place for the two to drift apart.
 */
type VisitRow = VisitViewRow;
const visitInclude = visitViewInclude satisfies Prisma.ServiceVisitInclude;
const serializeVisit = serializeVisitForViewer;
const serializeOccurrence = serializeOccurrenceForViewer;

/* ── Manager: request lifecycle ──────────────────────────────────────────── */

async function activeResidentIntents(
  communityId: string,
  excludeUserId: string,
  build: (user: { id: string; email: string }) => NotificationIntent,
): Promise<NotificationIntent[]> {
  const residents = await db.communityMembership.findMany({
    where: { communityId, status: "active", NOT: { userId: excludeUserId } },
    select: { user: { select: { id: true, email: true } } },
  });
  return residents.map(({ user }) => build(user));
}

/** Units a compulsory request covers: every unit that is not retired. */
async function compulsoryAudience(communityId: string) {
  return db.communityUnit.findMany({
    where: { communityId, occupancyStatus: { not: "inactive" } },
    select: {
      id: true,
      memberships: {
        where: { status: "active" },
        select: { userId: true },
        take: 1,
      },
    },
  });
}

export async function createHoaRequest(
  userId: string,
  communityId: string,
  input: HoaRequestCreateInput,
): Promise<string> {
  const community = await requireManagedHoa(userId, communityId);
  const requestId = randomUUID();
  const now = new Date();

  const isCompulsory = input.kind === "compulsory_recurring";
  const publishStatus = isCompulsory ? "open_for_bids" : "collecting_interest";
  const status = input.publish ? publishStatus : "draft";

  const audience =
    input.publish && isCompulsory ? await compulsoryAudience(communityId) : [];
  if (input.publish && isCompulsory && audience.length === 0) {
    throw new HoaWorkflowError("Add homes to the HOA before publishing a compulsory service.");
  }

  const residentIntents = input.publish
    ? await activeResidentIntents(communityId, userId, (user) => ({
        userId: user.id,
        email: user.email,
        kind: "request",
        title: isCompulsory
          ? `${community.name}: new community service out for bids`
          : `${community.name}: optional service — join by the deadline`,
        body: input.title,
        linkPath: "/app/homeowner/community",
        dedupeKey: `request-open:${requestId}:${user.id}`,
      }))
    : [];
  const providerIntents =
    input.publish && isCompulsory
      ? await eligibleProviderIntentsForRequest({
          requestId,
          communityId,
          communityName: community.name,
          title: input.title,
          category: input.category,
          biddingClosesAt: input.biddingClosesAt ? new Date(input.biddingClosesAt) : null,
        })
      : [];

  await db.$transaction([
    db.hoaServiceRequest.create({
      data: {
        id: requestId,
        communityId,
        createdByUserId: userId,
        title: input.title,
        category: input.category,
        description: input.description,
        kind: input.kind,
        recurrenceLabel: input.recurrenceLabel,
        recurrenceIntervalDays: input.recurrenceIntervalDays ?? null,
        totalOccurrences: input.totalOccurrences,
        status,
        opensAt: input.publish ? now : null,
        enrollmentClosesAt: input.enrollmentClosesAt ? new Date(input.enrollmentClosesAt) : null,
        biddingClosesAt: input.biddingClosesAt ? new Date(input.biddingClosesAt) : null,
        startDate: input.startDate ? new Date(input.startDate) : null,
        minHomes: input.minHomes ?? null,
        maxHomes: input.maxHomes ?? null,
        // Compulsory audiences are locked the moment they are snapshotted.
        participantsLockedAt: input.publish && isCompulsory ? now : null,
      },
    }),
    ...(input.publish && isCompulsory
      ? [
          db.hoaRequestParticipation.createMany({
            data: audience.map((unit) => ({
              id: randomUUID(),
              requestId,
              unitId: unit.id,
              userId: unit.memberships[0]?.userId ?? null,
              response: "joined" as const,
            })),
            skipDuplicates: true,
          }),
        ]
      : []),
    db.adminAuditLog.create({
      data: buildAuditEntry({
        actorUserId: userId,
        action: "hoa_request_created",
        targetType: "hoa_request",
        targetId: requestId,
        communityId,
        metadata: { kind: input.kind, status, unitCount: audience.length },
      }),
    }),
    ...(await buildPreferenceAwareNotificationOps([...residentIntents, ...providerIntents])),
  ]);
  return requestId;
}

/** Seven complete days for provider quotes after automatic enrollment closure. */
const DEFAULT_BIDDING_WINDOW_MS = 7 * 86_400_000;

type BiddingRequest = {
  id: string;
  communityId: string;
  title: string;
  category: string;
  kind: "compulsory_recurring" | "optional_group";
  status: HoaRequestSummary["status"];
  minHomes: number | null;
  enrollmentClosesAt: Date | null;
  biddingClosesAt: Date | null;
  participantsLockedAt: Date | null;
  updatedAt: Date;
  community: { type: "hoa" | "neighborhood" };
  participations: Array<{ unitId: string | null; userId: string | null; response: string }>;
};

function joinedHomeCount(request: BiddingRequest): number {
  return request.participations.filter(
    (item) => item.response === "joined" &&
      (request.community.type === "neighborhood" ? item.userId : item.unitId),
  ).length;
}

function biddingClaim(request: BiddingRequest, automaticAt?: Date): Prisma.HoaServiceRequestWhereUniqueInput {
  const joined = request.participations.filter((item) => item.response === "joined");
  // Reject a stale enrollment snapshot if a joined home changed before the claim.
  const joinedSnapshot = joined.map(({ unitId, userId }) => ({ unitId, userId, response: "joined" as const }));
  return {
    id: request.id,
    kind: "optional_group",
    status: "collecting_interest",
    participantsLockedAt: null,
    minHomes: request.minHomes,
    updatedAt: request.updatedAt,
    AND: [
      { participations: { every: { OR: [{ response: { not: "joined" } }, ...joinedSnapshot] } } },
      ...joinedSnapshot.map((home) => ({ participations: { some: home } })),
    ],
    biddingClosesAt: request.biddingClosesAt,
    community: {
      status: "active",
      ...(automaticAt ? { type: "neighborhood" as const } : {}),
    },
    ...(automaticAt
      ? { enrollmentClosesAt: { equals: request.enrollmentClosesAt, lte: automaticAt } }
      : {}),
  };
}

/**
 * The manager and deadline worker use the same enrollment/participant rules.
 * The guarded update is first in a short batch transaction: losing a race throws
 * P2025 and rolls back every audit and notification instead of repeating them.
 */
async function openRequestBidding(
  request: BiddingRequest,
  input: {
    actorUserId: string | null;
    via: string;
    communityName: string;
    now: Date;
    biddingClosesAt: Date | null;
    automaticAt?: Date;
  },
): Promise<void> {
  if (request.kind !== "optional_group" || request.status !== "collecting_interest" || request.participantsLockedAt) {
    throw new HoaWorkflowError("Only an optional request collecting interest can open bidding.");
  }
  if (!input.biddingClosesAt || input.biddingClosesAt <= input.now) {
    throw new HoaWorkflowError("Set a future bidding deadline to open bidding.", 400);
  }
  const lockedHomeCount = joinedHomeCount(request);
  if (lockedHomeCount === 0) throw new HoaWorkflowError("No homes joined this service.");
  if (request.minHomes != null && lockedHomeCount < request.minHomes) {
    throw new HoaWorkflowError(`Only ${lockedHomeCount} of the required ${request.minHomes} homes joined.`);
  }
  const providerIntents = await eligibleProviderIntentsForRequest({
    requestId: request.id,
    communityId: request.communityId,
    communityName: input.communityName,
    title: request.title,
    category: request.category,
    biddingClosesAt: input.biddingClosesAt,
  });
  const auditMetadata = {
    lockedHomeCount,
    context: request.community.type,
    via: input.via,
  };
  await db.$transaction([
    db.hoaServiceRequest.update({
      where: biddingClaim(request, input.automaticAt),
      data: {
        status: "open_for_bids",
        biddingClosesAt: input.biddingClosesAt,
        participantsLockedAt: input.now,
      },
    }),
    db.adminAuditLog.create({
      data: buildAuditEntry({
        actorUserId: input.actorUserId,
        action: "hoa_participants_locked",
        targetType: "hoa_request",
        targetId: request.id,
        communityId: request.communityId,
        metadata: auditMetadata,
      }),
    }),
    db.adminAuditLog.create({
      data: buildAuditEntry({
        actorUserId: input.actorUserId,
        action: "hoa_request_status_changed",
        targetType: "hoa_request",
        targetId: request.id,
        communityId: request.communityId,
        metadata: {
          previousStatus: request.status,
          nextStatus: "open_for_bids",
          ...auditMetadata,
        },
      }),
    }),
    ...(await buildPreferenceAwareNotificationOps(providerIntents)),
  ]);
}

/** Worker-only transition; this never grants a resident manager privileges. */
export async function reconcileNeighborhoodEnrollment(
  requestId: string,
  now: Date,
): Promise<"opened" | "failed" | "skipped"> {
  const request = await db.hoaServiceRequest.findUnique({
    where: { id: requestId },
    include: {
      community: { select: { type: true, status: true, name: true } },
      participations: { select: { unitId: true, userId: true, response: true } },
    },
  });
  if (!request || request.community.type !== "neighborhood" || request.community.status !== "active" ||
      request.kind !== "optional_group" || request.status !== "collecting_interest" ||
      request.participantsLockedAt || !request.enrollmentClosesAt || request.enrollmentClosesAt > now) {
    return "skipped";
  }
  try {
    const lockedHomeCount = joinedHomeCount(request);
    if (lockedHomeCount === 0 || (request.minHomes != null && lockedHomeCount < request.minHomes)) {
      await db.$transaction([
        db.hoaServiceRequest.update({
          where: biddingClaim(request, now),
          data: { status: "failed" },
        }),
        db.adminAuditLog.create({
          data: buildAuditEntry({
            actorUserId: null,
            action: "hoa_request_status_changed",
            targetType: "hoa_request",
            targetId: request.id,
            communityId: request.communityId,
            metadata: {
              previousStatus: "collecting_interest",
              nextStatus: "failed",
              context: "neighborhood",
              via: "deadline_reconciliation",
              reason: "insufficient_joined_homes",
              lockedHomeCount,
            },
          }),
        }),
      ]);
      return "failed";
    }
    await openRequestBidding(request, {
      actorUserId: null,
      via: "deadline_reconciliation",
      communityName: request.community.name,
      now,
      biddingClosesAt: request.biddingClosesAt && request.biddingClosesAt > now
        ? request.biddingClosesAt
        : new Date(now.getTime() + DEFAULT_BIDDING_WINDOW_MS),
      automaticAt: now,
    });
    return "opened";
  } catch (error) {
    if ((error as { code?: string }).code === "P2025") return "skipped";
    throw error;
  }
}

/**
 * Manager lifecycle transitions. The transition table is enforced here — the
 * client sends an action name, never a raw status value.
 *
 * Authority is chosen by community type in {@link requireRequestManager}: an
 * HOA request still needs its scoped HOA manager, a neighbourhood request needs
 * that neighbourhood's one assigned resident manager, and a Bundleen admin has
 * an audited recovery path over both. The `via` field lands in every audit
 * entry, so a recovery action is never indistinguishable from a routine one.
 */
export async function transitionHoaRequest(
  userId: string,
  requestId: string,
  input: HoaRequestTransitionInput,
): Promise<void> {
  const request = await db.hoaServiceRequest.findUnique({
    where: { id: requestId },
    include: {
      community: { select: { type: true } },
      participations: { select: { unitId: true, userId: true, response: true } },
      agreement: { select: { id: true, status: true, providerUserId: true } },
    },
  });
  if (!request) throw new HoaWorkflowError("That service request does not exist.", 404);
  const authority = await requireCommunityManager(userId, request.communityId);
  const community = { id: authority.communityId, name: authority.communityName };
  const isNeighborhood = request.community.type === "neighborhood";
  const residentLinkPath = isNeighborhood
    ? "/app/homeowner/neighbourhood"
    : "/app/homeowner/community";
  const managerLinkPath = isNeighborhood
    ? "/app/homeowner/neighbourhood"
    : "/app/hoa/dashboard";
  const now = new Date();

  const audit = (nextStatus: string, extra?: Record<string, unknown>) =>
    db.adminAuditLog.create({
      data: buildAuditEntry({
        actorUserId: userId,
        action: "hoa_request_status_changed",
        targetType: "hoa_request",
        targetId: request.id,
        communityId: request.communityId,
        metadata: {
          previousStatus: request.status,
          nextStatus,
          context: request.community.type,
          via: authority.via,
          ...extra,
        },
      }),
    });

  switch (input.action) {
    case "publish": {
      if (request.status !== "draft") {
        throw new HoaWorkflowError("Only a draft request can be published.");
      }
      const isCompulsory = request.kind === "compulsory_recurring";
      if (isCompulsory && !request.biddingClosesAt && !input.biddingClosesAt) {
        throw new HoaWorkflowError("Set the bidding deadline before publishing.", 400);
      }
      if (!isCompulsory && !request.enrollmentClosesAt) {
        throw new HoaWorkflowError("Set the enrollment deadline before publishing.", 400);
      }
      const audience = isCompulsory ? await compulsoryAudience(request.communityId) : [];
      if (isCompulsory && audience.length === 0) {
        throw new HoaWorkflowError("Add homes to the HOA before publishing a compulsory service.");
      }
      const intents = await activeResidentIntents(request.communityId, userId, (user) => ({
        userId: user.id,
        email: user.email,
        kind: "request",
        title: isCompulsory
          ? `${community.name}: new community service out for bids`
          : `${community.name}: optional service — join by the deadline`,
        body: request.title,
        linkPath: residentLinkPath,
        dedupeKey: `request-open:${request.id}:${user.id}`,
      }));
      const providerIntents = isCompulsory
        ? await eligibleProviderIntentsForRequest({
            requestId: request.id,
            communityId: request.communityId,
            communityName: community.name,
            title: request.title,
            category: request.category,
            biddingClosesAt: input.biddingClosesAt
              ? new Date(input.biddingClosesAt)
              : request.biddingClosesAt,
          })
        : [];
      await db.$transaction([
        db.hoaServiceRequest.update({
          where: { id: request.id },
          data: {
            status: isCompulsory ? "open_for_bids" : "collecting_interest",
            opensAt: request.opensAt ?? now,
            participantsLockedAt: isCompulsory ? now : null,
            ...(input.biddingClosesAt ? { biddingClosesAt: new Date(input.biddingClosesAt) } : {}),
          },
        }),
        ...(isCompulsory
          ? [
              db.hoaRequestParticipation.createMany({
                data: audience.map((unit) => ({
                  id: randomUUID(),
                  requestId: request.id,
                  unitId: unit.id,
                  userId: unit.memberships[0]?.userId ?? null,
                  response: "joined" as const,
                })),
                skipDuplicates: true,
              }),
            ]
          : []),
        audit(isCompulsory ? "open_for_bids" : "collecting_interest"),
        ...(await buildPreferenceAwareNotificationOps([...intents, ...providerIntents])),
      ]);
      return;
    }

    case "open_bidding": {
      try {
        await openRequestBidding(request, {
          actorUserId: userId,
          via: authority.via,
          communityName: community.name,
          now,
          biddingClosesAt: input.biddingClosesAt
            ? new Date(input.biddingClosesAt)
            : request.biddingClosesAt,
        });
      } catch (error) {
        if ((error as { code?: string }).code === "P2025") {
          throw new HoaWorkflowError("This request changed. Refresh before trying again.", 409);
        }
        throw error;
      }
      return;
    }

    case "close_bidding": {
      if (request.status !== "open_for_bids") {
        throw new HoaWorkflowError("Bidding is not open on this request.");
      }
      await db.$transaction([
        db.hoaServiceRequest.update({
          where: { id: request.id },
          data: { status: "bidding_closed", biddingClosesAt: request.biddingClosesAt ?? now },
        }),
        audit("bidding_closed"),
      ]);
      return;
    }

    case "complete": {
      if (!["awarded", "scheduled", "in_progress"].includes(request.status)) {
        throw new HoaWorkflowError("Only awarded work can be completed.");
      }
      if (!request.agreement) {
        throw new HoaWorkflowError("This request has no agreement to complete.");
      }
      const unresolved = await db.serviceOccurrence.count({
        where: {
          agreementId: request.agreement.id,
          status: { in: ["planned", "in_progress"] },
        },
      });
      if (unresolved > 0) {
        throw new HoaWorkflowError(
          `${unresolved} service ${unresolved === 1 ? "cycle is" : "cycles are"} still open. Close each occurrence first.`,
        );
      }
      const managerUser = await db.user.findUnique({
        where: { id: userId },
        select: { email: true },
      });
      await db.$transaction([
        db.hoaServiceRequest.update({ where: { id: request.id }, data: { status: "completed" } }),
        db.serviceAgreement.update({
          where: { id: request.agreement.id },
          data: { status: "completed" },
        }),
        audit("completed"),
        ...(await buildPreferenceAwareNotificationOps([
          {
            userId,
            email: managerUser?.email ?? null,
            kind: "review",
            title: `Review the completed service for ${community.name}`,
            body: `“${request.title}” is complete. Share your review of the provider.`,
            linkPath: managerLinkPath,
            dedupeKey: `agreement-review-request:${request.agreement.id}:${userId}`,
          },
        ])),
      ]);
      return;
    }

    case "cancel": {
      if (
        !["draft", "collecting_interest", "open_for_bids", "bidding_closed"].includes(
          request.status,
        )
      ) {
        throw new HoaWorkflowError(
          "Awarded work cannot be cancelled here. Contact Bundleen support.",
        );
      }
      const [residentIntents, submittedBids] = await Promise.all([
        activeResidentIntents(request.communityId, userId, (user) => ({
          userId: user.id,
          email: user.email,
          kind: "schedule",
          title: `${community.name}: service request cancelled`,
          body: `“${request.title}” has been cancelled. No service is currently scheduled for this request.`,
          linkPath: residentLinkPath,
          dedupeKey: `request-cancelled:${request.id}:${user.id}`,
        })),
        db.serviceBid.findMany({
          where: { requestId: request.id, status: "submitted" },
          select: { provider: { select: { id: true, email: true } } },
        }),
      ]);
      const cancellationIntents: NotificationIntent[] = [
        ...residentIntents,
        ...submittedBids.map(({ provider }) => ({
          userId: provider.id,
          email: provider.email,
          kind: "schedule" as const,
          title: `${community.name}: request cancelled`,
          body: `“${request.title}” was cancelled, so bidding has ended.`,
          linkPath: "/app/provider/hoa",
          dedupeKey: `request-cancelled:${request.id}:${provider.id}`,
        })),
      ];
      await db.$transaction([
        db.hoaServiceRequest.update({ where: { id: request.id }, data: { status: "cancelled" } }),
        db.serviceBid.updateMany({
          where: { requestId: request.id, status: "submitted" },
          data: { status: "expired", decidedAt: now },
        }),
        audit("cancelled"),
        ...(await buildPreferenceAwareNotificationOps(cancellationIntents)),
      ]);
      return;
    }
  }
}

/* ── Resident: optional participation ────────────────────────────────────── */

export async function respondToOptionalRequest(
  userId: string,
  requestId: string,
  input: ParticipationResponseInput,
): Promise<void> {
  const request = await db.hoaServiceRequest.findUnique({
    where: { id: requestId },
    select: {
      id: true,
      communityId: true,
      kind: true,
      status: true,
      enrollmentClosesAt: true,
      participantsLockedAt: true,
      maxHomes: true,
      participations: { where: { response: "joined" }, select: { userId: true } },
    },
  });
  if (!request) throw new HoaWorkflowError("That HOA request does not exist.", 404);
  const membership = await requireActiveResident(userId, request.communityId);
  if (!membership.unitId) {
    throw new HoaWorkflowError("Your membership is not linked to a home. Contact your HOA manager.");
  }
  if (request.kind !== "optional_group" || request.status !== "collecting_interest") {
    throw new HoaWorkflowError("This request is not open for sign-ups.");
  }
  if (request.participantsLockedAt) {
    throw new HoaWorkflowError("Sign-ups for this request are locked.");
  }
  if (request.enrollmentClosesAt && request.enrollmentClosesAt <= new Date()) {
    throw new HoaWorkflowError("Sign-ups for this request have closed.");
  }
  const alreadyJoined = request.participations.some((item) => item.userId === userId);
  if (
    input.response === "joined" &&
    !alreadyJoined &&
    request.maxHomes != null &&
    request.participations.length >= request.maxHomes
  ) {
    throw new HoaWorkflowError("This service has reached its maximum number of homes.");
  }

  await db.hoaRequestParticipation.upsert({
    where: { requestId_unitId: { requestId, unitId: membership.unitId } },
    create: {
      id: randomUUID(),
      requestId,
      userId,
      unitId: membership.unitId,
      response: input.response,
    },
    update: { response: input.response, userId },
  });
}

/* ── Provider: coverage areas ────────────────────────────────────────────── */

function serializeArea(row: {
  id: string;
  label: string;
  centerLatitude: number | null;
  centerLongitude: number | null;
  radiusMiles: number | null;
  postalCodes: string[];
  status: "active" | "removed";
}): ServiceAreaSummary {
  return {
    id: row.id,
    label: row.label,
    centerLatitude: row.centerLatitude,
    centerLongitude: row.centerLongitude,
    radiusMiles: row.radiusMiles,
    postalCodes: row.postalCodes,
    status: row.status,
  };
}

const MAX_SERVICE_AREAS = 10;

export async function upsertServiceArea(
  providerUserId: string,
  input: ServiceAreaInput,
  areaId?: string,
): Promise<ServiceAreaSummary> {
  await requireProvider(providerUserId, { allowPending: true });

  if (!areaId) {
    const count = await db.providerServiceArea.count({
      where: { providerUserId, status: "active" },
    });
    if (count >= MAX_SERVICE_AREAS) {
      throw new HoaWorkflowError(`Keep at most ${MAX_SERVICE_AREAS} active service areas.`);
    }
  } else {
    const existing = await db.providerServiceArea.findFirst({
      where: { id: areaId, providerUserId },
      select: { id: true },
    });
    if (!existing) throw new HoaWorkflowError("That service area does not exist.", 404);
  }

  const id = areaId ?? randomUUID();
  const data = {
    label: input.label,
    centerLatitude: input.centerLatitude ?? null,
    centerLongitude: input.centerLongitude ?? null,
    radiusMiles: input.radiusMiles ?? null,
    postalCodes: input.postalCodes.map((code) => code.toUpperCase()),
    status: "active" as const,
  };

  const [area] = await db.$transaction([
    db.providerServiceArea.upsert({
      where: { id },
      create: { id, providerUserId, ...data },
      update: data,
    }),
    db.adminAuditLog.create({
      data: buildAuditEntry({
        actorUserId: providerUserId,
        action: "provider_service_area_changed",
        targetType: "provider_service_area",
        targetId: id,
        providerUserId,
        metadata: { status: "active" },
      }),
    }),
  ]);
  return serializeArea(area);
}

export async function removeServiceArea(providerUserId: string, areaId: string): Promise<void> {
  const area = await db.providerServiceArea.findFirst({
    where: { id: areaId, providerUserId, status: "active" },
    select: { id: true },
  });
  if (!area) throw new HoaWorkflowError("That service area does not exist.", 404);
  await db.$transaction([
    db.providerServiceArea.update({ where: { id: areaId }, data: { status: "removed" } }),
    db.adminAuditLog.create({
      data: buildAuditEntry({
        actorUserId: providerUserId,
        action: "provider_service_area_changed",
        targetType: "provider_service_area",
        targetId: areaId,
        providerUserId,
        metadata: { status: "removed" },
      }),
    }),
  ]);
}

/* ── Provider eligibility and discovery ──────────────────────────────────── */

type ProviderGate = {
  userId: string;
  trades: string[];
  eligible: boolean;
  ineligibleReason: string | null;
};

/**
 * A provider may act in the marketplace only while their account is active
 * and both credentials are admin-verified. Browser state has no say.
 */
async function requireProvider(
  userId: string,
  options?: { allowPending?: boolean },
): Promise<ProviderGate> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { role: true, providerProfile: true },
  });
  if (!user || user.role !== "provider" || !user.providerProfile) {
    throw new HoaWorkflowError("Only provider accounts can do this.", 403);
  }
  const profile = user.providerProfile;
  const gate: ProviderGate = {
    userId,
    trades: profile.trades.map((trade) => trade.toLowerCase()),
    eligible: true,
    ineligibleReason: null,
  };
  if (profile.accountStatus === "suspended") {
    gate.eligible = false;
    gate.ineligibleReason = "Your provider account is suspended.";
  } else if (profile.accountStatus !== "active") {
    gate.eligible = false;
    gate.ineligibleReason = "Your provider account is awaiting Bundleen activation.";
  } else if (!profile.licenseVerifiedAt || !profile.insuranceVerifiedAt) {
    gate.eligible = false;
    gate.ineligibleReason =
      "Bidding opens once Bundleen verifies your license and insurance.";
  }
  if (!gate.eligible && !options?.allowPending) {
    throw new HoaWorkflowError(gate.ineligibleReason ?? "Provider account is not eligible.", 403);
  }
  return gate;
}

/**
 * The location a provider is matched against, for either community type.
 *
 * For an HOA this is the verified profile address. For a neighbourhood it is
 * the community's admin-owned approximate centre — never a participant's
 * coordinates, and never precise enough to identify a home. Both are
 * server-derived; nothing here can be supplied by a client.
 */
type HoaLocation = {
  latitude: number | null;
  longitude: number | null;
  postalCode: string | null;
  locality: string | null;
  region: string | null;
};

/**
 * Whether one provider area covers one HOA location.
 *
 * Delegates the geometry to {@link circleCoversLocation} so the matcher, the
 * profile editor, and the onboarding preview cannot disagree about where a
 * circle ends. That function distinguishes "outside" from "cannot tell"; for
 * eligibility, unknown is not coverage — a request with no verified
 * coordinates is never treated as being at distance zero.
 */
export function areaCoversLocation(
  area: {
    centerLatitude: number | null;
    centerLongitude: number | null;
    radiusMiles: number | null;
    postalCodes: string[];
  },
  location: HoaLocation,
): boolean {
  return (
    circleCoversLocation(area, {
      latitude: location.latitude,
      longitude: location.longitude,
      postalCode: location.postalCode,
    }).covered === true
  );
}

/** All checks the spec requires before a provider may even see a request. */
function providerCanSeeRequest(input: {
  gate: ProviderGate;
  areas: Array<{
    centerLatitude: number | null;
    centerLongitude: number | null;
    radiusMiles: number | null;
    postalCodes: string[];
  }>;
  category: string;
  location: HoaLocation;
  biddingClosesAt: Date | null;
  now: Date;
}): boolean {
  if (!input.gate.eligible) return false;
  if (!input.gate.trades.includes(input.category.toLowerCase())) return false;
  if (input.biddingClosesAt && input.biddingClosesAt <= input.now) return false;
  return input.areas.some((area) => areaCoversLocation(area, input.location));
}

/**
 * The server-approved match location for one community, of either type.
 *
 * HOA → the verified profile address, and only when the address has actually
 * been verified: an HOA whose geocoding is pending or needs correction has no
 * routeable location, and a provider must not be matched to it.
 *
 * Neighbourhood → the admin-owned community centre. This is the "approximate
 * point" providers are allowed to see. It is not derived from participants, so
 * no amount of feed reading reveals where anybody lives.
 */
async function communityMatchLocation(communityId: string): Promise<HoaLocation> {
  const community = await db.community.findUnique({
    where: { id: communityId },
    select: {
      type: true,
      name: true,
      centerLatitude: true,
      centerLongitude: true,
      hoaProfile: {
        select: {
          latitude: true,
          longitude: true,
          postalCode: true,
          locality: true,
          region: true,
          addressVerificationStatus: true,
        },
      },
    },
  });
  if (!community) {
    return { latitude: null, longitude: null, postalCode: null, locality: null, region: null };
  }

  if (community.type === "hoa") {
    const profile = community.hoaProfile;
    const verified = profile?.addressVerificationStatus === "verified";
    return {
      latitude: verified ? (profile?.latitude ?? null) : null,
      longitude: verified ? (profile?.longitude ?? null) : null,
      postalCode: profile?.postalCode ?? null,
      locality: profile?.locality ?? null,
      region: profile?.region ?? null,
    };
  }

  return {
    latitude: community.centerLatitude,
    longitude: community.centerLongitude,
    // A neighbourhood has no postal address of its own; postal-code-only
    // coverage therefore never matches one, which is the correct answer rather
    // than a gap: the circle geometry is what defines a neighbourhood.
    postalCode: null,
    locality: community.name,
    region: null,
  };
}

/** @deprecated Superseded by {@link communityMatchLocation}. Kept for clarity. */
async function hoaLocation(communityId: string): Promise<HoaLocation> {
  return communityMatchLocation(communityId);
}

/**
 * Rounded miles from the nearest covering area to the community's point.
 *
 * A tenth of a mile is precise enough for a provider to judge a job and far
 * too coarse to locate a home — and it is measured from the community centre,
 * never from a participant.
 */
function approximateDistanceMi(
  areas: ReadonlyArray<{ centerLatitude: number | null; centerLongitude: number | null }>,
  location: HoaLocation,
): number | null {
  if (location.latitude == null || location.longitude == null) return null;
  const distances = areas
    .filter((area) => area.centerLatitude != null && area.centerLongitude != null)
    .map((area) =>
      distanceMiles(
        { latitude: area.centerLatitude as number, longitude: area.centerLongitude as number },
        { latitude: location.latitude as number, longitude: location.longitude as number },
      ),
    );
  return distances.length > 0 ? roundDistanceMiles(Math.min(...distances)) : null;
}

/** Resolves the same provider eligibility rules used by the marketplace feed. */
async function eligibleProviderIntentsForRequest(input: {
  requestId: string;
  communityId: string;
  communityName: string;
  title: string;
  category: string;
  biddingClosesAt: Date | null;
}): Promise<NotificationIntent[]> {
  const [location, providers] = await Promise.all([
    hoaLocation(input.communityId),
    db.providerProfile.findMany({
      where: {
        accountStatus: "active",
        licenseVerifiedAt: { not: null },
        insuranceVerifiedAt: { not: null },
      },
      select: {
        trades: true,
        notifyNewJobs: true,
        user: {
          select: {
            id: true,
            email: true,
            providerServiceAreas: {
              where: { status: "active" },
              select: {
                centerLatitude: true,
                centerLongitude: true,
                radiusMiles: true,
                postalCodes: true,
              },
            },
          },
        },
      },
    }),
  ]);
  const now = new Date();

  return providers
    .filter((profile) =>
      providerCanSeeRequest({
        gate: {
          userId: profile.user.id,
          trades: profile.trades.map((trade) => trade.toLowerCase()),
          eligible: true,
          ineligibleReason: null,
        },
        areas: profile.user.providerServiceAreas,
        category: input.category,
        location,
        biddingClosesAt: input.biddingClosesAt,
        now,
      }),
    )
    .map((profile) => ({
      userId: profile.user.id,
      email: profile.notifyNewJobs ? profile.user.email : null,
      kind: "request" as const,
      title: `New ${input.category} request near your service area`,
      body: `${input.communityName} opened “${input.title}” for provider bids.`,
      linkPath: "/app/provider/hoa",
      dedupeKey: `provider-request-open:${input.requestId}:${profile.user.id}`,
    }));
}

/**
 * The one provider marketplace contract.
 *
 * Returns every open opportunity this provider is eligible for, in *both*
 * community types, plus their own bids, agreements, and day plans. There is no
 * second feed and no separate neighbourhood endpoint: a provider bids on work,
 * and where the work came from is a property of the item, not of the API.
 *
 * Eligibility is computed here, server-side, from the provider's account
 * status, verified credentials, trades, and active service areas against the
 * community's server-approved location. Nothing in the request influences it.
 */
export async function getProviderHoaWorkspace(userId: string): Promise<ProviderHoaWorkspace> {
  const gate = await requireProvider(userId, { allowPending: true });
  const now = new Date();

  const [areas, openRequests, myBids, agreements] = await Promise.all([
    db.providerServiceArea.findMany({
      where: { providerUserId: userId, status: "active" },
      orderBy: { createdAt: "asc" },
    }),
    db.hoaServiceRequest.findMany({
      where: {
        status: "open_for_bids",
        // Both community types, filtered per-item below by real coverage.
        community: { status: "active" },
        OR: [{ biddingClosesAt: null }, { biddingClosesAt: { gt: now } }],
      },
      orderBy: { biddingClosesAt: "asc" },
      take: 200,
      include: {
        community: {
          select: {
            name: true,
            type: true,
            centerLatitude: true,
            centerLongitude: true,
            hoaProfile: {
              select: {
                latitude: true,
                longitude: true,
                postalCode: true,
                locality: true,
                region: true,
                addressVerificationStatus: true,
              },
            },
          },
        },
        participations: { where: { response: "joined" }, select: { id: true } },
        bids: { where: { providerUserId: userId }, include: bidInclude },
      },
    }),
    db.serviceBid.findMany({
      where: { providerUserId: userId },
      orderBy: { updatedAt: "desc" },
      take: 50,
      include: bidInclude,
    }),
    db.serviceAgreement.findMany({
      where: { providerUserId: userId },
      orderBy: { createdAt: "desc" },
      take: 25,
      include: agreementInclude,
    }),
  ]);

  const feed: ProviderFeedItem[] = [];
  for (const request of openRequests) {
    const isNeighborhood = request.community.type === "neighborhood";
    const profile = request.community.hoaProfile;
    const hoaVerified = profile?.addressVerificationStatus === "verified";
    const location: HoaLocation = isNeighborhood
      ? {
          latitude: request.community.centerLatitude,
          longitude: request.community.centerLongitude,
          postalCode: null,
          locality: request.community.name,
          region: null,
        }
      : {
          latitude: hoaVerified ? (profile?.latitude ?? null) : null,
          longitude: hoaVerified ? (profile?.longitude ?? null) : null,
          postalCode: profile?.postalCode ?? null,
          locality: profile?.locality ?? null,
          region: profile?.region ?? null,
        };
    if (
      !providerCanSeeRequest({
        gate,
        areas,
        category: request.category,
        location,
        biddingClosesAt: request.biddingClosesAt,
        now,
      })
    ) {
      continue;
    }
    // Before award a provider gets the community-level location, the locked
    // home count, the permitted budget, and an approximate distance — enough
    // to price the job. No participant, unit, address, or competing amount.
    feed.push({
      requestId: request.id,
      context: isNeighborhood ? "neighborhood" : "hoa",
      communityName: request.community.name,
      locality: location.locality,
      region: location.region,
      title: request.title,
      category: request.category,
      kind: request.kind,
      description: request.description,
      recurrenceLabel: request.recurrenceLabel,
      totalOccurrences: request.totalOccurrences,
      homeCount: request.participations.length,
      approximateDistanceMi: approximateDistanceMi(areas, location),
      budgetMinCents: request.budgetMinCents,
      budgetMaxCents: request.budgetMaxCents,
      startDate: request.startDate?.toISOString() ?? null,
      biddingClosesAt: request.biddingClosesAt?.toISOString() ?? null,
      myBid: request.bids[0] ? serializeBid(request.bids[0]) : null,
    });
  }

  const occurrencesByAgreement: Record<string, OccurrenceSummary[]> = {};
  if (agreements.length > 0) {
    const occurrences = await db.serviceOccurrence.findMany({
      where: { agreementId: { in: agreements.map((agreement) => agreement.id) } },
      orderBy: { sequence: "asc" },
      include: { visits: { include: visitInclude } },
    });
    for (const occurrence of occurrences) {
      // These are the provider's *own* agreements, so they won the work and
      // need exact stops and access notes to perform it.
      (occurrencesByAgreement[occurrence.agreementId] ??= []).push(
        serializeOccurrence(occurrence, true, { includeAccessNotes: true }),
      );
    }
  }

  return {
    eligible: gate.eligible,
    ineligibleReason: gate.ineligibleReason,
    serviceAreas: areas.map(serializeArea),
    categories: gate.trades,
    feed,
    bids: myBids.map(serializeBid),
    agreements: agreements.map(serializeAgreement),
    occurrencesByAgreement,
  };
}

/* ── Bids ────────────────────────────────────────────────────────────────── */

type BidRecipient = { userId: string; email: string | null; linkPath: string };

/**
 * Who is told that a bid arrived.
 *
 * HOA → the scoped manager. Neighbourhood → the assigned neighbourhood
 * manager, and the joined participants, because transparent comparison is the
 * product: residents choose together even though only the manager awards.
 * Competing providers are never on this list.
 */
async function bidNotificationRecipients(input: {
  communityId: string;
  communityType: "hoa" | "neighborhood";
  requestId: string;
}): Promise<BidRecipient[]> {
  if (input.communityType === "hoa") {
    const manager = await db.communityStaffAssignment.findFirst({
      where: { communityId: input.communityId, role: "hoa_manager", status: "active" },
      select: { user: { select: { id: true, email: true } } },
    });
    return manager
      ? [{ userId: manager.user.id, email: manager.user.email, linkPath: "/app/hoa/dashboard" }]
      : [];
  }

  const [manager, participants] = await Promise.all([
    findNeighborhoodManager(input.communityId),
    db.hoaRequestParticipation.findMany({
      where: { requestId: input.requestId, response: "joined", userId: { not: null } },
      select: { user: { select: { id: true, email: true } } },
    }),
  ]);

  const byId = new Map<string, BidRecipient>();
  if (manager) {
    byId.set(manager.userId, {
      userId: manager.userId,
      email: manager.email,
      linkPath: "/app/homeowner/neighbourhood",
    });
  }
  for (const participant of participants) {
    if (!participant.user || byId.has(participant.user.id)) continue;
    byId.set(participant.user.id, {
      userId: participant.user.id,
      email: participant.user.email,
      linkPath: "/app/homeowner/neighbourhood",
    });
  }
  return [...byId.values()];
}

export async function submitBid(
  providerUserId: string,
  requestId: string,
  input: BidSubmitInput,
): Promise<BidSummary> {
  const gate = await requireProvider(providerUserId);
  const now = new Date();

  const request = await db.hoaServiceRequest.findUnique({
    where: { id: requestId },
    select: {
      id: true,
      communityId: true,
      title: true,
      category: true,
      status: true,
      biddingClosesAt: true,
      community: { select: { type: true, status: true, name: true } },
      participations: { where: { response: "joined" }, select: { id: true } },
    },
  });
  if (!request || request.community.status !== "active") {
    throw new HoaWorkflowError("That request does not exist.", 404);
  }
  if (request.status !== "open_for_bids") {
    throw new HoaWorkflowError("Bidding is not open on this request.");
  }
  if (request.biddingClosesAt && request.biddingClosesAt <= now) {
    throw new HoaWorkflowError("Bidding has closed on this request.");
  }
  if (!gate.trades.includes(request.category.toLowerCase())) {
    throw new HoaWorkflowError("Your account does not offer this service category.", 403);
  }
  const [areas, location] = await Promise.all([
    db.providerServiceArea.findMany({
      where: { providerUserId, status: "active" },
      select: {
        centerLatitude: true,
        centerLongitude: true,
        radiusMiles: true,
        postalCodes: true,
      },
    }),
    communityMatchLocation(request.communityId),
  ]);
  if (!areas.some((area) => areaCoversLocation(area, location))) {
    throw new HoaWorkflowError(
      request.community.type === "hoa"
        ? "This HOA is outside your service area."
        : "This neighbourhood is outside your service area.",
      403,
    );
  }
  if (input.validUntil && new Date(input.validUntil) <= now) {
    throw new HoaWorkflowError("The bid validity deadline is already in the past.", 400);
  }

  const existing = await db.serviceBid.findUnique({
    where: { requestId_providerUserId: { requestId, providerUserId } },
    select: { id: true, status: true, version: true },
  });
  if (existing && !["submitted", "withdrawn", "draft"].includes(existing.status)) {
    throw new HoaWorkflowError("This bid has already been decided.");
  }

  const bidId = existing?.id ?? randomUUID();
  const data = {
    status: "submitted" as const,
    amountCents: input.amountCents,
    pricingBasis: input.pricingBasis,
    perHomeCents: input.perHomeCents ?? null,
    proposedStartDate: input.proposedStartDate ? new Date(input.proposedStartDate) : null,
    estimatedDurationLabel: input.estimatedDurationLabel,
    scope: input.scope,
    exclusions: input.exclusions,
    cadenceLabel: input.cadenceLabel,
    validUntil: input.validUntil ? new Date(input.validUntil) : null,
    submittedAt: now,
    withdrawnAt: null,
  };

  // Whoever runs this request's lifecycle is who needs to hear about the bid.
  // The commercial detail — amount, scope, exclusions — is deliberately absent
  // from the notification body: it reaches the manager through the authorized
  // comparison view, never through an email that could be forwarded onward.
  const recipients = await bidNotificationRecipients({
    communityId: request.communityId,
    communityType: request.community.type,
    requestId: request.id,
  });

  await db.$transaction([
    existing
      ? db.serviceBid.update({
          where: { id: bidId },
          data: { ...data, version: { increment: 1 } },
        })
      : db.serviceBid.create({
          data: { id: bidId, requestId, providerUserId, ...data },
        }),
    ...(await buildPreferenceAwareNotificationOps(
      recipients.map((recipient) => ({
        userId: recipient.userId,
        email: recipient.email,
        kind: "bid" as const,
        title: `New bid on “${request.title}”`,
        body: `A provider ${existing ? "revised their" : "submitted a"} bid for ${request.community.name}.`,
        linkPath: recipient.linkPath,
        dedupeKey: `bid:${bidId}:v${(existing?.version ?? 0) + 1}:${recipient.userId}`,
      })),
    )),
  ]);

  const row = await db.serviceBid.findUniqueOrThrow({
    where: { id: bidId },
    include: bidInclude,
  });
  return serializeBid(row);
}

export async function withdrawBid(providerUserId: string, requestId: string): Promise<void> {
  await requireProvider(providerUserId);
  const bid = await db.serviceBid.findUnique({
    where: { requestId_providerUserId: { requestId, providerUserId } },
    select: { id: true, status: true, request: { select: { status: true } } },
  });
  if (!bid) throw new HoaWorkflowError("You have no bid on this request.", 404);
  if (bid.status !== "submitted") throw new HoaWorkflowError("This bid cannot be withdrawn.");
  if (bid.request.status !== "open_for_bids") {
    throw new HoaWorkflowError("Bidding has closed; the bid can no longer be withdrawn.");
  }
  await db.serviceBid.update({
    where: { id: bid.id },
    data: { status: "withdrawn", withdrawnAt: new Date() },
  });
}

/**
 * Bids for one request, scoped by community type.
 *
 * HOA → the scoped manager, or any active resident of that HOA (transparency
 * is the existing product rule there).
 *
 * Neighbourhood → the manager, the requester, and residents who actually
 * joined. A neighbour who declined or never answered is not part of the group
 * buying decision and does not see the quotes; an outsider is refused without
 * learning whether the request exists.
 */
export async function listRequestBids(
  viewerUserId: string,
  requestId: string,
): Promise<BidSummary[]> {
  const request = await db.hoaServiceRequest.findUnique({
    where: { id: requestId },
    select: {
      id: true,
      communityId: true,
      createdByUserId: true,
      community: { select: { type: true } },
    },
  });
  if (!request) throw new HoaWorkflowError("That request does not exist.", 404);

  if (request.community.type === "hoa") {
    const [assignment, membership] = await Promise.all([
      db.communityStaffAssignment.findFirst({
        where: {
          userId: viewerUserId,
          communityId: request.communityId,
          role: { in: ["hoa_manager", "hoa_team"] },
          status: "active",
        },
        select: { id: true },
      }),
      db.communityMembership.findFirst({
        where: { userId: viewerUserId, communityId: request.communityId, status: "active" },
        select: { id: true },
      }),
    ]);
    if (!assignment && !membership) {
      throw new HoaWorkflowError("You do not have access to this request.", 403);
    }
  } else {
    const [manager, participation] = await Promise.all([
      findNeighborhoodManager(request.communityId),
      db.hoaRequestParticipation.findFirst({
        where: { requestId, userId: viewerUserId, response: "joined" },
        select: { id: true },
      }),
    ]);
    const permitted =
      manager?.userId === viewerUserId ||
      participation !== null ||
      request.createdByUserId === viewerUserId;
    if (!permitted) {
      throw new HoaWorkflowError("You do not have access to this request.", 403);
    }
  }

  const rows = await db.serviceBid.findMany({
    where: { requestId, status: { in: ["submitted", "accepted", "rejected"] } },
    orderBy: [{ status: "asc" }, { amountCents: "asc" }],
    include: bidInclude,
  });
  return rows.map(serializeBid);
}

/* ── Award ───────────────────────────────────────────────────────────────── */

/** Award notifications for the neighbours who actually joined the request. */
async function participantAwardIntents(input: {
  requestId: string;
  excludeUserId: string;
  communityName: string;
  title: string;
  providerLabel: string;
  linkPath: string;
}): Promise<NotificationIntent[]> {
  const participants = await db.hoaRequestParticipation.findMany({
    where: {
      requestId: input.requestId,
      response: "joined",
      userId: { not: null },
      NOT: { userId: input.excludeUserId },
    },
    select: { user: { select: { id: true, email: true } } },
  });
  return participants
    .filter((participation) => participation.user !== null)
    .map((participation) => ({
      userId: participation.user!.id,
      email: participation.user!.email,
      kind: "award" as const,
      title: `${input.communityName}: provider selected`,
      body: `“${input.title}” was awarded to ${input.providerLabel}.`,
      linkPath: input.linkPath,
      dedupeKey: `award:${input.requestId}:${participation.user!.id}`,
    }));
}

function computeOccurrenceDates(input: {
  startDate: Date;
  intervalDays: number | null;
  count: number;
}): Date[] {
  const dates: Date[] = [];
  for (let sequence = 0; sequence < input.count; sequence += 1) {
    dates.push(
      new Date(
        input.startDate.getTime() + sequence * (input.intervalDays ?? 0) * 24 * 60 * 60 * 1_000,
      ),
    );
  }
  return dates;
}

/**
 * Raised when an award cannot proceed because participating homes have no
 * routeable address.
 *
 * A distinct error type because the answer is actionable rather than a plain
 * refusal: the manager is told how many homes and who they are, so the
 * addresses can be fixed and the award retried. Nothing is written first —
 * there is no partial award to unwind.
 */
export class MissingParticipantAddressError extends HoaWorkflowError {
  readonly missing: Array<{ userId: string; displayName: string }>;

  constructor(missing: Array<{ userId: string; displayName: string }>) {
    super(
      `${missing.length} participating ${missing.length === 1 ? "home has" : "homes have"} no verified address yet, so the provider could not be routed to ${missing.length === 1 ? "it" : "them"}. Ask ${missing.length === 1 ? "that neighbour" : "those neighbours"} to complete their profile address, then award again.`,
      409,
    );
    this.name = "MissingParticipantAddressError";
    this.missing = missing;
  }
}

/**
 * Atomically accepts exactly one bid.
 *
 * Rejects the rest, snapshots the accepted terms into an agreement, and
 * materializes every occurrence and one valid visit per locked participating
 * home — an HOA unit stop, or a neighbourhood homeowner stop with its address
 * and coordinates frozen at this moment.
 *
 * A repeated click or a concurrent attempt resolves to the same single award
 * through the agreement/accepted-bid unique indexes: the second writer loses
 * the race, catches `P2002`, and returns the agreement the first one created.
 *
 * The occurrence generator already understands cadence and count, so a future
 * recurring neighbourhood service needs no schema change — only a request that
 * carries `recurrenceIntervalDays` and `totalOccurrences > 1`.
 */
export async function awardBid(
  userId: string,
  requestId: string,
  input: AwardInput,
): Promise<string> {
  const request = await db.hoaServiceRequest.findUnique({
    where: { id: requestId },
    include: {
      community: { select: { id: true, name: true, type: true } },
      participations: {
        where: { response: "joined" },
        select: { unitId: true, userId: true },
      },
      agreement: { select: { id: true, bidId: true } },
    },
  });
  if (!request) throw new HoaWorkflowError("That service request does not exist.", 404);
  const authority = await requireCommunityManager(userId, request.communityId);
  const isNeighborhood = request.community.type === "neighborhood";

  // Idempotency: the same award request returns the same agreement.
  if (request.agreement) {
    if (request.agreement.bidId === input.bidId) return request.agreement.id;
    throw new HoaWorkflowError("A different bid has already been accepted for this request.");
  }
  if (request.status !== "bidding_closed") {
    throw new HoaWorkflowError(
      request.status === "open_for_bids"
        ? "Close bidding before accepting a bid."
        : "This request is not ready for an award.",
    );
  }

  const bid = await db.serviceBid.findUnique({
    where: { id: input.bidId },
    include: bidInclude,
  });
  if (!bid || bid.requestId !== request.id) {
    throw new HoaWorkflowError("That bid does not belong to this request.", 404);
  }
  if (bid.status !== "submitted") {
    throw new HoaWorkflowError("Only a submitted bid can be accepted.");
  }
  const now = new Date();
  if (bid.validUntil && bid.validUntil <= now) {
    throw new HoaWorkflowError("That bid has expired. Ask the provider to re-submit.");
  }
  const provider = await db.user.findUnique({
    where: { id: bid.providerUserId },
    select: { id: true, email: true, providerProfile: { select: { accountStatus: true } } },
  });
  if (provider?.providerProfile?.accountStatus !== "active") {
    throw new HoaWorkflowError("That provider's account is no longer active.");
  }

  // Resolve the service targets *before* anything is written. A neighbourhood
  // participant with no verified address aborts the whole award here, with a
  // list the manager can act on, rather than producing an agreement whose
  // locked home count exceeds the homes that can actually be served.
  let targets: ServiceTarget[];
  if (isNeighborhood) {
    const resolution = await homeownerTargets(request.participations);
    if (!resolution.ok) throw new MissingParticipantAddressError(resolution.missing);
    targets = resolution.targets;
  } else {
    targets = unitTargets(request.participations);
  }
  if (targets.length === 0) {
    throw new HoaWorkflowError("This request has no participating homes.");
  }

  const startDate = bid.proposedStartDate ?? request.startDate ?? new Date(now.getTime() + 7 * 24 * 60 * 60 * 1_000);
  const occurrenceDates = computeOccurrenceDates({
    startDate,
    intervalDays: request.recurrenceIntervalDays,
    count: request.totalOccurrences,
  });
  const endDate = occurrenceDates[occurrenceDates.length - 1] ?? startDate;

  const agreementId = randomUUID();
  const occurrenceRows = occurrenceDates.map((serviceDate, index) => ({
    id: randomUUID(),
    agreementId,
    sequence: index + 1,
    serviceDate,
    updatedAt: now,
  }));
  // One valid visit per locked home per occurrence. `visitDataForTarget`
  // produces either `{ unitId }` or the homeowner id plus the frozen address —
  // exactly one target, which is what the database CHECK requires.
  const visitRows = occurrenceRows.flatMap((occurrence) =>
    targets.map((target) => ({
      id: randomUUID(),
      occurrenceId: occurrence.id,
      updatedAt: now,
      ...visitDataForTarget(target),
    })),
  );

  const losingBids = await db.serviceBid.findMany({
    where: { requestId: request.id, status: "submitted", id: { not: bid.id } },
    select: { id: true, provider: { select: { id: true, email: true } } },
  });
  const awardLinkPath = isNeighborhood
    ? "/app/homeowner/neighbourhood"
    : "/app/homeowner/community";
  // HOA: every active resident hears, because the service is community-wide.
  // Neighbourhood: only the people who joined — a neighbour who declined has
  // no interest in the outcome and no right to the commercial detail.
  const residentIntents = isNeighborhood
    ? await participantAwardIntents({
        requestId: request.id,
        excludeUserId: userId,
        communityName: request.community.name,
        title: request.title,
        providerLabel: bid.provider.providerProfile?.companyName ?? bid.provider.fullName,
        linkPath: awardLinkPath,
      })
    : await activeResidentIntents(request.communityId, userId, (user) => ({
        userId: user.id,
        email: user.email,
        kind: "award",
        title: `${request.community.name}: provider selected`,
        body: `“${request.title}” was awarded to ${bid.provider.providerProfile?.companyName ?? bid.provider.fullName}.`,
        linkPath: awardLinkPath,
        dedupeKey: `award:${request.id}:${user.id}`,
      }));

  try {
    await db.$transaction([
      db.serviceBid.update({
        where: { id: bid.id },
        data: { status: "accepted", decidedAt: now },
      }),
      db.serviceBid.updateMany({
        where: { requestId: request.id, status: "submitted", id: { not: bid.id } },
        data: { status: "rejected", decidedAt: now },
      }),
      db.hoaServiceRequest.update({
        where: { id: request.id },
        data: { status: "awarded", awardedAt: now },
      }),
      db.serviceAgreement.create({
        data: {
          id: agreementId,
          requestId: request.id,
          bidId: bid.id,
          communityId: request.communityId,
          providerUserId: bid.providerUserId,
          awardedByUserId: userId,
          amountCents: bid.amountCents,
          currency: bid.currency,
          pricingBasis: bid.pricingBasis,
          perHomeCents: bid.perHomeCents,
          scope: bid.scope,
          exclusions: bid.exclusions,
          cadenceLabel: bid.cadenceLabel,
          lockedHomeCount: targets.length,
          startDate,
          endDate,
        },
      }),
      db.serviceOccurrence.createMany({ data: occurrenceRows, skipDuplicates: true }),
      db.serviceVisit.createMany({ data: visitRows, skipDuplicates: true }),
      db.adminAuditLog.create({
        data: buildAuditEntry({
          actorUserId: userId,
          action: "hoa_bid_awarded",
          targetType: "service_agreement",
          targetId: agreementId,
          communityId: request.communityId,
          providerUserId: bid.providerUserId,
          metadata: {
            amountCents: bid.amountCents,
            currency: bid.currency,
            lockedHomeCount: targets.length,
            occurrenceCount: occurrenceRows.length,
            context: request.community.type,
            via: authority.via,
          },
        }),
      }),
      ...(await buildPreferenceAwareNotificationOps([
        {
          userId: bid.providerUserId,
          email: provider.email,
          kind: "award",
          title: "Your bid was accepted",
          body: `${request.community.name} accepted your bid for “${request.title}”. Plan your visits in the provider portal.`,
          linkPath: "/app/provider/schedule",
          dedupeKey: `award:${request.id}:${bid.providerUserId}`,
        },
        ...losingBids.map((losing) => ({
          userId: losing.provider.id,
          email: losing.provider.email,
          kind: "bid" as const,
          title: "Bid not selected",
          body: `${request.community.name} chose another provider for “${request.title}”.`,
          linkPath: "/app/provider/hoa",
          dedupeKey: `award-rejected:${request.id}:${losing.provider.id}`,
        })),
        ...residentIntents,
      ])),
    ]);
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") {
      const existing = await db.serviceAgreement.findUnique({
        where: { requestId: request.id },
        select: { id: true, bidId: true },
      });
      if (existing?.bidId === input.bidId) return existing.id;
      throw new HoaWorkflowError("A different bid has already been accepted for this request.");
    }
    throw error;
  }

  return agreementId;
}

/* ── Provider day plan ───────────────────────────────────────────────────── */

/** Shape shared by every place that needs a stop's label or its resident. */
type StopRow = {
  unitId: string | null;
  serviceLabel: string | null;
  serviceAddressLine1: string | null;
  unit: { label: string; memberships: Array<{ user: { id: string; email: string } }> } | null;
  homeowner: { id: string; email: string } | null;
};

/** What this stop is called: the unit label, or the snapshotted street line. */
function stopLabelOf(visit: StopRow): string {
  if (visit.unitId) return visit.unit?.label ?? "this home";
  return visit.serviceLabel ?? visit.serviceAddressLine1 ?? "this home";
}

/**
 * The one account that lives at this stop, if any.
 *
 * HOA → the unit's active resident, which may be absent for a vacant home.
 * Neighbourhood → the participating homeowner, who is always present because
 * they are the target.
 */
function residentOfVisit(visit: StopRow): { id: string; email: string } | null {
  if (visit.unitId) return visit.unit?.memberships[0]?.user ?? null;
  return visit.homeowner;
}

async function requireProviderOccurrence(providerUserId: string, occurrenceId: string) {
  const occurrence = await db.serviceOccurrence.findUnique({
    where: { id: occurrenceId },
    select: {
      id: true,
      status: true,
      serviceDate: true,
      sequence: true,
      schedulePublishedAt: true,
      agreement: {
        select: {
          id: true,
          providerUserId: true,
          communityId: true,
          status: true,
          requestId: true,
          community: { select: { name: true, type: true } },
          request: { select: { title: true } },
        },
      },
    },
  });
  // Only the awarded provider. A different provider passing a real occurrence
  // id gets the same "does not exist" as a stranger, and learns nothing about
  // whose work it is.
  if (!occurrence || occurrence.agreement.providerUserId !== providerUserId) {
    throw new HoaWorkflowError("That service day does not exist.", 404);
  }
  if (occurrence.agreement.status !== "active") {
    throw new HoaWorkflowError("This agreement is no longer active.");
  }
  return occurrence;
}

/**
 * Saves the provider's stop order and windows for one service day. Manual
 * ordering is authoritative; publishing notifies each home of its own window
 * only, and the manager of the whole plan.
 */
export async function saveDayPlan(
  providerUserId: string,
  occurrenceId: string,
  input: DayPlanInput,
): Promise<void> {
  await requireProvider(providerUserId);
  const occurrence = await requireProviderOccurrence(providerUserId, occurrenceId);
  if (occurrence.status === "completed" || occurrence.status === "cancelled") {
    throw new HoaWorkflowError("This service day is closed.");
  }

  const visits = await db.serviceVisit.findMany({
    where: { occurrenceId },
    select: {
      id: true,
      status: true,
      unitId: true,
      homeownerUserId: true,
      serviceLabel: true,
      serviceAddressLine1: true,
      windowStart: true,
      windowEnd: true,
      stopRank: true,
      unit: {
        select: {
          label: true,
          memberships: {
            where: { status: "active" },
            select: { user: { select: { id: true, email: true } } },
            take: 1,
          },
        },
      },
      homeowner: { select: { id: true, email: true } },
    },
  });
  const visitById = new Map(visits.map((visit) => [visit.id, visit]));
  for (const stop of input.stops) {
    const visit = visitById.get(stop.visitId);
    if (!visit) {
      throw new HoaWorkflowError("A stop in this plan does not belong to this service day.", 400);
    }
    if (["completed", "skipped", "cancelled"].includes(visit.status)) {
      throw new HoaWorkflowError(`Stop “${stopLabelOf(visit)}” is already resolved.`, 400);
    }
  }

  const now = new Date();
  const ops: Prisma.PrismaPromise<unknown>[] = input.stops.map((stop) =>
    db.serviceVisit.update({
      where: { id: stop.visitId },
      data: {
        stopRank: stop.stopRank,
        windowStart: stop.windowStart ?? null,
        windowEnd: stop.windowEnd ?? null,
        estimatedMinutes: stop.estimatedMinutes ?? null,
        ...(input.publish
          ? {
              status: "scheduled",
              scheduledDate: occurrence.serviceDate,
              statusChangedAt: now,
            }
          : {}),
      },
    }),
  );

  if (input.publish) {
    const isNeighborhood = occurrence.agreement.community.type === "neighborhood";
    const manager = isNeighborhood
      ? await findNeighborhoodManager(occurrence.agreement.communityId).then((found) =>
          found ? { user: { id: found.userId, email: found.email } } : null,
        )
      : await db.communityStaffAssignment.findFirst({
          where: {
            communityId: occurrence.agreement.communityId,
            role: "hoa_manager",
            status: "active",
          },
          select: { user: { select: { id: true, email: true } } },
        });
    const residentLinkPath = isNeighborhood
      ? "/app/homeowner/neighbourhood"
      : "/app/homeowner/community";
    const managerLinkPath = isNeighborhood
      ? "/app/homeowner/neighbourhood"
      : "/app/hoa/dashboard";
    const dayLabel = occurrence.serviceDate.toISOString().slice(0, 10);
    const scheduleWasAlreadyPublished = occurrence.schedulePublishedAt !== null;

    // Each home hears about its own stop and nothing else — never the day's
    // route, never another home's window.
    const residentIntents: NotificationIntent[] = [];
    for (const stop of input.stops) {
      const visit = visitById.get(stop.visitId);
      const resident = visit ? residentOfVisit(visit) : null;
      if (!visit || !resident) continue;
      const window =
        stop.windowStart && stop.windowEnd
          ? `between ${stop.windowStart} and ${stop.windowEnd}`
          : "during the day";
      residentIntents.push({
        userId: resident.id,
        email: resident.email,
        kind: "schedule",
        title: `${occurrence.agreement.community.name}: service schedule ${scheduleWasAlreadyPublished ? "updated" : "published"}`,
        body: `“${occurrence.agreement.request.title}” ${scheduleWasAlreadyPublished ? "is now scheduled" : "visits"} for ${stopLabelOf(visit)} on ${dayLabel} ${window}.`,
        linkPath: residentLinkPath,
        // A resend of the same plan is one event; a changed window is a new one.
        dedupeKey: `schedule:${visit.id}:${contentHash([
          dayLabel,
          stop.windowStart ?? "",
          stop.windowEnd ?? "",
          stop.stopRank,
        ])}`,
      });
    }

    ops.push(
      db.serviceOccurrence.update({
        where: { id: occurrenceId },
        data: { schedulePublishedAt: now },
      }),
      db.hoaServiceRequest.updateMany({
        where: { id: occurrence.agreement.requestId, status: "awarded" },
        data: { status: "scheduled" },
      }),
      db.adminAuditLog.create({
        data: buildAuditEntry({
          actorUserId: providerUserId,
          action: "hoa_schedule_published",
          targetType: "service_agreement",
          targetId: occurrence.agreement.id,
          communityId: occurrence.agreement.communityId,
          providerUserId,
          metadata: {
            sequence: occurrence.sequence,
            stopCount: input.stops.length,
            context: occurrence.agreement.community.type,
          },
        }),
      }),
      ...(await buildPreferenceAwareNotificationOps([
        ...residentIntents,
        ...(manager
          ? [
              {
                userId: manager.user.id,
                email: manager.user.email,
                kind: "schedule" as const,
                title: `Schedule ${scheduleWasAlreadyPublished ? "updated" : "published"} for “${occurrence.agreement.request.title}”`,
                body: `The provider ${scheduleWasAlreadyPublished ? "updated" : "planned"} ${input.stops.length} stops for ${dayLabel}.`,
                linkPath: managerLinkPath,
                dedupeKey: `schedule-manager:${occurrenceId}:${contentHash(
                  input.stops.map(
                    (stop) =>
                      `${stop.visitId}:${stop.stopRank}:${stop.windowStart ?? ""}:${stop.windowEnd ?? ""}`,
                  ),
                )}`,
              },
            ]
          : []),
      ])),
    );
  }

  await db.$transaction(ops);
}

/* ── Visit status ────────────────────────────────────────────────────────── */

const VISIT_TRANSITIONS: Record<string, string[]> = {
  scheduled: ["en_route", "in_progress", "completed", "skipped", "blocked"],
  en_route: ["in_progress", "completed", "skipped", "blocked"],
  in_progress: ["completed", "skipped", "blocked"],
};

export async function updateVisitStatus(
  providerUserId: string,
  visitId: string,
  input: VisitStatusInput,
): Promise<void> {
  await requireProvider(providerUserId);
  const visit = await db.serviceVisit.findUnique({
    where: { id: visitId },
    select: {
      id: true,
      status: true,
      occurrenceId: true,
      unitId: true,
      serviceLabel: true,
      serviceAddressLine1: true,
      unit: {
        select: {
          label: true,
          memberships: {
            where: { status: "active" },
            select: { user: { select: { id: true, email: true } } },
            take: 1,
          },
        },
      },
      homeowner: { select: { id: true, email: true } },
      occurrence: {
        select: {
          id: true,
          status: true,
          agreement: {
            select: {
              id: true,
              providerUserId: true,
              communityId: true,
              status: true,
              requestId: true,
              community: { select: { name: true, type: true } },
              request: { select: { title: true } },
            },
          },
        },
      },
    },
  });
  if (!visit || visit.occurrence.agreement.providerUserId !== providerUserId) {
    throw new HoaWorkflowError("That visit does not exist.", 404);
  }
  if (visit.occurrence.agreement.status !== "active") {
    throw new HoaWorkflowError("This agreement is no longer active.");
  }
  if (visit.status === input.status) return;
  const allowed = VISIT_TRANSITIONS[visit.status] ?? [];
  if (!allowed.includes(input.status)) {
    throw new HoaWorkflowError(
      visit.status === "unscheduled"
        ? "Publish the day plan before working this visit."
        : `A ${visit.status.replace("_", " ")} visit cannot move to ${input.status.replace("_", " ")}.`,
    );
  }
  if ((input.status === "skipped" || input.status === "blocked") && !input.completionNote) {
    throw new HoaWorkflowError("Explain why the visit was skipped or blocked.", 400);
  }

  const now = new Date();
  const resident = residentOfVisit(visit);
  const stopLabel = stopLabelOf(visit);
  const residentLinkPath =
    visit.occurrence.agreement.community.type === "neighborhood"
      ? "/app/homeowner/neighbourhood"
      : "/app/homeowner/community";
  const terminal = ["completed", "skipped", "blocked"].includes(input.status);

  await db.$transaction([
    db.serviceVisit.update({
      where: { id: visit.id },
      data: {
        status: input.status,
        statusChangedAt: now,
        completionNote: input.completionNote ?? null,
        ...(input.status === "completed" ? { completedAt: now } : {}),
      },
    }),
    db.serviceOccurrence.updateMany({
      where: { id: visit.occurrenceId, status: "planned" },
      data: { status: "in_progress" },
    }),
    db.hoaServiceRequest.updateMany({
      where: { id: visit.occurrence.agreement.requestId, status: { in: ["awarded", "scheduled"] } },
      data: { status: "in_progress" },
    }),
    ...(await buildPreferenceAwareNotificationOps(
      resident && (terminal || input.status === "en_route")
        ? [
            {
              userId: resident.id,
              email: resident.email,
              kind: (input.status === "completed" ? "review" : "visit") as "review" | "visit",
              title:
                input.status === "completed"
                  ? `Service completed at ${stopLabel} — share your review`
                  : input.status === "en_route"
                    ? `Your provider is on the way`
                    : `Service ${input.status} at ${stopLabel}`,
              body:
                input.status === "completed"
                  ? `“${visit.occurrence.agreement.request.title}” is complete at ${stopLabel}. Tell your neighbours how the provider did.`
                  : `“${visit.occurrence.agreement.request.title}” — ${stopLabel} is now ${input.status.replace("_", " ")}.`,
              linkPath: residentLinkPath,
              dedupeKey: `visit-status:${visit.id}:${input.status}`,
            },
          ]
        : [],
    )),
  ]);
}

/** Manager closes a service day once every visit is resolved. */
export async function closeOccurrence(userId: string, occurrenceId: string): Promise<void> {
  const occurrence = await db.serviceOccurrence.findUnique({
    where: { id: occurrenceId },
    select: {
      id: true,
      status: true,
      agreement: { select: { id: true, communityId: true, requestId: true } },
      visits: { select: { status: true } },
    },
  });
  if (!occurrence) throw new HoaWorkflowError("That service day does not exist.", 404);
  await requireCommunityManager(userId, occurrence.agreement.communityId);
  // Idempotent: closing an already-closed day is a no-op, not an error, so a
  // double-click or a retried request settles on the same state.
  if (occurrence.status === "completed") return;
  if (occurrence.status === "cancelled") {
    throw new HoaWorkflowError("A cancelled service day stays cancelled.");
  }

  const unresolved = occurrence.visits.filter(
    (visit) => !["completed", "skipped", "blocked", "cancelled"].includes(visit.status),
  ).length;
  if (unresolved > 0) {
    throw new HoaWorkflowError(
      `${unresolved} ${unresolved === 1 ? "visit is" : "visits are"} not resolved yet.`,
    );
  }

  await db.serviceOccurrence.update({
    where: { id: occurrence.id },
    data: { status: "completed", closedAt: new Date() },
  });
}

/* ── Reviews ─────────────────────────────────────────────────────────────── */

/**
 * One homeowner review of one completed visit to their own home.
 *
 * The ownership test differs by target kind and is the whole authorization:
 * an HOA resident must be the active member of the unit that was visited, and
 * a neighbourhood resident must be the homeowner the stop belongs to. Either
 * way a resident cannot review a neighbour's visit, and the unique index on
 * `(reviewerUserId, visitId)` keeps it to one review each.
 */
export async function createVisitReview(
  userId: string,
  visitId: string,
  input: ReviewCreateInput,
): Promise<void> {
  const visit = await db.serviceVisit.findUnique({
    where: { id: visitId },
    select: {
      id: true,
      status: true,
      unitId: true,
      homeownerUserId: true,
      occurrence: {
        select: {
          agreement: {
            select: {
              providerUserId: true,
              communityId: true,
              community: { select: { type: true } },
            },
          },
        },
      },
    },
  });
  if (!visit) throw new HoaWorkflowError("That visit does not exist.", 404);

  if (visit.occurrence.agreement.community.type === "hoa") {
    const membership = await requireActiveResident(
      userId,
      visit.occurrence.agreement.communityId,
    );
    if (membership.unitId !== visit.unitId) {
      throw new HoaWorkflowError("You can only review visits to your own home.", 403);
    }
  } else {
    await requireActiveNeighborhoodMember(userId, visit.occurrence.agreement.communityId);
    if (visit.homeownerUserId !== userId) {
      throw new HoaWorkflowError("You can only review visits to your own home.", 403);
    }
  }

  if (visit.status !== "completed") {
    throw new HoaWorkflowError("Only a completed visit can be reviewed.");
  }

  try {
    await db.review.create({
      data: {
        id: randomUUID(),
        reviewerUserId: userId,
        providerUserId: visit.occurrence.agreement.providerUserId,
        visitId: visit.id,
        rating: input.rating,
        comment: input.comment,
      },
    });
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") {
      throw new HoaWorkflowError("You already reviewed this visit.");
    }
    throw error;
  }
}

export async function createAgreementReview(
  userId: string,
  agreementId: string,
  input: ReviewCreateInput,
): Promise<void> {
  const agreement = await db.serviceAgreement.findUnique({
    where: { id: agreementId },
    select: { id: true, status: true, communityId: true, providerUserId: true },
  });
  if (!agreement) throw new HoaWorkflowError("That agreement does not exist.", 404);
  // The group-level review stays a manager's review, of either kind: the HOA
  // manager for an HOA agreement, the neighbourhood manager for a
  // neighbourhood one.
  await requireCommunityManager(userId, agreement.communityId);
  if (agreement.status !== "completed") {
    throw new HoaWorkflowError("Complete the agreement before reviewing it.");
  }

  try {
    await db.review.create({
      data: {
        id: randomUUID(),
        reviewerUserId: userId,
        providerUserId: agreement.providerUserId,
        agreementId: agreement.id,
        rating: input.rating,
        comment: input.comment,
      },
    });
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") {
      throw new HoaWorkflowError("You already reviewed this agreement.");
    }
    throw error;
  }
}

/* ── Dashboards ──────────────────────────────────────────────────────────── */

export async function getHoaManagerDashboard(userId: string): Promise<HoaManagerDashboard> {
  const assignments = await db.communityStaffAssignment.findMany({
    where: {
      userId,
      role: { in: ["hoa_manager", "hoa_team"] },
      status: "active",
      community: { type: "hoa", status: "active" },
    },
    select: {
      community: {
        select: {
          id: true,
          name: true,
          _count: { select: { memberships: { where: { status: "active" } } } },
          units: {
            orderBy: { label: "asc" },
            take: 200,
            select: {
              id: true,
              label: true,
              addressLine1: true,
              locality: true,
              region: true,
              postalCode: true,
              latitude: true,
              longitude: true,
              formattedAddress: true,
              addressVerificationStatus: true,
              occupancyStatus: true,
              accessNotes: true,
              memberships: {
                where: { status: "active" },
                select: { user: { select: { fullName: true, email: true } } },
                take: 1,
              },
              invitations: {
                where: { status: "pending" },
                select: { email: true },
                take: 1,
              },
            },
          },
          invitations: {
            orderBy: { invitedAt: "desc" },
            take: 30,
            select: {
              id: true,
              email: true,
              inviteeName: true,
              role: true,
              status: true,
              unitId: true,
              unit: { select: { label: true } },
              invitedAt: true,
              expiresAt: true,
              acceptedAt: true,
            },
          },
          hoaRequests: {
            orderBy: { createdAt: "desc" },
            take: 30,
            include: requestInclude,
          },
          serviceAgreements: {
            orderBy: { createdAt: "desc" },
            take: 15,
            include: agreementInclude,
          },
          hoaSurveys: {
            orderBy: { createdAt: "desc" },
            take: 12,
            include: { votes: { select: { userId: true, optionIndex: true } } },
          },
        },
      },
    },
  });

  const communities = [];
  for (const { community } of assignments) {
    const requestIds = community.hoaRequests.map((request) => request.id);
    const bids = requestIds.length
      ? await db.serviceBid.findMany({
          where: {
            requestId: { in: requestIds },
            status: { in: ["submitted", "accepted", "rejected"] },
          },
          orderBy: { amountCents: "asc" },
          include: bidInclude,
        })
      : [];
    const bidsByRequest: Record<string, BidSummary[]> = {};
    for (const bid of bids) {
      (bidsByRequest[bid.requestId] ??= []).push(serializeBid(bid));
    }

    const agreementIds = community.serviceAgreements.map((agreement) => agreement.id);
    const occurrences = agreementIds.length
      ? await db.serviceOccurrence.findMany({
          where: { agreementId: { in: agreementIds } },
          orderBy: { sequence: "asc" },
          include: { visits: { include: visitInclude } },
        })
      : [];
    const occurrencesByAgreement: Record<string, OccurrenceSummary[]> = {};
    for (const occurrence of occurrences) {
      // The scoped manager sees the full plan and its stop locations, so they
      // can answer residents — but not the private access notes, which stay
      // between the resident and the awarded provider.
      (occurrencesByAgreement[occurrence.agreementId] ??= []).push(
        serializeOccurrence(occurrence, true),
      );
    }

    const profile = await getHoaProfile(community.id);
    const locationReady = profile?.locationReady ?? false;

    communities.push({
      id: community.id,
      name: community.name,
      profile,
      activeMemberCount: community._count.memberships,
      units: community.units.map((unit) => ({
        id: unit.id,
        label: unit.label,
        addressLine1: unit.addressLine1,
        locality: unit.locality,
        region: unit.region,
        postalCode: unit.postalCode,
        inheritsHoaAddress: !unit.addressLine1?.trim(),
        addressVerificationStatus: unit.addressVerificationStatus,
        formattedAddress: unit.formattedAddress,
        locationReady: !unit.addressLine1?.trim()
          ? locationReady
          : unit.addressVerificationStatus === "verified" &&
            unit.latitude !== null &&
            unit.longitude !== null,
        occupancyStatus: unit.occupancyStatus,
        accessNotes: unit.accessNotes,
        residentName: unit.memberships[0]?.user.fullName ?? null,
        residentEmail: unit.memberships[0]?.user.email ?? null,
        pendingInviteEmail: unit.invitations[0]?.email ?? null,
      })),
      invitations: community.invitations.map(serializeInvitation),
      requests: community.hoaRequests.map((request) => serializeRequest(request)),
      bidsByRequest,
      agreements: community.serviceAgreements.map(serializeAgreement),
      occurrencesByAgreement,
      surveys: community.hoaSurveys.map((survey) => serializeSurvey(survey)),
    });
  }

  return { communities };
}

export async function getResidentHoaHub(userId: string): Promise<ResidentHoaHub> {
  const memberships = await db.communityMembership.findMany({
    where: {
      userId,
      status: "active",
      community: { type: "hoa", status: "active" },
    },
    select: {
      unitId: true,
      unit: { select: { id: true, label: true } },
      community: {
        select: {
          id: true,
          name: true,
          hoaRequests: {
            where: { status: { not: "draft" } },
            orderBy: { createdAt: "desc" },
            take: 30,
            include: requestInclude,
          },
          serviceAgreements: {
            orderBy: { createdAt: "desc" },
            take: 10,
            include: agreementInclude,
          },
          hoaSurveys: {
            where: { status: { in: ["open", "closed"] } },
            orderBy: { createdAt: "desc" },
            take: 12,
            include: { votes: { select: { userId: true, optionIndex: true } } },
          },
        },
      },
    },
  });

  const communities = [];
  for (const membership of memberships) {
    const community = membership.community;
    const requestIds = community.hoaRequests.map((request) => request.id);
    // HOA transparency: residents see every valid bid and the winner.
    const bids = requestIds.length
      ? await db.serviceBid.findMany({
          where: {
            requestId: { in: requestIds },
            status: { in: ["submitted", "accepted", "rejected"] },
          },
          orderBy: { amountCents: "asc" },
          include: bidInclude,
        })
      : [];
    const bidsByRequest: Record<string, BidSummary[]> = {};
    for (const bid of bids) {
      (bidsByRequest[bid.requestId] ??= []).push(serializeBid(bid));
    }

    // Only this resident's own visits — never another home's schedule.
    const myVisits = membership.unitId
      ? await db.serviceVisit.findMany({
          where: {
            unitId: membership.unitId,
            occurrence: { agreement: { communityId: community.id } },
          },
          orderBy: { createdAt: "desc" },
          take: 20,
          include: visitInclude,
        })
      : [];

    communities.push({
      id: community.id,
      name: community.name,
      unitId: membership.unitId,
      unitLabel: membership.unit?.label ?? null,
      requests: community.hoaRequests.map((request) => serializeRequest(request, userId)),
      bidsByRequest,
      agreements: community.serviceAgreements.map(serializeAgreement),
      myVisits: myVisits.map((visit) => serializeVisit(visit, true)),
      surveys: community.hoaSurveys.map((survey) => serializeSurvey(survey, userId)),
    });
  }

  return { communities };
}
