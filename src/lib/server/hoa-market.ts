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
import { distanceMiles } from "@/lib/geo";
import { buildAuditEntry } from "@/lib/server/audit";
import { db } from "@/lib/server/db";
import {
  HoaWorkflowError,
  requireActiveResident,
  requireManagedHoa,
  serializeInvitation,
  serializeSurvey,
} from "@/lib/server/hoa";
import { getHoaProfile } from "@/lib/server/hoa-units";
import {
  buildNotificationOps,
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

type VisitRow = {
  id: string;
  occurrenceId: string;
  unitId: string;
  stopRank: number | null;
  scheduledDate: Date | null;
  windowStart: string | null;
  windowEnd: string | null;
  estimatedMinutes: number | null;
  status: VisitSummary["status"];
  completionNote: string | null;
  completedAt: Date | null;
  unit: { label: string; latitude: number | null; longitude: number | null; addressLine1: string | null };
};

const visitInclude = {
  unit: { select: { label: true, latitude: true, longitude: true, addressLine1: true } },
} satisfies Prisma.ServiceVisitInclude;

function serializeVisit(row: VisitRow, includeLocation: boolean): VisitSummary {
  return {
    id: row.id,
    occurrenceId: row.occurrenceId,
    unitId: row.unitId,
    unitLabel: row.unit.label,
    latitude: includeLocation ? row.unit.latitude : null,
    longitude: includeLocation ? row.unit.longitude : null,
    addressLine1: includeLocation ? row.unit.addressLine1 : null,
    stopRank: row.stopRank,
    scheduledDate: row.scheduledDate?.toISOString() ?? null,
    windowStart: row.windowStart,
    windowEnd: row.windowEnd,
    estimatedMinutes: row.estimatedMinutes,
    status: row.status,
    completionNote: row.completionNote,
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}

type OccurrenceRow = {
  id: string;
  agreementId: string;
  sequence: number;
  serviceDate: Date;
  status: OccurrenceSummary["status"];
  schedulePublishedAt: Date | null;
  visits: VisitRow[];
};

function serializeOccurrence(row: OccurrenceRow, includeLocation: boolean): OccurrenceSummary {
  return {
    id: row.id,
    agreementId: row.agreementId,
    sequence: row.sequence,
    serviceDate: row.serviceDate.toISOString(),
    status: row.status,
    schedulePublishedAt: row.schedulePublishedAt?.toISOString() ?? null,
    visits: [...row.visits]
      .sort((a, b) => (a.stopRank ?? 999) - (b.stopRank ?? 999))
      .map((visit) => serializeVisit(visit, includeLocation)),
  };
}

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
    ...buildNotificationOps(residentIntents),
  ]);
  return requestId;
}

/**
 * Manager lifecycle transitions. The transition table is enforced here — the
 * client sends an action name, never a raw status value.
 */
export async function transitionHoaRequest(
  userId: string,
  requestId: string,
  input: HoaRequestTransitionInput,
): Promise<void> {
  const request = await db.hoaServiceRequest.findUnique({
    where: { id: requestId },
    include: {
      participations: { select: { unitId: true, userId: true, response: true } },
      agreement: { select: { id: true, status: true } },
    },
  });
  if (!request) throw new HoaWorkflowError("That HOA request does not exist.", 404);
  const community = await requireManagedHoa(userId, request.communityId);
  const now = new Date();

  const audit = (nextStatus: string, extra?: Record<string, unknown>) =>
    db.adminAuditLog.create({
      data: buildAuditEntry({
        actorUserId: userId,
        action: "hoa_request_status_changed",
        targetType: "hoa_request",
        targetId: request.id,
        communityId: request.communityId,
        metadata: { previousStatus: request.status, nextStatus, ...extra },
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
        linkPath: "/app/homeowner/community",
        dedupeKey: `request-open:${request.id}:${user.id}`,
      }));
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
        ...buildNotificationOps(intents),
      ]);
      return;
    }

    case "open_bidding": {
      if (request.kind !== "optional_group" || request.status !== "collecting_interest") {
        throw new HoaWorkflowError("Only an optional request collecting interest can open bidding.");
      }
      const biddingClosesAt = input.biddingClosesAt
        ? new Date(input.biddingClosesAt)
        : request.biddingClosesAt;
      if (!biddingClosesAt || biddingClosesAt <= now) {
        throw new HoaWorkflowError("Set a future bidding deadline to open bidding.", 400);
      }
      const joinedUnits = request.participations.filter(
        (item) => item.response === "joined" && item.unitId,
      );
      if (joinedUnits.length === 0) {
        throw new HoaWorkflowError("No homes joined this optional service.");
      }
      if (request.minHomes != null && joinedUnits.length < request.minHomes) {
        throw new HoaWorkflowError(
          `Only ${joinedUnits.length} of the required ${request.minHomes} homes joined.`,
        );
      }
      // Locking the participant snapshot means providers quote against a
      // stable home count from this point on.
      await db.$transaction([
        db.hoaServiceRequest.update({
          where: { id: request.id },
          data: {
            status: "open_for_bids",
            biddingClosesAt,
            participantsLockedAt: now,
          },
        }),
        db.adminAuditLog.create({
          data: buildAuditEntry({
            actorUserId: userId,
            action: "hoa_participants_locked",
            targetType: "hoa_request",
            targetId: request.id,
            communityId: request.communityId,
            metadata: { lockedHomeCount: joinedUnits.length },
          }),
        }),
        audit("open_for_bids", { lockedHomeCount: joinedUnits.length }),
      ]);
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
      await db.$transaction([
        db.hoaServiceRequest.update({ where: { id: request.id }, data: { status: "completed" } }),
        db.serviceAgreement.update({
          where: { id: request.agreement.id },
          data: { status: "completed" },
        }),
        audit("completed"),
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
      await db.$transaction([
        db.hoaServiceRequest.update({ where: { id: request.id }, data: { status: "cancelled" } }),
        db.serviceBid.updateMany({
          where: { requestId: request.id, status: "submitted" },
          data: { status: "expired", decidedAt: now },
        }),
        audit("cancelled"),
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

type HoaLocation = {
  latitude: number | null;
  longitude: number | null;
  postalCode: string | null;
  locality: string | null;
  region: string | null;
};

export function areaCoversLocation(
  area: {
    centerLatitude: number | null;
    centerLongitude: number | null;
    radiusMiles: number | null;
    postalCodes: string[];
  },
  location: HoaLocation,
): boolean {
  if (
    location.postalCode &&
    area.postalCodes.some((code) => code.toUpperCase() === location.postalCode?.toUpperCase())
  ) {
    return true;
  }
  if (
    area.centerLatitude != null &&
    area.centerLongitude != null &&
    area.radiusMiles != null &&
    location.latitude != null &&
    location.longitude != null
  ) {
    return (
      distanceMiles(
        { latitude: area.centerLatitude, longitude: area.centerLongitude },
        { latitude: location.latitude, longitude: location.longitude },
      ) <= area.radiusMiles
    );
  }
  return false;
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

async function hoaLocation(communityId: string): Promise<HoaLocation> {
  const profile = await db.hoaProfile.findUnique({
    where: { communityId },
    select: {
      latitude: true,
      longitude: true,
      postalCode: true,
      locality: true,
      region: true,
    },
  });
  return {
    latitude: profile?.latitude ?? null,
    longitude: profile?.longitude ?? null,
    postalCode: profile?.postalCode ?? null,
    locality: profile?.locality ?? null,
    region: profile?.region ?? null,
  };
}

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
        community: { type: "hoa", status: "active" },
        OR: [{ biddingClosesAt: null }, { biddingClosesAt: { gt: now } }],
      },
      orderBy: { biddingClosesAt: "asc" },
      take: 100,
      include: {
        community: { select: { name: true, hoaProfile: true } },
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
    const profile = request.community.hoaProfile;
    const location: HoaLocation = {
      latitude: profile?.latitude ?? null,
      longitude: profile?.longitude ?? null,
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
    // Before award, providers get the HOA-level location and the aggregate
    // home count needed to quote — never resident or unit detail.
    feed.push({
      requestId: request.id,
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
      // The awarded provider needs exact stop locations to plan the day.
      (occurrencesByAgreement[occurrence.agreementId] ??= []).push(
        serializeOccurrence(occurrence, true),
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
  if (!request || request.community.type !== "hoa" || request.community.status !== "active") {
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
    hoaLocation(request.communityId),
  ]);
  if (!areas.some((area) => areaCoversLocation(area, location))) {
    throw new HoaWorkflowError("This HOA is outside your service area.", 403);
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

  const manager = await db.communityStaffAssignment.findFirst({
    where: { communityId: request.communityId, role: "hoa_manager", status: "active" },
    select: { user: { select: { id: true, email: true } } },
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
    ...buildNotificationOps(
      manager
        ? [
            {
              userId: manager.user.id,
              email: manager.user.email,
              kind: "bid" as const,
              title: `New bid on “${request.title}”`,
              body: `A provider ${existing ? "revised their" : "submitted a"} bid for ${request.community.name}.`,
              linkPath: "/app/hoa/dashboard",
              dedupeKey: `bid:${bidId}:v${(existing?.version ?? 0) + 1}`,
            },
          ]
        : [],
    ),
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

/** Bids for one request, scoped: manager or resident of that HOA only. */
export async function listRequestBids(
  viewerUserId: string,
  requestId: string,
): Promise<BidSummary[]> {
  const request = await db.hoaServiceRequest.findUnique({
    where: { id: requestId },
    select: { id: true, communityId: true },
  });
  if (!request) throw new HoaWorkflowError("That request does not exist.", 404);

  const [assignment, membership] = await Promise.all([
    db.communityStaffAssignment.findFirst({
      where: {
        userId: viewerUserId,
        communityId: request.communityId,
        role: "hoa_manager",
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

  const rows = await db.serviceBid.findMany({
    where: { requestId, status: { in: ["submitted", "accepted", "rejected"] } },
    orderBy: [{ status: "asc" }, { amountCents: "asc" }],
    include: bidInclude,
  });
  return rows.map(serializeBid);
}

/* ── Award ───────────────────────────────────────────────────────────────── */

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
 * Atomically accepts exactly one bid: rejects the rest, snapshots the terms
 * into an agreement, and materializes every occurrence and unit visit. A
 * repeated click or concurrent attempt resolves to the same single award via
 * the agreement/accepted-bid unique indexes.
 */
export async function awardBid(
  userId: string,
  requestId: string,
  input: AwardInput,
): Promise<string> {
  const request = await db.hoaServiceRequest.findUnique({
    where: { id: requestId },
    include: {
      community: { select: { id: true, name: true } },
      participations: {
        where: { response: "joined", unitId: { not: null } },
        select: { unitId: true, userId: true },
      },
      agreement: { select: { id: true, bidId: true } },
    },
  });
  if (!request) throw new HoaWorkflowError("That HOA request does not exist.", 404);
  await requireManagedHoa(userId, request.communityId);

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

  const units = request.participations
    .map((item) => ({ unitId: item.unitId as string, userId: item.userId }))
    .filter((item, index, list) => list.findIndex((other) => other.unitId === item.unitId) === index);
  if (units.length === 0) {
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
  const visitRows = occurrenceRows.flatMap((occurrence) =>
    units.map((unit) => ({
      id: randomUUID(),
      occurrenceId: occurrence.id,
      unitId: unit.unitId,
      updatedAt: now,
    })),
  );

  const losingBids = await db.serviceBid.findMany({
    where: { requestId: request.id, status: "submitted", id: { not: bid.id } },
    select: { id: true, provider: { select: { id: true, email: true } } },
  });
  const residentIntents = await activeResidentIntents(request.communityId, userId, (user) => ({
    userId: user.id,
    email: user.email,
    kind: "award",
    title: `${request.community.name}: provider selected`,
    body: `“${request.title}” was awarded to ${bid.provider.providerProfile?.companyName ?? bid.provider.fullName}.`,
    linkPath: "/app/homeowner/community",
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
          lockedHomeCount: units.length,
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
            lockedHomeCount: units.length,
            occurrenceCount: occurrenceRows.length,
          },
        }),
      }),
      ...buildNotificationOps([
        {
          userId: bid.providerUserId,
          email: provider.email,
          kind: "award",
          title: "Your bid was accepted",
          body: `${request.community.name} accepted your bid for “${request.title}”. Plan your visits in the provider portal.`,
          linkPath: "/app/provider/hoa",
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
      ]),
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
          community: { select: { name: true } },
          request: { select: { title: true } },
        },
      },
    },
  });
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
    },
  });
  const visitById = new Map(visits.map((visit) => [visit.id, visit]));
  for (const stop of input.stops) {
    const visit = visitById.get(stop.visitId);
    if (!visit) {
      throw new HoaWorkflowError("A stop in this plan does not belong to this service day.", 400);
    }
    if (["completed", "skipped", "cancelled"].includes(visit.status)) {
      throw new HoaWorkflowError(`Stop “${visit.unit.label}” is already resolved.`, 400);
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
    const manager = await db.communityStaffAssignment.findFirst({
      where: {
        communityId: occurrence.agreement.communityId,
        role: "hoa_manager",
        status: "active",
      },
      select: { user: { select: { id: true, email: true } } },
    });
    const dayLabel = occurrence.serviceDate.toISOString().slice(0, 10);

    const residentIntents: NotificationIntent[] = [];
    for (const stop of input.stops) {
      const visit = visitById.get(stop.visitId);
      const resident = visit?.unit.memberships[0]?.user;
      if (!visit || !resident) continue;
      const window =
        stop.windowStart && stop.windowEnd
          ? `between ${stop.windowStart} and ${stop.windowEnd}`
          : "during the day";
      residentIntents.push({
        userId: resident.id,
        email: resident.email,
        kind: "schedule",
        title: `${occurrence.agreement.community.name}: your service window`,
        body: `“${occurrence.agreement.request.title}” visits ${visit.unit.label} on ${dayLabel} ${window}.`,
        linkPath: "/app/homeowner/community",
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
          metadata: { sequence: occurrence.sequence, stopCount: input.stops.length },
        }),
      }),
      ...buildNotificationOps([
        ...residentIntents,
        ...(manager
          ? [
              {
                userId: manager.user.id,
                email: manager.user.email,
                kind: "schedule" as const,
                title: `Schedule published for “${occurrence.agreement.request.title}”`,
                body: `The provider planned ${input.stops.length} stops for ${dayLabel}.`,
                linkPath: "/app/hoa/dashboard",
                dedupeKey: `schedule-manager:${occurrenceId}:${contentHash(
                  input.stops.map((stop) => `${stop.visitId}:${stop.stopRank}`),
                )}`,
              },
            ]
          : []),
      ]),
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
              community: { select: { name: true } },
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
  const resident = visit.unit.memberships[0]?.user;
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
    ...buildNotificationOps(
      resident && (terminal || input.status === "en_route")
        ? [
            {
              userId: resident.id,
              email: resident.email,
              kind: "visit" as const,
              title:
                input.status === "completed"
                  ? `Service completed at ${visit.unit.label}`
                  : input.status === "en_route"
                    ? `Your provider is on the way`
                    : `Service ${input.status} at ${visit.unit.label}`,
              body: `“${visit.occurrence.agreement.request.title}” — ${visit.unit.label} is now ${input.status.replace("_", " ")}.`,
              linkPath: "/app/homeowner/community",
              dedupeKey: `visit-status:${visit.id}:${input.status}`,
            },
          ]
        : [],
    ),
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
  await requireManagedHoa(userId, occurrence.agreement.communityId);
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
      occurrence: {
        select: { agreement: { select: { providerUserId: true, communityId: true } } },
      },
    },
  });
  if (!visit) throw new HoaWorkflowError("That visit does not exist.", 404);
  const membership = await requireActiveResident(
    userId,
    visit.occurrence.agreement.communityId,
  );
  if (membership.unitId !== visit.unitId) {
    throw new HoaWorkflowError("You can only review visits to your own home.", 403);
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
  await requireManagedHoa(userId, agreement.communityId);
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
      role: "hoa_manager",
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
      // The scoped manager sees the full HOA plan, locations included.
      (occurrencesByAgreement[occurrence.agreementId] ??= []).push(
        serializeOccurrence(occurrence, true),
      );
    }

    communities.push({
      id: community.id,
      name: community.name,
      profile: await getHoaProfile(community.id),
      activeMemberCount: community._count.memberships,
      units: community.units.map((unit) => ({
        id: unit.id,
        label: unit.label,
        addressLine1: unit.addressLine1,
        locality: unit.locality,
        region: unit.region,
        postalCode: unit.postalCode,
        latitude: unit.latitude,
        longitude: unit.longitude,
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
