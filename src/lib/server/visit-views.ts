import "server-only";

import type { OccurrenceSummary, VisitSummary } from "@/lib/hoa-types";
import type { Prisma } from "@/generated/prisma/client";
import { visitPhotoRef } from "@/lib/server/visit-photos";

/**
 * The one place a service stop is turned into something a client can see.
 *
 * Every caller — provider workspace, HOA manager dashboard, resident hub,
 * neighbourhood page — goes through here, so there is exactly one answer to
 * "who may see this address". Two serializers with slightly different rules is
 * how a private location leaks.
 *
 * Two kinds of stop share the shape:
 *
 * - an HOA **unit**, whose address lives in the community inventory;
 * - a neighbourhood **homeowner**, whose address was snapshotted onto the row
 *   at award time and is read from there, never from their live profile.
 */

/** The columns every view needs. Matches {@link visitViewInclude}. */
export type VisitViewRow = {
  id: string;
  occurrenceId: string;
  unitId: string | null;
  homeownerUserId: string | null;
  serviceLabel: string | null;
  serviceAddressLine1: string | null;
  serviceLatitude: number | null;
  serviceLongitude: number | null;
  serviceAccessNotes: string | null;
  stopRank: number | null;
  scheduledDate: Date | null;
  windowStart: string | null;
  windowEnd: string | null;
  estimatedMinutes: number | null;
  status: VisitSummary["status"];
  completionNote: string | null;
  completedAt: Date | null;
  requiresAfterPhoto?: boolean;
  photos?: Array<{ id: string; purpose: string; createdAt: Date; marketingConsentedAt: Date | null }>;
  reviews?: Array<{ reviewerUserId: string; rating: number; comment: string; createdAt: Date; status: string }>;
  unit: {
    label: string;
    latitude: number | null;
    longitude: number | null;
    addressLine1: string | null;
    accessNotes: string | null;
  } | null;
  homeowner: { fullName: string } | null;
};

/** The Prisma `include` that produces a {@link VisitViewRow}. */
export const visitViewInclude = {
  photos: { where: { status: "active", purpose: { in: ["visit_before", "visit_after"] } }, select: { id: true, purpose: true, createdAt: true, marketingConsentedAt: true }, orderBy: { createdAt: "asc" }, take: 16 },
  reviews: { select: { reviewerUserId: true, rating: true, comment: true, createdAt: true, status: true } },
  unit: {
    select: {
      label: true,
      latitude: true,
      longitude: true,
      addressLine1: true,
      accessNotes: true,
    },
  },
  homeowner: { select: { fullName: true } },
} satisfies Prisma.ServiceVisitInclude;

/**
 * @param includeLocation Whether this viewer may see the exact stop location.
 * `true` for the resident of the stop, the scoped manager/admin, and the
 * awarded provider. `false` for everyone else — including a provider who bid
 * and lost, who gets the schedule and the label and no coordinates.
 * @param options.includeAccessNotes Stricter still: gate codes and pet
 * warnings reach only the resident and the provider doing the work.
 */
export function serializeVisitForViewer(
  row: VisitViewRow,
  includeLocation: boolean,
  options?: { includeAccessNotes?: boolean; viewerUserId?: string; canConsent?: boolean; canReview?: boolean },
): VisitSummary {
  const isUnit = row.unitId !== null;
  // The label is itself location data. A neighbourhood stop's label *is* the
  // snapshotted street line, and an HOA unit label is often an address too
  // (`11804 Cedar Lane` is a documented example). A viewer who may not see the
  // address must not receive it through the label either, so an unauthorized
  // view gets the stop's position in the route and nothing else.
  const label = includeLocation
    ? isUnit
      ? (row.unit?.label ?? "Home")
      : (row.serviceLabel ?? row.serviceAddressLine1 ?? row.homeowner?.fullName ?? "Home")
    : row.stopRank
      ? `Stop ${row.stopRank}`
      : "Stop";
  const ownReview = options?.viewerUserId ? row.reviews?.find((review) => review.reviewerUserId === options.viewerUserId) : null;

  return {
    id: row.id,
    occurrenceId: row.occurrenceId,
    targetKind: isUnit ? "unit" : "homeowner",
    unitId: row.unitId,
    homeownerUserId: row.homeownerUserId,
    stopLabel: label,
    latitude: includeLocation
      ? isUnit
        ? (row.unit?.latitude ?? null)
        : row.serviceLatitude
      : null,
    longitude: includeLocation
      ? isUnit
        ? (row.unit?.longitude ?? null)
        : row.serviceLongitude
      : null,
    addressLine1: includeLocation
      ? isUnit
        ? (row.unit?.addressLine1 ?? null)
        : row.serviceAddressLine1
      : null,
    accessNotes:
      includeLocation && options?.includeAccessNotes
        ? isUnit
          ? (row.unit?.accessNotes ?? null)
          : row.serviceAccessNotes
        : null,
    stopRank: row.stopRank,
    scheduledDate: row.scheduledDate?.toISOString() ?? null,
    windowStart: row.windowStart,
    windowEnd: row.windowEnd,
    estimatedMinutes: row.estimatedMinutes,
    status: row.status,
    completionNote: row.completionNote,
    completedAt: row.completedAt?.toISOString() ?? null,
    requiresAfterPhoto: row.requiresAfterPhoto ?? false,
    photos: includeLocation ? (row.photos ?? []).map((photo) => visitPhotoRef(photo, options?.canConsent === true)) : [],
    canReview: includeLocation && options?.canReview === true && row.status === "completed" && !ownReview,
    viewerReview: includeLocation && ownReview?.status === "published" ? { rating: ownReview.rating, comment: ownReview.comment, createdAt: ownReview.createdAt.toISOString() } : null,
  };
}

export type OccurrenceViewRow = {
  id: string;
  agreementId: string;
  sequence: number;
  serviceDate: Date;
  status: OccurrenceSummary["status"];
  schedulePublishedAt: Date | null;
  visits: VisitViewRow[];
};

export function serializeOccurrenceForViewer(
  row: OccurrenceViewRow,
  includeLocation: boolean,
  options?: { includeAccessNotes?: boolean },
): OccurrenceSummary {
  return {
    id: row.id,
    agreementId: row.agreementId,
    sequence: row.sequence,
    serviceDate: row.serviceDate.toISOString(),
    status: row.status,
    schedulePublishedAt: row.schedulePublishedAt?.toISOString() ?? null,
    visits: [...row.visits]
      .sort((a, b) => (a.stopRank ?? 999) - (b.stopRank ?? 999))
      .map((visit) => serializeVisitForViewer(visit, includeLocation, options)),
  };
}

/**
 * Group progress for the scoped manager of either community type.
 *
 * A manager is one of the three parties entitled to exact stop locations —
 * they coordinate the service day and answer residents about it — so addresses
 * and coordinates are included. Access notes are not: a gate code or a pet
 * warning is between the resident and the crew that turns up, and routing the
 * work has never required it.
 */
export function serializeOccurrenceForManager(row: OccurrenceViewRow): OccurrenceSummary {
  return serializeOccurrenceForViewer(row, true, { includeAccessNotes: false });
}
