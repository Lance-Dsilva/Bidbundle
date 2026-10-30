import "server-only";

import { randomUUID } from "node:crypto";

import type { Prisma } from "@/generated/prisma/client";
import type { AgreementSummary, BidSummary, OccurrenceSummary } from "@/lib/hoa-types";
import type {
  NeighborhoodHub,
  NeighborhoodParticipant,
  NeighborhoodRequestPermissions,
  NeighborhoodRequestView,
} from "@/lib/neighborhood-types";
import { buildAuditEntry } from "@/lib/server/audit";
import { db } from "@/lib/server/db";
import { HoaWorkflowError } from "@/lib/server/hoa";
import { listRequestBids } from "@/lib/server/hoa-market";
import {
  findNeighborhoodManager,
  requireActiveNeighborhoodMember,
} from "@/lib/server/market-auth";
import { buildPreferenceAwareNotificationOps } from "@/lib/server/notifications";
import {
  serializeOccurrenceForManager,
  serializeVisitForViewer,
  visitViewInclude,
} from "@/lib/server/visit-views";
import {
  CATEGORY_LABELS,
  type OwnerRequestMutationInput,
  type ServiceCategory,
} from "@/lib/validation/homeowner-requests";

/**
 * The neighbourhood side of the marketplace: enrolment, transparency, and the
 * homeowner-facing reads.
 *
 * The lifecycle itself — open bidding, close bidding, award, complete — is not
 * duplicated here. Those are the *same* functions the HOA workflow uses, in
 * `hoa-market.ts`, with authority chosen by community type. What lives here is
 * what has no HOA equivalent: a resident joining or declining their neighbour's
 * request, and the pages that show it.
 */

/* ── Participation ───────────────────────────────────────────────────────── */

export type ParticipationChoice = "joined" | "declined";

/**
 * Records this account's answer to a neighbour's request.
 *
 * Idempotent by construction: the answer is a single row keyed on
 * `(requestId, userId)`, so pressing "Join" twice, or racing two tabs, settles
 * on one participation with the last answer. Repeating the same answer is a
 * no-op that returns without touching the row.
 *
 * An outsider — anyone who is not an active member of *this* neighbourhood —
 * gets a `403` that says nothing about whether the request exists, who created
 * it, or how many neighbours joined.
 */
export async function respondToNeighborhoodRequest(
  userId: string,
  requestId: string,
  response: ParticipationChoice,
): Promise<{ response: ParticipationChoice; joinedCount: number }> {
  const request = await db.hoaServiceRequest.findUnique({
    where: { id: requestId },
    select: {
      id: true,
      communityId: true,
      kind: true,
      status: true,
      maxHomes: true,
      createdByUserId: true,
      enrollmentClosesAt: true,
      participantsLockedAt: true,
      community: { select: { type: true } },
      participations: { where: { response: "joined" }, select: { userId: true } },
    },
  });
  // "Does not exist" for a request in someone else's neighbourhood as well as
  // for a request that truly does not exist: probing ids reveals nothing.
  if (!request || request.community.type !== "neighborhood") {
    throw new HoaWorkflowError("That service request does not exist.", 404);
  }

  await requireActiveNeighborhoodMember(userId, request.communityId);

  if (request.status !== "collecting_interest") {
    throw new HoaWorkflowError("This request is no longer open for sign-ups.");
  }
  if (request.participantsLockedAt) {
    throw new HoaWorkflowError("Sign-ups for this request are locked.");
  }
  if (request.enrollmentClosesAt && request.enrollmentClosesAt <= new Date()) {
    throw new HoaWorkflowError("Sign-ups for this request have closed.");
  }
  // The requester's own home is part of the job by definition. Letting them
  // decline would leave a request with no home to service.
  if (request.createdByUserId === userId && response === "declined") {
    throw new HoaWorkflowError(
      "You opened this request, so your home is included. Cancel the request instead.",
    );
  }

  const alreadyJoined = request.participations.some(
    (participation) => participation.userId === userId,
  );
  if (
    response === "joined" &&
    !alreadyJoined &&
    request.maxHomes != null &&
    request.participations.length >= request.maxHomes
  ) {
    throw new HoaWorkflowError("This service has reached its maximum number of homes.");
  }

  const existing = await db.hoaRequestParticipation.findFirst({
    where: { requestId, userId },
    select: { id: true, response: true },
  });

  if (existing?.response === response) {
    return { response, joinedCount: request.participations.length };
  }

  if (existing) {
    await db.hoaRequestParticipation.update({
      where: { id: existing.id },
      data: { response },
    });
  } else {
    try {
      await db.hoaRequestParticipation.create({
        data: { id: randomUUID(), requestId, userId, unitId: null, response },
      });
    } catch (error) {
      // Two concurrent first-time answers: the unique index on
      // (requestId, userId) keeps one row, and the loser applies its answer as
      // an update rather than failing the customer's click.
      if ((error as { code?: string }).code !== "P2002") throw error;
      await db.hoaRequestParticipation.updateMany({
        where: { requestId, userId },
        data: { response },
      });
    }
  }

  const joinedCount = await db.hoaRequestParticipation.count({
    where: { requestId, response: "joined" },
  });

  // The person running the request needs to know the home count moved, because
  // it is what they check before opening bidding.
  const manager = await findNeighborhoodManager(request.communityId);
  const notifyUserId = manager?.userId ?? request.createdByUserId;
  if (notifyUserId !== userId) {
    const recipient = await db.user.findUnique({
      where: { id: notifyUserId },
      select: { email: true },
    });
    const ops = await buildPreferenceAwareNotificationOps([
      {
        userId: notifyUserId,
        email: recipient?.email ?? null,
        kind: "request",
        title: `A neighbour ${response === "joined" ? "joined" : "declined"} a request`,
        body: `${joinedCount} ${joinedCount === 1 ? "home is" : "homes are"} now taking part.`,
        linkPath: "/app/homeowner/neighbourhood",
        // Keyed on the answer so a change of mind is a new event and a repeat
        // of the same answer is not.
        dedupeKey: `participation:${requestId}:${userId}:${response}`,
      },
    ]);
    if (ops.length > 0) await db.$transaction(ops);
  }

  return { response, joinedCount };
}

/* ── Request owner changes ───────────────────────────────────────────────── */

/**
 * A creator can correct or withdraw their own unlocked request, never manage
 * someone else's lifecycle. The conditional write is the first operation in
 * the same transaction as its audit and notification intents. Losing a race
 * with bidding, another edit, or revoked membership therefore writes nothing.
 */
export async function mutateOwnedNeighborhoodRequest(
  userId: string,
  requestId: string,
  input: OwnerRequestMutationInput,
): Promise<void> {
  const request = await db.hoaServiceRequest.findUnique({
    where: { id: requestId },
    select: {
      id: true,
      communityId: true,
      createdByUserId: true,
      createdBy: { select: { role: true } },
      title: true,
      category: true,
      description: true,
      budgetMinCents: true,
      budgetMaxCents: true,
      kind: true,
      status: true,
      updatedAt: true,
      participantsLockedAt: true,
      agreement: { select: { id: true } },
      bids: { select: { id: true }, take: 1 },
      community: { select: { type: true } },
    },
  });
  if (!request || request.community.type !== "neighborhood") {
    throw new HoaWorkflowError("That service request does not exist.", 404);
  }
  const membership = await requireActiveNeighborhoodMember(userId, request.communityId);
  if (request.createdByUserId !== userId || request.createdBy.role !== "homeowner") {
    throw new HoaWorkflowError("Only the homeowner who opened this request can change it.", 403);
  }
  if (request.kind !== "optional_group" || !PRE_BIDDING_STATUSES.has(request.status) ||
    request.participantsLockedAt !== null || request.agreement || request.bids.length > 0) {
    throw new HoaWorkflowError("This request can no longer be edited or cancelled. Refresh to see its current status.", 409);
  }

  const changedFields = input.action === "edit"
    ? (["title", "category", "description", "budgetMinCents", "budgetMaxCents"] as const)
      .filter((field) => request[field] !== input[field])
    : ["status"];
  if (changedFields.length === 0) return;

  // Advance even when two changes land within one millisecond. The value is
  // also part of a per-edit event key, not a request-wide notification key.
  const updatedAt = new Date(Math.max(Date.now(), request.updatedAt.getTime() + 1));
  const title = input.action === "edit" ? input.title : request.title;
  const nextStatus = input.action === "cancel" ? "cancelled" : request.status;
  const recipients = request.status === "collecting_interest"
    ? await db.communityMembership.findMany({
      where: { communityId: request.communityId, status: "active", NOT: { userId } },
      select: { user: { select: { id: true, email: true } } },
    })
    : [];
  const notificationOps = await buildPreferenceAwareNotificationOps(recipients.map(({ user }) => ({
    userId: user.id,
    email: user.email,
    kind: "request" as const,
    title: `${membership.communityName}: service request ${input.action === "cancel" ? "cancelled" : "updated"}`,
    body: input.action === "cancel"
      ? `“${title}” was cancelled by the homeowner who opened it. No service is scheduled for this request.`
      : `The homeowner updated “${title}”. Review the scope and budget before deciding whether to take part.`,
    linkPath: "/app/homeowner/neighbourhood",
    dedupeKey: `owner-request:${request.id}:${input.action}:${updatedAt.toISOString()}:${user.id}`,
  })));

  try {
    await db.$transaction([
      db.hoaServiceRequest.update({
        where: {
          id: request.id,
          createdByUserId: userId,
          createdBy: { role: "homeowner" },
          communityId: request.communityId,
          community: {
            type: "neighborhood",
            status: "active",
            memberships: { some: { userId, status: "active" } },
          },
          kind: "optional_group",
          status: request.status,
          updatedAt: request.updatedAt,
          participantsLockedAt: null,
          agreement: { is: null },
          bids: { none: {} },
        },
        data: input.action === "cancel"
          ? { status: "cancelled", updatedAt }
          : {
            title: input.title,
            category: input.category,
            description: input.description,
            budgetMinCents: input.budgetMinCents,
            budgetMaxCents: input.budgetMaxCents,
            updatedAt,
          },
      }),
      db.adminAuditLog.create({
        data: buildAuditEntry({
          actorUserId: userId,
          action: "hoa_request_status_changed",
          targetType: "hoa_request",
          targetId: request.id,
          communityId: request.communityId,
          metadata: {
            context: "neighborhood",
            via: "request_owner",
            reason: input.action === "edit" ? "owner_edit" : "owner_cancel",
            previousStatus: request.status,
            nextStatus,
            changedFields,
          },
        }),
      }),
      ...notificationOps,
    ]);
  } catch (error) {
    if ((error as { code?: string }).code === "P2025") {
      throw new HoaWorkflowError("This request changed before your update was saved. Refresh and try again.", 409);
    }
    throw error;
  }
}

/* ── Reads ───────────────────────────────────────────────────────────────── */

const requestSelect = {
  id: true,
  communityId: true,
  title: true,
  category: true,
  description: true,
  status: true,
  budgetMinCents: true,
  budgetMaxCents: true,
  totalOccurrences: true,
  minHomes: true,
  maxHomes: true,
  enrollmentClosesAt: true,
  biddingClosesAt: true,
  participantsLockedAt: true,
  awardedAt: true,
  startDate: true,
  createdByUserId: true,
  createdAt: true,
  kind: true,
  agreement: { select: { id: true } },
  bids: { select: { id: true }, take: 1 },
  community: { select: { id: true, name: true } },
  createdBy: { select: { fullName: true, role: true } },
  participations: {
    select: {
      response: true,
      userId: true,
      user: { select: { id: true, fullName: true, address: true, latitude: true, longitude: true } },
    },
  },
  _count: {
    select: { bids: { where: { status: { in: ["submitted", "accepted", "rejected"] } } } },
  },
} satisfies Prisma.HoaServiceRequestSelect;

type NeighborhoodRequestRow = Prisma.HoaServiceRequestGetPayload<{
  select: typeof requestSelect;
}>;

/** Statuses in which the creator may still edit or cancel their own request. */
const PRE_BIDDING_STATUSES = new Set(["draft", "collecting_interest"]);

function permissionsFor(input: {
  row: NeighborhoodRequestRow;
  viewerUserId: string;
  isManager: boolean;
  viewerResponse: "joined" | "declined" | null;
  now: Date;
}): NeighborhoodRequestPermissions {
  const { row, viewerUserId, isManager, viewerResponse, now } = input;
  const enrollmentOpen =
    row.status === "collecting_interest" &&
    row.participantsLockedAt === null &&
    (row.enrollmentClosesAt === null || row.enrollmentClosesAt > now);
  const isOwner = row.createdByUserId === viewerUserId;

  return {
    // The creator's home is already in; there is nothing for them to respond to.
    canRespond: enrollmentOpen && !isOwner,
    canManage: isManager,
    // Transparent comparison for everyone taking part, but never for a
    // neighbour who declined or never answered.
    canViewBids: isManager || isOwner || viewerResponse === "joined",
    canEdit: isOwner && row.createdBy.role === "homeowner" && row.kind === "optional_group" && PRE_BIDDING_STATUSES.has(row.status) &&
      row.participantsLockedAt === null && row.agreement === null && row.bids.length === 0,
  };
}

/** Whether Bundleen holds a routeable address for one account. */
function addressReady(user: {
  address: string | null;
  latitude: number | null;
  longitude: number | null;
} | null): boolean {
  return Boolean(user?.address?.trim()) && user?.latitude != null && user?.longitude != null;
}

async function serializeRequest(input: {
  row: NeighborhoodRequestRow;
  viewerUserId: string;
  isManager: boolean;
  now: Date;
}): Promise<NeighborhoodRequestView> {
  const { row, viewerUserId, isManager, now } = input;
  const joined = row.participations.filter((item) => item.response === "joined");
  const declined = row.participations.filter((item) => item.response === "declined");
  const viewerResponse =
    row.participations.find((item) => item.userId === viewerUserId)?.response ?? null;
  const permissions = permissionsFor({ row, viewerUserId, isManager, viewerResponse, now });

  // Bids go through the shared authorization in `listRequestBids` rather than
  // being filtered here, so there is one rule about who may see quotes.
  let bids: BidSummary[] | null = null;
  if (permissions.canViewBids) {
    bids = await listRequestBids(viewerUserId, row.id).catch(() => null);
  }

  // The manager needs to know which homes cannot yet be routed to, so they can
  // chase those neighbours before awarding rather than after.
  const participants: NeighborhoodParticipant[] | null = permissions.canManage
    ? row.participations
        .filter((item) => item.user !== null)
        .map((item) => ({
          userId: item.user!.id,
          displayName: item.user!.fullName,
          addressReady: addressReady(item.user),
          response: item.response,
          isViewer: item.user!.id === viewerUserId,
        }))
    : null;

  const agreement = await db.serviceAgreement.findUnique({
    where: { requestId: row.id },
    select: {
      id: true,
      requestId: true,
      communityId: true,
      providerUserId: true,
      amountCents: true,
      currency: true,
      pricingBasis: true,
      perHomeCents: true,
      scope: true,
      cadenceLabel: true,
      lockedHomeCount: true,
      startDate: true,
      endDate: true,
      status: true,
      createdAt: true,
      request: { select: { title: true } },
      community: { select: { name: true } },
      provider: {
        select: { fullName: true, providerProfile: { select: { companyName: true } } },
      },
    },
  });

  const agreementSummary: AgreementSummary | null = agreement
    ? {
        id: agreement.id,
        requestId: agreement.requestId,
        requestTitle: agreement.request.title,
        communityId: agreement.communityId,
        communityName: agreement.community.name,
        providerUserId: agreement.providerUserId,
        providerName: agreement.provider.fullName,
        providerCompany: agreement.provider.providerProfile?.companyName ?? null,
        amountCents: agreement.amountCents,
        currency: agreement.currency,
        pricingBasis: agreement.pricingBasis,
        perHomeCents: agreement.perHomeCents,
        scope: agreement.scope,
        cadenceLabel: agreement.cadenceLabel,
        lockedHomeCount: agreement.lockedHomeCount,
        startDate: agreement.startDate?.toISOString() ?? null,
        endDate: agreement.endDate?.toISOString() ?? null,
        status: agreement.status,
        createdAt: agreement.createdAt.toISOString(),
      }
    : null;

  const { myVisits, occurrences } = agreement
    ? await visitsFor({ agreementId: agreement.id, viewerUserId, isManager })
    : { myVisits: [], occurrences: null };

  const category = row.category as ServiceCategory;
  return {
    id: row.id,
    communityId: row.community.id,
    communityName: row.community.name,
    title: row.title,
    category: row.category,
    categoryLabel: CATEGORY_LABELS[category] ?? row.category,
    description: row.description,
    status: row.status,
    budgetMinCents: row.budgetMinCents,
    budgetMaxCents: row.budgetMaxCents,
    minHomes: row.minHomes ?? 1,
    maxHomes: row.maxHomes,
    enrollmentClosesAt: row.enrollmentClosesAt?.toISOString() ?? null,
    biddingClosesAt: row.biddingClosesAt?.toISOString() ?? null,
    participantsLockedAt: row.participantsLockedAt?.toISOString() ?? null,
    awardedAt: row.awardedAt?.toISOString() ?? null,
    startDate: row.startDate?.toISOString() ?? null,
    totalOccurrences: row.totalOccurrences,
    joinedCount: joined.length,
    declinedCount: declined.length,
    bidCount: row._count.bids,
    viewerResponse,
    isOwner: row.createdByUserId === viewerUserId,
    createdByName: row.createdBy.fullName,
    createdAt: row.createdAt.toISOString(),
    permissions,
    bids,
    participants,
    agreement: agreementSummary,
    myVisits,
    occurrences,
  };
}

/**
 * Stops for one agreement, split by what the viewer may see.
 *
 * A resident gets their *own* stop with its exact location. A manager gets
 * group progress — every stop's schedule and status — with locations redacted,
 * because coordinating a service day does not require knowing where each
 * neighbour lives.
 */
async function visitsFor(input: {
  agreementId: string;
  viewerUserId: string;
  isManager: boolean;
}): Promise<{ myVisits: OccurrenceSummary["visits"]; occurrences: OccurrenceSummary[] | null }> {
  const own = await db.serviceVisit.findMany({
    where: {
      homeownerUserId: input.viewerUserId,
      occurrence: { agreementId: input.agreementId },
    },
    orderBy: { scheduledDate: "asc" },
    include: visitViewInclude,
  });

  const occurrences = input.isManager
    ? await db.serviceOccurrence.findMany({
        where: { agreementId: input.agreementId },
        orderBy: { sequence: "asc" },
        include: { visits: { include: visitViewInclude } },
      })
    : null;

  return {
    myVisits: own.map((visit) => serializeVisitForViewer(visit, true)),
    occurrences: occurrences?.map(serializeOccurrenceForManager) ?? null,
  };
}

/**
 * Everything the homeowner's neighbourhood page shows.
 *
 * One community — the one active neighbourhood membership a homeowner has —
 * and the requests inside it. Requests from other neighbourhoods are not
 * merely hidden from the response; they are never read.
 */
export async function getNeighborhoodHub(userId: string): Promise<NeighborhoodHub | null> {
  const membership = await db.communityMembership.findFirst({
    where: {
      userId,
      status: "active",
      community: { type: "neighborhood", status: "active" },
    },
    select: { community: { select: { id: true, name: true } } },
  });
  if (!membership) return null;

  const communityId = membership.community.id;
  const [manager, neighbourCount, rows, viewer] = await Promise.all([
    findNeighborhoodManager(communityId),
    db.communityMembership.count({ where: { communityId, status: "active" } }),
    db.hoaServiceRequest.findMany({
      where: {
        communityId,
        OR: [{ status: { not: "draft" } }, { createdByUserId: userId }],
      },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: requestSelect,
    }),
    db.user.findUnique({
      where: { id: userId },
      select: { address: true, latitude: true, longitude: true },
    }),
  ]);

  const isManager = manager?.userId === userId;
  const now = new Date();
  const requests = await Promise.all(
    rows.map((row) => serializeRequest({ row, viewerUserId: userId, isManager, now })),
  );

  return {
    communityId,
    communityName: membership.community.name,
    isManager,
    managerName: manager?.fullName ?? null,
    activeNeighbourCount: neighbourCount,
    addressReady: addressReady(viewer),
    requests,
  };
}

/** One request, for the detail view. Membership is required to see any of it. */
export async function getNeighborhoodRequest(
  userId: string,
  requestId: string,
): Promise<NeighborhoodRequestView> {
  const row = await db.hoaServiceRequest.findFirst({
    where: {
      id: requestId,
      community: { type: "neighborhood" },
      OR: [{ status: { not: "draft" } }, { createdByUserId: userId }],
    },
    select: requestSelect,
  });
  if (!row) throw new HoaWorkflowError("That service request does not exist.", 404);

  await requireActiveNeighborhoodMember(userId, row.communityId);
  const manager = await findNeighborhoodManager(row.communityId);

  return serializeRequest({
    row,
    viewerUserId: userId,
    isManager: manager?.userId === userId,
    now: new Date(),
  });
}

/* ── Deadline reconciliation ─────────────────────────────────────────────── */

/**
 * Advances requests whose windows have expired.
 *
 * Deadlines are deterministic: a request whose bidding deadline has passed is
 * closed regardless of whether anyone visited the page. This runs from the
 * outbox job, and calls the *same* domain rules the manager's buttons do — so
 * a sweep and a click cannot reach different states.
 *
 * Every step is expressed as a conditional `updateMany`, so a sweep racing a
 * manager's click updates zero rows rather than duplicating the transition.
 */
export async function reconcileExpiredWindows(now = new Date()): Promise<{
  biddingClosed: number;
  enrollmentExpired: number;
}> {
  // Bidding deadline passed → bidding is closed, and the manager compares what
  // arrived. Never auto-awarded: choosing a provider is a human decision.
  const closed = await db.hoaServiceRequest.updateMany({
    where: {
      status: "open_for_bids",
      biddingClosesAt: { not: null, lte: now },
    },
    data: { status: "bidding_closed" },
  });

  // Enrolment deadline passed with nobody joined → the request cannot proceed
  // and is marked failed rather than left collecting interest forever.
  const expired = await db.hoaServiceRequest.updateMany({
    where: {
      status: "collecting_interest",
      enrollmentClosesAt: { not: null, lte: now },
      participantsLockedAt: null,
      participations: { none: { response: "joined" } },
    },
    data: { status: "failed" },
  });

  if (closed.count > 0 || expired.count > 0) {
    await db.adminAuditLog.create({
      data: buildAuditEntry({
        actorUserId: null,
        action: "hoa_request_status_changed",
        targetType: "hoa_request",
        targetId: "scheduled-reconciliation",
        metadata: {
          via: "deadline_reconciliation",
          biddingClosed: closed.count,
          enrollmentExpired: expired.count,
        },
      }),
    });
  }

  return { biddingClosed: closed.count, enrollmentExpired: expired.count };
}
