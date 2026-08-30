import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import type {
  AmenityCardView,
  AmenityCatalog,
  AmenityClosureView,
  AmenityDetailView,
  AmenityHoursView,
  AmenityReviewSummary,
  AvailabilityDayView,
  ManagerAmenityWorkspace,
  RatingDistribution,
} from "@/lib/amenity-types";
import { AMENITY_TYPE_LABELS } from "@/lib/amenity-types";
import { buildAuditEntry } from "@/lib/server/audit";
import type { AmenityScope } from "@/lib/server/amenity-auth";
import { listHoaStaff, visibleStatusesFor } from "@/lib/server/amenity-auth";
import {
  computeAvailability,
  nextAvailableSlot,
  todayHoursLabel,
  type AvailabilitySnapshot,
} from "@/lib/server/amenity-availability";
import {
  listManagerBookings,
  serializeBooking,
} from "@/lib/server/amenity-bookings";
import { listHoaIssues } from "@/lib/server/amenity-issues";
import {
  AMENITY_SELECT,
  policyOf,
  snapshotFromRow,
  type AmenityRow,
} from "@/lib/server/amenity-snapshot";
import { db } from "@/lib/server/db";
import { HoaWorkflowError } from "@/lib/server/hoa";
import { toMediaRef } from "@/lib/server/media";
import {
  formatMinuteOfDay,
  WEEKDAY_BY_INDEX,
  zonedDateKey,
  type WeekdayName,
} from "@/lib/server/timezone";
import type {
  AmenityClosureInput,
  AmenityCreateInput,
  AmenityUpdateInput,
} from "@/lib/validation/amenities";

/**
 * The amenity catalog: what residents browse, and what managers configure.
 *
 * Reads are scoped by an {@link AmenityScope} the caller already proved, and
 * every query repeats `communityId` rather than trusting the id in the URL.
 * The redundancy is deliberate — a missing scope check should produce an empty
 * result, not another HOA's clubhouse.
 */

/** Horizon used for the "next available" teaser on a catalog card. */
const CARD_LOOKAHEAD_DAYS = 14;

function hoursViews(row: AmenityRow): AmenityHoursView[] {
  return row.hours.map((entry) => ({
    weekday: entry.weekday,
    opensMinute: entry.opensMinute,
    closesMinute: entry.closesMinute,
    label: `${formatMinuteOfDay(entry.opensMinute)}–${formatMinuteOfDay(entry.closesMinute)}`,
  }));
}

/** The next day with opening hours, for a card that is closed right now. */
function nextOpenLabel(row: AmenityRow, now: Date, timeZone: string): string | null {
  const todayIndex = new Date(zonedDateKey(now, timeZone) + "T00:00:00Z").getUTCDay();
  for (let offset = 0; offset < 7; offset += 1) {
    const weekday = WEEKDAY_BY_INDEX[(todayIndex + offset) % 7];
    const windows = row.hours.filter((entry) => entry.weekday === weekday);
    if (windows.length === 0) continue;
    const earliest = windows.reduce((a, b) => (a.opensMinute <= b.opensMinute ? a : b));
    const dayLabel = offset === 0 ? "today" : offset === 1 ? "tomorrow" : weekday;
    return `Opens ${dayLabel} at ${formatMinuteOfDay(earliest.opensMinute)}`;
  }
  return null;
}

function capacityLabel(row: AmenityRow): string | null {
  const parts: string[] = [];
  if (row.bookingRequired && row.resources.length > 1) {
    parts.push(`${row.resources.length} spaces`);
  }
  if (row.maxPartySize > 1) parts.push(`up to ${row.maxPartySize} people`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

function averageRating(row: { ratingCount: number; ratingSum: number }): number | null {
  if (row.ratingCount === 0) return null;
  return Math.round((row.ratingSum / row.ratingCount) * 10) / 10;
}

function closureView(
  closure: AmenityRow["closures"][number],
  timeZone: string,
): AmenityClosureView {
  const label = closure.recurringWeekday
    ? `Every ${closure.recurringWeekday}, ${formatMinuteOfDay(closure.recurringStartMinute ?? 0)}–${formatMinuteOfDay(closure.recurringEndMinute ?? 0)}`
    : closure.startsAt && closure.endsAt
      ? `${zonedDateKey(closure.startsAt, timeZone)} → ${zonedDateKey(closure.endsAt, timeZone)}`
      : "Scheduled closure";

  return {
    id: closure.id,
    kind: closure.kind,
    startsAt: closure.startsAt?.toISOString() ?? null,
    endsAt: closure.endsAt?.toISOString() ?? null,
    recurringWeekday: closure.recurringWeekday,
    recurringStartMinute: closure.recurringStartMinute,
    recurringEndMinute: closure.recurringEndMinute,
    residentVisible: closure.residentVisible,
    reason: closure.reason,
    label,
  };
}

async function cardView(
  row: AmenityRow,
  scope: AmenityScope,
  now: Date,
  heldBlocks: AvailabilitySnapshot["heldBlocks"],
  gallery: Array<{ id: string; width: number | null; height: number | null }>,
): Promise<AmenityCardView> {
  const snapshot = snapshotFromRow(row, scope.timezone, heldBlocks);
  const todayLabel = todayHoursLabel(snapshot, now);

  let nextAvailable: AmenityCardView["nextAvailable"] = null;
  if (row.bookingRequired && row.status === "published" && row.operationalStatus === "open") {
    const days = computeAvailability(snapshot, {
      now,
      fromDate: zonedDateKey(now, scope.timezone),
      days: Math.min(CARD_LOOKAHEAD_DAYS, Math.max(row.advanceDays + 1, 1)),
    });
    const slot = nextAvailableSlot(days);
    const day = slot ? days.find((entry) => entry.slots.includes(slot)) : null;
    nextAvailable = slot
      ? { startsAt: slot.startsAt, label: `${day?.date ?? ""} ${slot.startLabel}`.trim() }
      : null;
  }

  const cover =
    row.coverMedia && row.coverMedia.status === "active"
      ? toMediaRef(row.coverMedia)
      : gallery.length > 0
        ? toMediaRef(gallery[0])
        : null;

  return {
    id: row.id,
    name: row.name,
    type: row.type,
    typeLabel: AMENITY_TYPE_LABELS[row.type],
    status: row.status,
    operationalStatus: row.operationalStatus,
    operationalNote: row.operationalNote,
    reopensAt: row.reopensAt?.toISOString() ?? null,
    locationLabel: row.locationLabel,
    bookingRequired: row.bookingRequired,
    cover,
    hoursLabel: todayLabel,
    nextOpenLabel: todayLabel ? null : nextOpenLabel(row, now, scope.timezone),
    nextAvailable,
    capacityLabel: capacityLabel(row),
    averageRating: averageRating(row),
    reviewCount: row.ratingCount,
  };
}

/** Rating distribution, computed server-side from live published rows. */
export async function loadReviewSummary(
  amenityId: string,
  aggregate: { ratingCount: number; ratingSum: number },
): Promise<AmenityReviewSummary> {
  const grouped = await db.amenityReview.groupBy({
    by: ["rating"],
    where: { amenityId, status: "published" },
    _count: { _all: true },
  });

  const counts = new Map<number, number>();
  for (const bucket of grouped) counts.set(bucket.rating, bucket._count._all);
  const total = [...counts.values()].reduce((sum, value) => sum + value, 0);

  const distribution: RatingDistribution[] = ([5, 4, 3, 2, 1] as const).map((rating) => {
    const count = counts.get(rating) ?? 0;
    return {
      rating,
      count,
      percent: total === 0 ? 0 : Math.round((count / total) * 100),
    };
  });

  return {
    averageRating: averageRating(aggregate),
    reviewCount: aggregate.ratingCount,
    distribution,
  };
}

/* ── Resident + manager reads ────────────────────────────────────────────── */

/** The scrollable catalog for one HOA. */
export async function getAmenityCatalog(
  scope: AmenityScope,
  now = new Date(),
): Promise<AmenityCatalog> {
  const rows = (await db.amenity.findMany({
    where: { communityId: scope.communityId, status: { in: visibleStatusesFor(scope) } },
    orderBy: [{ status: "asc" }, { name: "asc" }],
    select: AMENITY_SELECT,
  })) as unknown as AmenityRow[];

  const amenityIds = rows.map((row) => row.id);
  const horizon = new Date(now.getTime() + (CARD_LOOKAHEAD_DAYS + 2) * 86_400_000);

  const [blocks, galleries, bookings, issues] = await Promise.all([
    amenityIds.length === 0
      ? []
      : db.amenityBooking.findMany({
          where: {
            amenityId: { in: amenityIds },
            status: { in: ["pending_approval", "confirmed"] },
            blockEndsAt: { gt: now },
            blockStartsAt: { lt: horizon },
          },
          select: {
            id: true,
            amenityId: true,
            resourceId: true,
            blockStartsAt: true,
            blockEndsAt: true,
          },
        }),
    amenityIds.length === 0
      ? []
      : db.mediaAsset.findMany({
          where: { amenityId: { in: amenityIds }, status: "active" },
          orderBy: [{ position: "asc" }, { createdAt: "asc" }],
          select: { id: true, amenityId: true, width: true, height: true },
        }),
    listMyUpcomingBookings(scope, now),
    db.amenityIssue.findMany({
      where: {
        communityId: scope.communityId,
        reporterUserId: scope.userId,
        status: { notIn: ["closed"] },
      },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        reference: true,
        subject: true,
        status: true,
        amenity: { select: { name: true } },
      },
    }),
  ]);

  const blocksByAmenity = new Map<string, AvailabilitySnapshot["heldBlocks"][number][]>();
  for (const block of blocks) {
    const list = blocksByAmenity.get(block.amenityId) ?? [];
    list.push({
      bookingId: block.id,
      resourceId: block.resourceId,
      blockStartsAt: block.blockStartsAt,
      blockEndsAt: block.blockEndsAt,
    });
    blocksByAmenity.set(block.amenityId, list);
  }

  const galleryByAmenity = new Map<string, Array<{ id: string; width: number | null; height: number | null }>>();
  for (const asset of galleries) {
    if (!asset.amenityId) continue;
    const list = galleryByAmenity.get(asset.amenityId) ?? [];
    list.push({ id: asset.id, width: asset.width, height: asset.height });
    galleryByAmenity.set(asset.amenityId, list);
  }

  const amenities = await Promise.all(
    rows.map((row) =>
      cardView(
        row,
        scope,
        now,
        blocksByAmenity.get(row.id) ?? [],
        galleryByAmenity.get(row.id) ?? [],
      ),
    ),
  );

  return {
    communityId: scope.communityId,
    communityName: scope.communityName,
    timezone: scope.timezone,
    canManage: scope.canManage,
    amenities,
    myUpcomingBookings: bookings,
    myOpenIssues: issues.map((issue) => ({
      id: issue.id,
      reference: issue.reference,
      subject: issue.subject,
      status: issue.status,
      statusLabel: issue.status.replace(/_/g, " "),
      amenityName: issue.amenity.name,
    })),
  };
}

/** Upcoming reservations belonging to the caller. */
export async function listMyUpcomingBookings(scope: AmenityScope, now = new Date()) {
  const rows = await db.amenityBooking.findMany({
    where: {
      communityId: scope.communityId,
      userId: scope.userId,
      status: { in: ["pending_approval", "confirmed"] },
      endsAt: { gt: now },
    },
    orderBy: { startsAt: "asc" },
    take: 20,
    include: {
      amenity: { select: { id: true, name: true, cancellationCutoffMinutes: true } },
      resource: { select: { label: true } },
    },
  });

  return rows.map((row) => serializeBooking(row, now));
}

export async function getAmenityDetail(
  scope: AmenityScope,
  amenityId: string,
  now = new Date(),
): Promise<AmenityDetailView> {
  const row = (await db.amenity.findFirst({
    where: {
      id: amenityId,
      communityId: scope.communityId,
      status: { in: visibleStatusesFor(scope) },
    },
    select: AMENITY_SELECT,
  })) as unknown as AmenityRow | null;
  if (!row) throw new HoaWorkflowError("That amenity is not available.", 404);

  const horizon = new Date(now.getTime() + (row.advanceDays + 2) * 86_400_000);
  const [gallery, blocks, reviewSummary, myBookings, eligibility] = await Promise.all([
    db.mediaAsset.findMany({
      where: { amenityId: row.id, status: "active" },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      select: { id: true, width: true, height: true },
    }),
    db.amenityBooking.findMany({
      where: {
        amenityId: row.id,
        status: { in: ["pending_approval", "confirmed"] },
        blockEndsAt: { gt: now },
        blockStartsAt: { lt: horizon },
      },
      select: { id: true, resourceId: true, blockStartsAt: true, blockEndsAt: true },
    }),
    loadReviewSummary(row.id, row),
    db.amenityBooking.findMany({
      where: {
        amenityId: row.id,
        userId: scope.userId,
        status: { in: ["pending_approval", "confirmed"] },
        endsAt: { gt: now },
      },
      orderBy: { startsAt: "asc" },
      include: {
        amenity: { select: { id: true, name: true, cancellationCutoffMinutes: true } },
        resource: { select: { label: true } },
      },
    }),
    resolveReviewEligibility(row, scope),
  ]);

  const card = await cardView(
    row,
    scope,
    now,
    blocks.map((block) => ({
      bookingId: block.id,
      resourceId: block.resourceId,
      blockStartsAt: block.blockStartsAt,
      blockEndsAt: block.blockEndsAt,
    })),
    gallery,
  );

  return {
    ...card,
    description: row.description,
    features: row.features,
    rules: row.rules,
    permittedUses: row.permittedUses,
    ageRestriction: row.ageRestriction,
    guestPolicy: row.guestPolicy,
    cancellationPolicy: row.cancellationPolicy,
    contactInstructions: row.contactInstructions,
    gallery: gallery.map(toMediaRef),
    hours: hoursViews(row),
    // A private event removes the slot but never explains itself to residents.
    closures: row.closures
      .filter((closure) => scope.canManage || closure.residentVisible)
      .map((closure) => closureView(closure, scope.timezone)),
    policy: row.bookingRequired ? policyOf(row) : null,
    resourceCount: row.resources.length,
    reviewSummary,
    reviewEligibility: eligibility,
    myUpcomingBookings: myBookings.map((booking) => serializeBooking(booking, now)),
  };
}

/**
 * The documented eligibility rule.
 *
 * A bookable amenity is reviewable once per completed booking; a common area
 * that takes no bookings is reviewable once by any active resident. Managers
 * and admins who do not live here get a clear reason rather than a form that
 * would fail on submit.
 */
async function resolveReviewEligibility(
  row: AmenityRow,
  scope: AmenityScope,
): Promise<AmenityDetailView["reviewEligibility"]> {
  if (!scope.membershipId) {
    return {
      canReview: false,
      reason: "Only residents of this HOA can review its amenities.",
      eligibleBookingIds: [],
    };
  }

  if (!row.bookingRequired) {
    const existing = await db.amenityReview.findFirst({
      where: {
        amenityId: row.id,
        authorUserId: scope.userId,
        bookingId: null,
        status: "published",
      },
      select: { id: true },
    });
    return existing
      ? {
          canReview: false,
          reason: "You have already reviewed this amenity. You can edit your review.",
          eligibleBookingIds: [],
        }
      : { canReview: true, reason: null, eligibleBookingIds: [] };
  }

  const completed = await db.amenityBooking.findMany({
    where: {
      amenityId: row.id,
      userId: scope.userId,
      status: "completed",
      reviews: { none: {} },
    },
    orderBy: { startsAt: "desc" },
    take: 20,
    select: { id: true },
  });

  return completed.length > 0
    ? { canReview: true, reason: null, eligibleBookingIds: completed.map((b) => b.id) }
    : {
        canReview: false,
        reason: "You can review this amenity after a completed booking.",
        eligibleBookingIds: [],
      };
}

/** Server-rendered slot calendar for one amenity. */
export async function getAmenityAvailability(
  scope: AmenityScope,
  amenityId: string,
  query: { from?: string; days?: number; durationMinutes?: number },
  now = new Date(),
): Promise<{ timezone: string; days: AvailabilityDayView[] }> {
  const row = (await db.amenity.findFirst({
    where: {
      id: amenityId,
      communityId: scope.communityId,
      status: { in: visibleStatusesFor(scope) },
    },
    select: AMENITY_SELECT,
  })) as unknown as AmenityRow | null;
  if (!row) throw new HoaWorkflowError("That amenity is not available.", 404);

  if (!row.bookingRequired) {
    // The product rule: a common area must never render a fake calendar.
    return { timezone: scope.timezone, days: [] };
  }

  const fromDate = query.from ?? zonedDateKey(now, scope.timezone);
  const days = Math.min(query.days ?? 7, 31);
  const windowStart = new Date(now.getTime() - 86_400_000);
  const windowEnd = new Date(now.getTime() + (days + 2) * 86_400_000);

  const blocks = await db.amenityBooking.findMany({
    where: {
      amenityId: row.id,
      status: { in: ["pending_approval", "confirmed"] },
      blockEndsAt: { gt: windowStart },
      blockStartsAt: { lt: windowEnd },
    },
    select: { id: true, resourceId: true, blockStartsAt: true, blockEndsAt: true },
  });

  const snapshot = snapshotFromRow(
    row,
    scope.timezone,
    blocks.map((block) => ({
      bookingId: block.id,
      resourceId: block.resourceId,
      blockStartsAt: block.blockStartsAt,
      blockEndsAt: block.blockEndsAt,
    })),
  );

  return {
    timezone: scope.timezone,
    days: computeAvailability(snapshot, {
      now,
      fromDate,
      days,
      durationMinutes: query.durationMinutes,
    }),
  };
}

/* ── Manager configuration ───────────────────────────────────────────────── */

const DEFAULT_POLICY = {
  slotMinutes: 60,
  minDurationMinutes: 60,
  maxDurationMinutes: 120,
  bufferMinutes: 0,
  maxPartySize: 4,
  advanceDays: 14,
  minNoticeMinutes: 60,
  cancellationCutoffMinutes: 120,
  maxActiveBookingsPerResident: 2,
  maxActiveBookingsPerUnit: null as number | null,
  approvalRequired: false,
};

function resourceLabelsFor(input: AmenityCreateInput): string[] {
  if (input.resourceLabels && input.resourceLabels.length > 0) {
    return input.resourceLabels;
  }
  const count = input.resourceCount ?? 1;
  return count === 1
    ? ["Main"]
    : Array.from({ length: count }, (_, index) => `Space ${index + 1}`);
}

/**
 * Creates a draft amenity.
 *
 * Always a draft, whoever creates it: an admin setting up an HOA and a manager
 * adding a court both leave something the scoped manager finishes and
 * publishes. Nothing reaches residents until {@link setAmenityStatus} says so.
 */
export async function createAmenity(
  scope: AmenityScope,
  input: AmenityCreateInput,
): Promise<string> {
  const policy = { ...DEFAULT_POLICY, ...(input.policy ?? {}) };
  const labels = resourceLabelsFor(input);

  const duplicate = await db.amenity.findFirst({
    where: { communityId: scope.communityId, name: input.name },
    select: { id: true },
  });
  if (duplicate) {
    throw new HoaWorkflowError("An amenity with that name already exists.", 409);
  }

  const created = await db.$transaction(async (tx) => {
    const amenity = await tx.amenity.create({
      data: {
        communityId: scope.communityId,
        name: input.name,
        type: input.type,
        description: input.description,
        features: input.features,
        locationLabel: input.locationLabel,
        rules: input.rules,
        permittedUses: input.permittedUses,
        ageRestriction: input.ageRestriction,
        guestPolicy: input.guestPolicy,
        cancellationPolicy: input.cancellationPolicy,
        contactInstructions: input.contactInstructions,
        bookingRequired: input.bookingRequired,
        createdByUserId: scope.userId,
        ...policy,
        maxActiveBookingsPerUnit: policy.maxActiveBookingsPerUnit ?? null,
        // Resources exist even for a non-bookable amenity, so enabling
        // bookings later never has to backfill capacity.
        resources: {
          create: labels.map((label, index) => ({ label, position: index })),
        },
        ...(input.hours && input.hours.length > 0
          ? { hours: { create: input.hours } }
          : {}),
      },
      select: { id: true },
    });

    await tx.adminAuditLog.create({
      data: buildAuditEntry({
        actorUserId: scope.userId,
        action: "amenity_created",
        targetType: "amenity",
        targetId: amenity.id,
        communityId: scope.communityId,
        metadata: { via: scope.role, kind: input.type, status: "draft" },
      }),
    });

    return amenity;
  });

  return created.id;
}

/** Applies a partial configuration change. Never touches status or aggregates. */
export async function updateAmenity(
  scope: AmenityScope,
  amenityId: string,
  input: AmenityUpdateInput,
): Promise<void> {
  const existing = await db.amenity.findFirst({
    where: { id: amenityId, communityId: scope.communityId },
    select: { id: true, status: true, bookingRequired: true },
  });
  if (!existing) throw new HoaWorkflowError("That amenity is not available.", 404);

  const changedFields: string[] = [];
  const data: Record<string, unknown> = {};

  const assign = (key: string, value: unknown) => {
    if (value === undefined) return;
    data[key] = value;
    changedFields.push(key);
  };

  assign("name", input.name);
  assign("type", input.type);
  assign("description", input.description);
  assign("features", input.features);
  assign("locationLabel", input.locationLabel);
  assign("rules", input.rules);
  assign("permittedUses", input.permittedUses);
  assign("ageRestriction", input.ageRestriction);
  assign("guestPolicy", input.guestPolicy);
  assign("cancellationPolicy", input.cancellationPolicy);
  assign("contactInstructions", input.contactInstructions);
  assign("bookingRequired", input.bookingRequired);
  assign("operationalStatus", input.operationalStatus);
  assign("operationalNote", input.operationalNote);
  if (input.reopensAt !== undefined) {
    assign("reopensAt", input.reopensAt ? new Date(input.reopensAt) : null);
  }

  if (input.policy) {
    for (const [key, value] of Object.entries(input.policy)) {
      assign(key, value ?? (key === "maxActiveBookingsPerUnit" ? null : value));
    }
  }

  await db.$transaction(async (tx) => {
    if (Object.keys(data).length > 0) {
      await tx.amenity.update({ where: { id: amenityId }, data });
    }

    // Hours are replaced wholesale: a partial diff of a weekly grid is a lot
    // of machinery for a form that always submits the whole week.
    if (input.hours) {
      await tx.amenityHours.deleteMany({ where: { amenityId } });
      if (input.hours.length > 0) {
        await tx.amenityHours.createMany({
          data: input.hours.map((entry) => ({ amenityId, ...entry })),
        });
      }
      changedFields.push("hours");
    }

    if (input.resourceLabels || input.resourceCount) {
      await syncResources(tx, amenityId, resourceLabelsFor(input as AmenityCreateInput));
      changedFields.push("resources");
    }

    await tx.adminAuditLog.create({
      data: buildAuditEntry({
        actorUserId: scope.userId,
        action: "amenity_updated",
        targetType: "amenity",
        targetId: amenityId,
        communityId: scope.communityId,
        metadata: { via: scope.role, changedFields },
      }),
    });
  });
}

/**
 * Reconciles bookable spaces without orphaning history.
 *
 * A resource with bookings is deactivated rather than deleted, so past
 * reservations keep their `Court 2` label and the exclusion constraint keeps
 * protecting the ones still in the future.
 */
async function syncResources(
  tx: Prisma.TransactionClient,
  amenityId: string,
  labels: readonly string[],
): Promise<void> {
  const existing = await tx.amenityResource.findMany({
    where: { amenityId },
    select: { id: true, label: true },
  });
  const existingByLabel = new Map(existing.map((row) => [row.label, row]));

  for (const [index, label] of labels.entries()) {
    const match = existingByLabel.get(label);
    if (match) {
      await tx.amenityResource.updateMany({
        where: { id: match.id },
        data: { active: true, position: index },
      });
    } else {
      await tx.amenityResource.create({
        data: { amenityId, label, position: index },
      });
    }
  }

  const keep = new Set(labels);
  for (const row of existing) {
    if (keep.has(row.label)) continue;
    await tx.amenityResource.updateMany({
      where: { id: row.id },
      data: { active: false },
    });
  }
}

/**
 * Moves an amenity between draft, published, and archived.
 *
 * Publication is gated on the configuration actually being usable, which is
 * what stops a half-finished onboarding draft from reaching residents.
 */
export async function setAmenityStatus(
  scope: AmenityScope,
  amenityId: string,
  status: "draft" | "published" | "archived",
): Promise<void> {
  const row = (await db.amenity.findFirst({
    where: { id: amenityId, communityId: scope.communityId },
    select: AMENITY_SELECT,
  })) as unknown as AmenityRow | null;
  if (!row) throw new HoaWorkflowError("That amenity is not available.", 404);

  if (status === "published") {
    const problems = validateForPublication(row);
    if (problems.length > 0) {
      throw new HoaWorkflowError(
        `This amenity is not ready to publish: ${problems.join(" ")}`,
        422,
      );
    }
  }

  await db.$transaction(async (tx) => {
    await tx.amenity.update({
      where: { id: amenityId },
      data: {
        status,
        archivedAt: status === "archived" ? new Date() : null,
      },
    });
    await tx.adminAuditLog.create({
      data: buildAuditEntry({
        actorUserId: scope.userId,
        action: status === "archived" ? "amenity_archived" : "amenity_published",
        targetType: "amenity",
        targetId: amenityId,
        communityId: scope.communityId,
        metadata: { via: scope.role, previousStatus: row.status, nextStatus: status },
      }),
    });
  });
}

/** Readiness checks surfaced in the manager UI as well as enforced here. */
export function validateForPublication(row: {
  bookingRequired: boolean;
  hours: Array<{ weekday: WeekdayName; opensMinute: number; closesMinute: number }>;
  resources: Array<{ id: string }>;
  slotMinutes: number;
  minDurationMinutes: number;
  maxDurationMinutes: number;
  description: string | null;
}): string[] {
  const problems: string[] = [];
  if (row.hours.length === 0) problems.push("Add opening hours.");
  if (row.bookingRequired && row.resources.length === 0) {
    problems.push("Add at least one bookable space.");
  }
  if (row.bookingRequired && row.minDurationMinutes % row.slotMinutes !== 0) {
    problems.push("The minimum duration must be a whole number of slots.");
  }
  if (row.bookingRequired && row.maxDurationMinutes < row.minDurationMinutes) {
    problems.push("The maximum duration is shorter than the minimum.");
  }
  if (!row.description) problems.push("Add a short description.");
  return problems;
}

/** Reorders the gallery and, implicitly, chooses the first photo as cover. */
export async function reorderGallery(
  scope: AmenityScope,
  amenityId: string,
  mediaIds: readonly string[],
): Promise<void> {
  const assets = await db.mediaAsset.findMany({
    where: { amenityId, status: "active", communityId: scope.communityId },
    select: { id: true },
  });
  const known = new Set(assets.map((asset) => asset.id));
  if (mediaIds.some((id) => !known.has(id))) {
    throw new HoaWorkflowError("That photo is not in this amenity's gallery.", 422);
  }

  await db.$transaction(
    mediaIds.map((id, index) =>
      db.mediaAsset.update({ where: { id }, data: { position: index } }),
    ),
  );
}

export async function setCoverPhoto(
  scope: AmenityScope,
  amenityId: string,
  mediaId: string,
): Promise<void> {
  const asset = await db.mediaAsset.findFirst({
    where: { id: mediaId, amenityId, status: "active", communityId: scope.communityId },
    select: { id: true },
  });
  if (!asset) {
    throw new HoaWorkflowError("That photo is not in this amenity's gallery.", 422);
  }
  await db.amenity.update({ where: { id: amenityId }, data: { coverMediaId: mediaId } });
}

/* ── Closures ────────────────────────────────────────────────────────────── */

export async function createClosure(
  scope: AmenityScope,
  amenityId: string,
  input: AmenityClosureInput,
): Promise<string> {
  const amenity = await db.amenity.findFirst({
    where: { id: amenityId, communityId: scope.communityId },
    select: { id: true },
  });
  if (!amenity) throw new HoaWorkflowError("That amenity is not available.", 404);

  const closure = await db.$transaction(async (tx) => {
    const row = await tx.amenityClosure.create({
      data: {
        amenityId,
        kind: input.kind,
        startsAt: input.startsAt ? new Date(input.startsAt) : null,
        endsAt: input.endsAt ? new Date(input.endsAt) : null,
        recurringWeekday: input.recurringWeekday ?? null,
        recurringStartMinute: input.recurringStartMinute ?? null,
        recurringEndMinute: input.recurringEndMinute ?? null,
        residentVisible: input.residentVisible ?? true,
        reason: input.reason,
        createdByUserId: scope.userId,
      },
      select: { id: true },
    });

    await tx.adminAuditLog.create({
      data: buildAuditEntry({
        actorUserId: scope.userId,
        action: "amenity_closure_changed",
        targetType: "amenity",
        targetId: amenityId,
        communityId: scope.communityId,
        metadata: { via: scope.role, kind: input.kind, status: "created" },
      }),
    });

    return row;
  });

  return closure.id;
}

export async function deleteClosure(
  scope: AmenityScope,
  amenityId: string,
  closureId: string,
): Promise<void> {
  const removed = await db.amenityClosure.deleteMany({
    where: { id: closureId, amenityId, amenity: { communityId: scope.communityId } },
  });
  if (removed.count === 0) {
    throw new HoaWorkflowError("That closure no longer exists.", 404);
  }
  await db.adminAuditLog.create({
    data: buildAuditEntry({
      actorUserId: scope.userId,
      action: "amenity_closure_changed",
      targetType: "amenity",
      targetId: amenityId,
      communityId: scope.communityId,
      metadata: { via: scope.role, status: "removed" },
    }),
  });
}

/* ── Manager workspace ───────────────────────────────────────────────────── */

/**
 * Everything the "Amenities & spaces" dashboard shows, in one round trip.
 *
 * Utilization is counted rather than stored: a derived average that can drift
 * is worse than one query, and the counts here are small and HOA-scoped.
 */
export async function getManagerAmenityWorkspace(
  scope: AmenityScope,
  now = new Date(),
): Promise<ManagerAmenityWorkspace> {
  if (!scope.canManage) {
    throw new HoaWorkflowError("You do not manage this HOA.", 403);
  }

  const rows = (await db.amenity.findMany({
    where: { communityId: scope.communityId },
    orderBy: [{ status: "asc" }, { name: "asc" }],
    select: AMENITY_SELECT,
  })) as unknown as AmenityRow[];

  const amenityIds = rows.map((row) => row.id);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86_400_000);

  const [gallery, upcoming, pending, issues, staff, bookingCounts, openIssueCounts] =
    await Promise.all([
      amenityIds.length === 0
        ? []
        : db.mediaAsset.findMany({
            where: { amenityId: { in: amenityIds }, status: "active" },
            orderBy: [{ position: "asc" }, { createdAt: "asc" }],
            select: { id: true, amenityId: true, width: true, height: true },
          }),
      listManagerBookings(scope, { from: now, limit: 100 }, now),
      listManagerBookings(scope, { status: "pending_approval", limit: 100 }, now),
      listHoaIssues(scope, {}),
      listHoaStaff(scope.communityId),
      amenityIds.length === 0
        ? []
        : db.amenityBooking.groupBy({
            by: ["amenityId"],
            where: {
              communityId: scope.communityId,
              startsAt: { gte: thirtyDaysAgo },
              status: { in: ["confirmed", "completed"] },
            },
            _count: { _all: true },
          }),
      amenityIds.length === 0
        ? []
        : db.amenityIssue.groupBy({
            by: ["amenityId"],
            where: {
              communityId: scope.communityId,
              status: { notIn: ["resolved", "closed"] },
            },
            _count: { _all: true },
          }),
    ]);

  const galleryByAmenity = new Map<
    string,
    Array<{ id: string; width: number | null; height: number | null }>
  >();
  for (const asset of gallery) {
    if (!asset.amenityId) continue;
    const list = galleryByAmenity.get(asset.amenityId) ?? [];
    list.push({ id: asset.id, width: asset.width, height: asset.height });
    galleryByAmenity.set(asset.amenityId, list);
  }

  const bookingsByAmenity = new Map(
    bookingCounts.map((bucket) => [bucket.amenityId, bucket._count._all]),
  );
  const issuesByAmenity = new Map(
    openIssueCounts.map((bucket) => [bucket.amenityId, bucket._count._all]),
  );

  const amenities = await Promise.all(
    rows.map((row) =>
      cardView(row, scope, now, [], galleryByAmenity.get(row.id) ?? []),
    ),
  );

  return {
    communityId: scope.communityId,
    communityName: scope.communityName,
    timezone: scope.timezone,
    amenities,
    upcomingBookings: upcoming,
    pendingApprovals: pending,
    openIssues: issues.filter(
      (issue) => issue.status !== "resolved" && issue.status !== "closed",
    ),
    staff,
    utilization: rows.map((row) => ({
      amenityId: row.id,
      amenityName: row.name,
      bookingsLast30Days: bookingsByAmenity.get(row.id) ?? 0,
      openIssues: issuesByAmenity.get(row.id) ?? 0,
      averageRating: averageRating(row),
    })),
  };
}
