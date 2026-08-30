import "server-only";

import { randomBytes, randomUUID } from "node:crypto";

import type { Prisma } from "@/generated/prisma/client";

import type { BookingView, ManagerBookingView } from "@/lib/amenity-types";
import { BOOKING_STATUS_LABELS } from "@/lib/amenity-types";
import type { AmenityScope } from "@/lib/server/amenity-auth";
import { listHoaManagerRecipients } from "@/lib/server/amenity-auth";
import { evaluateBookingRange } from "@/lib/server/amenity-availability";
import { loadAvailabilitySnapshot } from "@/lib/server/amenity-snapshot";
import {
  REMINDER_LEAD_MINUTES,
  REMINDER_OUTBOX_KIND,
  reminderDedupeKey,
} from "@/lib/server/amenity-reminders";
import { buildAuditEntry } from "@/lib/server/audit";
import { db } from "@/lib/server/db";
import { HoaWorkflowError } from "@/lib/server/hoa";
import {
  buildPreferenceAwareNotificationOps,
  scheduleOutboxDrain,
  type NotificationIntent,
} from "@/lib/server/notifications";
import { formatZonedDateTime } from "@/lib/server/timezone";
import type {
  BookingCreateInput,
  BookingRescheduleInput,
  ManagerBookingDecisionInput,
} from "@/lib/validation/amenities";

/**
 * The amenity booking lifecycle.
 *
 * ── How overbooking is actually prevented ────────────────────────────────
 *
 * Not by counting. {@link createBooking} asks the availability engine for a
 * free resource and then inserts a row; between those two steps another
 * request can do exactly the same thing. What settles it is the database:
 * `AmenityBooking_no_overlap` is a GiST exclusion constraint over
 * (resourceId, block range) restricted to the capacity-holding statuses, so
 * one of the two inserts fails with SQLSTATE 23P01 and the other commits.
 *
 * The retry below then re-evaluates: if the amenity has four courts and two
 * residents raced for court 1, the loser is quietly given court 2. Only when
 * every resource is genuinely taken does the caller see "that time was just
 * taken". A check-then-insert with no constraint would have sold both.
 *
 * ── Reminders ────────────────────────────────────────────────────────────
 *
 * The 30-minute reminder is an `OutboxEvent` whose `nextAttemptAt` is the due
 * time. No timer, no browser, no daily cron. Cancelling or moving a booking
 * deletes the pending row and, where appropriate, writes a new one, so a
 * cancelled reservation cannot produce a stale reminder. The worker re-reads
 * the booking before sending, which closes the remaining gap.
 */

export { REMINDER_LEAD_MINUTES, REMINDER_OUTBOX_KIND, reminderDedupeKey };

/** Statuses that hold capacity, matching the exclusion constraint's WHERE. */
const LIVE_STATUSES = ["pending_approval", "confirmed"] as const;

/** Crockford-style alphabet: no I, L, O, or U to misread over the phone. */
const REFERENCE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function newReference(): string {
  const bytes = randomBytes(6);
  let out = "";
  for (const byte of bytes) out += REFERENCE_ALPHABET[byte % REFERENCE_ALPHABET.length];
  return `BK-${out}`;
}

/**
 * True for the exclusion-constraint violation that means "someone got there
 * first". Prisma surfaces it as a raw PostgreSQL error rather than one of its
 * own `P2002` unique-constraint codes, so both shapes are checked.
 */
export function isOverlapViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as { code?: unknown; meta?: unknown; message?: unknown };
  if (candidate.code === "23P01") return true;
  const metaCode = (candidate.meta as { code?: unknown } | undefined)?.code;
  if (metaCode === "23P01") return true;
  return (
    typeof candidate.message === "string" &&
    (candidate.message.includes("23P01") ||
      candidate.message.includes("AmenityBooking_no_overlap"))
  );
}

export type BookingRow = {
  id: string;
  reference: string;
  amenityId: string;
  status: BookingView["status"];
  startsAt: Date;
  endsAt: Date;
  partySize: number;
  timezone: string;
  residentNote: string | null;
  cancellationReason: string | null;
  createdAt: Date;
  amenity: { id: string; name: string; cancellationCutoffMinutes: number };
  resource: { label: string };
};

/**
 * The resident's view of their own booking.
 *
 * `canCancel` is computed here rather than in the browser so a client with a
 * stale clock cannot render a button the server will refuse.
 */
export function serializeBooking(row: BookingRow, now = new Date()): BookingView {
  const cutoffMs = row.amenity.cancellationCutoffMinutes * 60_000;
  const isLive = row.status === "confirmed" || row.status === "pending_approval";
  const beforeCutoff = row.startsAt.getTime() - cutoffMs > now.getTime();

  return {
    id: row.id,
    reference: row.reference,
    amenityId: row.amenityId,
    amenityName: row.amenity.name,
    status: row.status,
    statusLabel: BOOKING_STATUS_LABELS[row.status],
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    whenLabel: formatZonedDateTime(row.startsAt, row.timezone),
    timezone: row.timezone,
    partySize: row.partySize,
    resourceLabel: row.resource.label,
    note: row.residentNote,
    cancellationReason: row.cancellationReason,
    canCancel: isLive && beforeCutoff,
    canReschedule: isLive && beforeCutoff,
    canReview: row.status === "completed",
    createdAt: row.createdAt.toISOString(),
  };
}

export function serializeManagerBooking(
  row: BookingRow & {
    isManagerBlock: boolean;
    approvalRequired: boolean;
    user: { fullName: string; email: string };
    unit: { label: string } | null;
  },
  now = new Date(),
): ManagerBookingView {
  return {
    ...serializeBooking(row, now),
    residentName: row.user.fullName,
    residentEmail: row.user.email,
    unitLabel: row.unit?.label ?? null,
    isManagerBlock: row.isManagerBlock,
    approvalRequired: row.approvalRequired,
  };
}

const BOOKING_INCLUDE = {
  amenity: { select: { id: true, name: true, cancellationCutoffMinutes: true } },
  resource: { select: { label: true } },
} as const;

/* ── Reminder scheduling ─────────────────────────────────────────────────── */

/** Any operation that can go in a `db.$transaction([...])` batch. */
type BatchOp = Prisma.PrismaPromise<unknown>;

/**
 * Queues the 30-minute reminder, or nothing when it would already be late.
 *
 * A booking made 10 minutes before it starts gets a due time of "now", which
 * the next worker pass delivers immediately — the sensible behaviour, rather
 * than either skipping it or sending it into the past.
 */
export function buildReminderOps(
  booking: { id: string; startsAt: Date },
  now: Date,
): BatchOp[] {
  const dueAt = new Date(booking.startsAt.getTime() - REMINDER_LEAD_MINUTES * 60_000);
  if (booking.startsAt.getTime() <= now.getTime()) return [];

  return [
    db.outboxEvent.createMany({
      data: [
        {
          kind: REMINDER_OUTBOX_KIND,
          dedupeKey: reminderDedupeKey(booking.id, booking.startsAt),
          // Ids only. The worker re-reads everything else, so no address,
          // access note, or resident note ever sits in the queue.
          payload: {
            bookingId: booking.id,
            startsAt: booking.startsAt.toISOString(),
          },
          nextAttemptAt: dueAt.getTime() > now.getTime() ? dueAt : now,
          updatedAt: new Date(),
        },
      ],
      skipDuplicates: true,
    }),
  ];
}

/** Drops any not-yet-delivered reminder for a booking. Safe to run repeatedly. */
export function buildReminderCancelOps(bookingId: string): BatchOp[] {
  return [
    db.outboxEvent.deleteMany({
      where: {
        kind: REMINDER_OUTBOX_KIND,
        status: "pending",
        dedupeKey: { startsWith: `amenity-reminder:${bookingId}:` },
      },
    }),
  ];
}

/* ── Creation ────────────────────────────────────────────────────────────── */

type AmenityForBooking = {
  id: string;
  communityId: string;
  name: string;
  status: string;
  bookingRequired: boolean;
  approvalRequired: boolean;
  maxPartySize: number;
  minDurationMinutes: number;
  slotMinutes: number;
  bufferMinutes: number;
  maxActiveBookingsPerResident: number;
  maxActiveBookingsPerUnit: number | null;
  cancellationCutoffMinutes: number;
  advanceDays: number;
  maxDurationMinutes: number;
  minNoticeMinutes: number;
};

async function loadAmenityForBooking(
  amenityId: string,
  communityId: string,
): Promise<AmenityForBooking> {
  const amenity = await db.amenity.findFirst({
    where: { id: amenityId, communityId },
    select: {
      id: true,
      communityId: true,
      name: true,
      status: true,
      bookingRequired: true,
      approvalRequired: true,
      maxPartySize: true,
      minDurationMinutes: true,
      maxDurationMinutes: true,
      slotMinutes: true,
      bufferMinutes: true,
      minNoticeMinutes: true,
      advanceDays: true,
      maxActiveBookingsPerResident: true,
      maxActiveBookingsPerUnit: true,
      cancellationCutoffMinutes: true,
    },
  });
  if (!amenity) throw new HoaWorkflowError("That amenity is not available.", 404);
  return amenity;
}

/** Enforces the per-resident and per-unit concurrent booking ceilings. */
async function assertWithinLimits(
  amenity: AmenityForBooking,
  scope: AmenityScope,
  now: Date,
  excludeBookingId: string | null,
): Promise<void> {
  const base = {
    amenityId: amenity.id,
    status: { in: [...LIVE_STATUSES] },
    endsAt: { gt: now },
    ...(excludeBookingId ? { id: { not: excludeBookingId } } : {}),
  };

  const mine = await db.amenityBooking.count({
    where: { ...base, userId: scope.userId },
  });
  if (mine >= amenity.maxActiveBookingsPerResident) {
    throw new HoaWorkflowError(
      `You can hold ${amenity.maxActiveBookingsPerResident} upcoming reservation${amenity.maxActiveBookingsPerResident === 1 ? "" : "s"} for this amenity at a time.`,
      409,
    );
  }

  if (amenity.maxActiveBookingsPerUnit !== null && scope.unitId) {
    const forUnit = await db.amenityBooking.count({
      where: { ...base, unitId: scope.unitId },
    });
    if (forUnit >= amenity.maxActiveBookingsPerUnit) {
      throw new HoaWorkflowError(
        "Your home already holds the maximum number of upcoming reservations for this amenity.",
        409,
      );
    }
  }
}

export type CreateBookingResult = {
  bookingId: string;
  reference: string;
  status: BookingView["status"];
  /** True when an identical live booking already existed. */
  idempotent: boolean;
};

/**
 * Creates one reservation.
 *
 * Idempotent by natural key: a resident who double-clicks, or whose request is
 * retried by a flaky connection, gets the booking they already hold rather
 * than a second one. The key is (resident, amenity, start instant), which is
 * exactly what "the same intent" means here — no client-supplied token needed.
 */
export async function createBooking(
  scope: AmenityScope,
  amenityId: string,
  input: BookingCreateInput,
  now = new Date(),
): Promise<CreateBookingResult> {
  if (!scope.membershipId) {
    throw new HoaWorkflowError("Only active residents of this HOA can book.", 403);
  }

  const amenity = await loadAmenityForBooking(amenityId, scope.communityId);
  if (!amenity.bookingRequired) {
    throw new HoaWorkflowError("This amenity does not take reservations.", 422);
  }
  if (amenity.status !== "published") {
    throw new HoaWorkflowError("This amenity is not open for reservations.", 422);
  }

  const startsAt = new Date(input.startsAt);
  if (Number.isNaN(startsAt.getTime())) {
    throw new HoaWorkflowError("That start time is not valid.", 422);
  }

  const existing = await db.amenityBooking.findFirst({
    where: {
      amenityId,
      userId: scope.userId,
      startsAt,
      status: { in: [...LIVE_STATUSES] },
    },
    select: { id: true, reference: true, status: true },
  });
  if (existing) {
    return {
      bookingId: existing.id,
      reference: existing.reference,
      status: existing.status,
      idempotent: true,
    };
  }

  const partySize = input.partySize ?? 1;
  if (partySize > amenity.maxPartySize) {
    throw new HoaWorkflowError(
      `This amenity takes up to ${amenity.maxPartySize} people per reservation.`,
      422,
    );
  }

  const duration = input.durationMinutes ?? amenity.minDurationMinutes;
  const endsAt = new Date(startsAt.getTime() + duration * 60_000);

  await assertWithinLimits(amenity, scope, now, null);

  const status = amenity.approvalRequired ? "pending_approval" : "confirmed";

  // Two attempts: the first uses the resource the engine picked, the second
  // re-evaluates after a lost race so a free alternative is still used.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const snapshot = await loadAvailabilitySnapshot(amenityId, scope.timezone, {
      from: new Date(startsAt.getTime() - 86_400_000),
      to: new Date(endsAt.getTime() + 86_400_000),
    });
    if (!snapshot) throw new HoaWorkflowError("That amenity is not available.", 404);

    const evaluation = evaluateBookingRange(snapshot, startsAt, endsAt, { now });
    if (!evaluation.ok) {
      throw new HoaWorkflowError(evaluation.message, 409);
    }

    // The id and reference are generated here rather than by the database so
    // every row in the batch below — the booking, its first event, its
    // notifications, and its reminder — can reference the same booking inside
    // one atomic `$transaction([...])`. Building the ops as an array (all from
    // the same client) is what makes them atomic; an interactive transaction
    // whose helpers were built from `db` would silently run outside it.
    const bookingId = randomUUID();
    const reference = newReference();
    const bookingForNotice = {
      id: bookingId,
      reference,
      amenityId,
      userId: scope.userId,
      startsAt,
      timezone: scope.timezone,
      amenity: { name: amenity.name },
    };

    try {
      await db.$transaction([
        db.amenityBooking.create({
          data: {
            id: bookingId,
            communityId: scope.communityId,
            amenityId,
            resourceId: evaluation.resourceId,
            userId: scope.userId,
            unitId: scope.unitId,
            reference,
            startsAt,
            endsAt,
            blockStartsAt: evaluation.blockStartsAt,
            blockEndsAt: evaluation.blockEndsAt,
            partySize,
            status,
            timezone: scope.timezone,
            // Frozen rules: a later policy edit must not rewrite what this
            // resident agreed to.
            policySnapshot: {
              slotMinutes: amenity.slotMinutes,
              minDurationMinutes: amenity.minDurationMinutes,
              maxDurationMinutes: amenity.maxDurationMinutes,
              bufferMinutes: amenity.bufferMinutes,
              cancellationCutoffMinutes: amenity.cancellationCutoffMinutes,
              approvalRequired: amenity.approvalRequired,
              maxPartySize: amenity.maxPartySize,
            },
            residentNote: input.note,
            approvalRequired: amenity.approvalRequired,
          },
        }),
        db.amenityBookingEvent.create({
          data: {
            bookingId,
            type: status === "confirmed" ? "confirmed" : "requested",
            actorUserId: scope.userId,
          },
        }),
        ...(await buildBookingNotificationOps(
          bookingForNotice,
          scope,
          status === "confirmed" ? "confirmed" : "requested",
        )),
        ...(status === "confirmed"
          ? buildReminderOps({ id: bookingId, startsAt }, now)
          : []),
      ]);

      scheduleOutboxDrain();
      return { bookingId, reference, status, idempotent: false };
    } catch (error) {
      if (!isOverlapViolation(error) || attempt === 1) {
        if (isOverlapViolation(error)) {
          throw new HoaWorkflowError("That time was just taken. Pick another slot.", 409);
        }
        throw error;
      }
      // Lost the race. Loop once more; the snapshot reload will see the winner.
    }
  }

  throw new HoaWorkflowError("That time was just taken. Pick another slot.", 409);
}

/* ── Resident changes ────────────────────────────────────────────────────── */

async function loadOwnBooking(scope: AmenityScope, bookingId: string) {
  const booking = await db.amenityBooking.findFirst({
    where: { id: bookingId, communityId: scope.communityId, userId: scope.userId },
    include: BOOKING_INCLUDE,
  });
  if (!booking) throw new HoaWorkflowError("That reservation was not found.", 404);
  return booking;
}

export async function cancelBooking(
  scope: AmenityScope,
  bookingId: string,
  reason: string | null,
  now = new Date(),
): Promise<{ changed: boolean }> {
  const booking = await loadOwnBooking(scope, bookingId);

  // Already cancelled is success, not an error: a retried request must not
  // present the resident with a failure for something that already happened.
  if (!LIVE_STATUSES.includes(booking.status as (typeof LIVE_STATUSES)[number])) {
    return { changed: false };
  }

  const cutoff = booking.startsAt.getTime() - booking.amenity.cancellationCutoffMinutes * 60_000;
  if (now.getTime() > cutoff) {
    throw new HoaWorkflowError(
      `Reservations can be cancelled up to ${booking.amenity.cancellationCutoffMinutes} minutes before they start. Contact your HOA manager.`,
      409,
    );
  }

  const updated = await db.amenityBooking.updateMany({
    where: { id: bookingId, status: { in: [...LIVE_STATUSES] } },
    data: {
      status: "cancelled_by_resident",
      cancelledAt: now,
      cancelledByUserId: scope.userId,
      cancellationReason: reason,
    },
  });
  if (updated.count === 0) return { changed: false };

  await db.$transaction([
    db.amenityBookingEvent.create({
      data: {
        bookingId,
        type: "cancelled_by_resident",
        actorUserId: scope.userId,
      },
    }),
    ...buildReminderCancelOps(bookingId),
    ...(await buildBookingNotificationOps(booking, scope, "cancelled_by_resident")),
  ]);

  scheduleOutboxDrain();
  return { changed: true };
}

/**
 * Moves a booking to a new time.
 *
 * Implemented as cancel-and-recreate inside one transaction rather than an
 * in-place update: the new slot has to pass every rule again, and the old
 * reminder has to die with the old start time.
 */
export async function rescheduleBooking(
  scope: AmenityScope,
  bookingId: string,
  input: BookingRescheduleInput,
  now = new Date(),
): Promise<{ bookingId: string; reference: string }> {
  const booking = await loadOwnBooking(scope, bookingId);
  if (!LIVE_STATUSES.includes(booking.status as (typeof LIVE_STATUSES)[number])) {
    throw new HoaWorkflowError("That reservation is no longer active.", 409);
  }

  const cutoff = booking.startsAt.getTime() - booking.amenity.cancellationCutoffMinutes * 60_000;
  if (now.getTime() > cutoff) {
    throw new HoaWorkflowError(
      "It is too late to change this reservation. Contact your HOA manager.",
      409,
    );
  }

  const amenity = await loadAmenityForBooking(booking.amenityId, scope.communityId);
  const startsAt = new Date(input.startsAt);
  const duration =
    input.durationMinutes ??
    Math.round((booking.endsAt.getTime() - booking.startsAt.getTime()) / 60_000);
  const endsAt = new Date(startsAt.getTime() + duration * 60_000);

  const snapshot = await loadAvailabilitySnapshot(booking.amenityId, scope.timezone, {
    from: new Date(startsAt.getTime() - 86_400_000),
    to: new Date(endsAt.getTime() + 86_400_000),
  });
  if (!snapshot) throw new HoaWorkflowError("That amenity is not available.", 404);

  const evaluation = evaluateBookingRange(snapshot, startsAt, endsAt, {
    now,
    excludeBookingId: bookingId,
  });
  if (!evaluation.ok) throw new HoaWorkflowError(evaluation.message, 409);

  try {
    await db.$transaction(async (tx) => {
      await tx.amenityBooking.update({
        where: { id: bookingId },
        data: {
          startsAt,
          endsAt,
          resourceId: evaluation.resourceId,
          blockStartsAt: evaluation.blockStartsAt,
          blockEndsAt: evaluation.blockEndsAt,
        },
      });
      await tx.amenityBookingEvent.create({
        data: { bookingId, type: "rescheduled", actorUserId: scope.userId },
      });
    });
  } catch (error) {
    if (isOverlapViolation(error)) {
      throw new HoaWorkflowError("That time was just taken. Pick another slot.", 409);
    }
    throw error;
  }

  const refreshed = await db.amenityBooking.findUniqueOrThrow({
    where: { id: bookingId },
    include: BOOKING_INCLUDE,
  });

  await db.$transaction([
    // The old due time is gone; a new one is queued for the new start.
    ...buildReminderCancelOps(bookingId),
    ...(refreshed.status === "confirmed" ? buildReminderOps(refreshed, now) : []),
    ...(await buildBookingNotificationOps(refreshed, scope, "rescheduled")),
  ]);

  scheduleOutboxDrain();
  return { bookingId, reference: refreshed.reference };
}

/* ── Manager actions ─────────────────────────────────────────────────────── */

const DECISION_STATUS: Record<
  ManagerBookingDecisionInput["decision"],
  BookingView["status"]
> = {
  approve: "confirmed",
  decline: "declined",
  cancel: "cancelled_by_manager",
  complete: "completed",
  no_show: "no_show",
};

/**
 * Approve, decline, cancel, complete, or mark a no-show.
 *
 * Each transition is a conditional `updateMany` on the statuses it is legal
 * from, so two managers clicking at once change one row between them and the
 * second is told nothing changed rather than double-notifying the resident.
 */
export async function decideBooking(
  scope: AmenityScope,
  bookingId: string,
  input: ManagerBookingDecisionInput,
  now = new Date(),
): Promise<{ changed: boolean; status: BookingView["status"] }> {
  const booking = await db.amenityBooking.findFirst({
    where: { id: bookingId, communityId: scope.communityId },
    include: BOOKING_INCLUDE,
  });
  if (!booking) throw new HoaWorkflowError("That reservation was not found.", 404);

  const nextStatus = DECISION_STATUS[input.decision];
  const legalFrom: Record<ManagerBookingDecisionInput["decision"], string[]> = {
    approve: ["pending_approval"],
    decline: ["pending_approval"],
    cancel: ["pending_approval", "confirmed"],
    complete: ["confirmed"],
    no_show: ["confirmed"],
  };

  const updated = await db.amenityBooking.updateMany({
    where: { id: bookingId, status: { in: legalFrom[input.decision] as never } },
    data: {
      status: nextStatus,
      ...(input.decision === "approve"
        ? { approvedAt: now, approvedByUserId: scope.userId }
        : {}),
      ...(input.decision === "decline" || input.decision === "cancel"
        ? {
            cancelledAt: now,
            cancelledByUserId: scope.userId,
            cancellationReason: input.reason,
          }
        : {}),
      ...(input.decision === "complete" ? { completedAt: now } : {}),
    },
  });

  if (updated.count === 0) {
    return { changed: false, status: booking.status };
  }

  const refreshed = await db.amenityBooking.findUniqueOrThrow({
    where: { id: bookingId },
    include: BOOKING_INCLUDE,
  });

  await db.$transaction([
    db.amenityBookingEvent.create({
      data: {
        bookingId,
        type:
          input.decision === "approve"
            ? "approved"
            : input.decision === "decline"
              ? "declined"
              : input.decision === "cancel"
                ? "cancelled_by_manager"
                : input.decision === "complete"
                  ? "completed"
                  : "no_show",
        actorUserId: scope.userId,
      },
    }),
    // Approval starts the reminder clock; every other outcome stops it.
    ...(input.decision === "approve"
      ? buildReminderOps(refreshed, now)
      : buildReminderCancelOps(bookingId)),
    ...(await buildBookingNotificationOps(
      refreshed,
      scope,
      input.decision === "approve"
        ? "approved"
        : input.decision === "decline"
          ? "declined"
          : input.decision === "cancel"
            ? "cancelled_by_manager"
            : "completed",
      input.reason,
    )),
    db.adminAuditLog.create({
      data: buildAuditEntry({
        actorUserId: scope.userId,
        action: "amenity_booking_status_changed",
        targetType: "amenity_booking",
        targetId: bookingId,
        communityId: scope.communityId,
        metadata: {
          via: scope.role,
          previousStatus: booking.status,
          nextStatus,
        },
      }),
    }),
  ]);

  scheduleOutboxDrain();
  return { changed: true, status: nextStatus };
}

/**
 * Cancels every live booking overlapping a manager-created closure and tells
 * the affected residents why.
 *
 * Called when an amenity is put into maintenance or a blackout is added. The
 * cancellation message is operational, so it is delivered regardless of an
 * ordinary marketing opt-out — a resident must not turn up to a locked gate.
 */
export async function cancelBookingsForClosure(
  scope: AmenityScope,
  amenityId: string,
  window: { start: Date; end: Date },
  reason: string,
  now = new Date(),
): Promise<number> {
  const affected = await db.amenityBooking.findMany({
    where: {
      amenityId,
      communityId: scope.communityId,
      status: { in: [...LIVE_STATUSES] },
      endsAt: { gt: window.start },
      startsAt: { lt: window.end },
    },
    include: BOOKING_INCLUDE,
  });
  if (affected.length === 0) return 0;

  const ids = affected.map((booking) => booking.id);

  await db.$transaction([
    db.amenityBooking.updateMany({
      where: { id: { in: ids }, status: { in: [...LIVE_STATUSES] } },
      data: {
        status: "cancelled_by_manager",
        cancelledAt: now,
        cancelledByUserId: scope.userId,
        cancellationReason: reason,
      },
    }),
    db.amenityBookingEvent.createMany({
      data: ids.map((bookingId) => ({
        bookingId,
        type: "cancelled_by_manager" as const,
        actorUserId: scope.userId,
        note: reason.slice(0, 200),
      })),
    }),
    db.outboxEvent.deleteMany({
      where: {
        kind: REMINDER_OUTBOX_KIND,
        status: "pending",
        OR: ids.map((id) => ({ dedupeKey: { startsWith: `amenity-reminder:${id}:` } })),
      },
    }),
  ]);

  const intents: NotificationIntent[] = [];
  const residents = await db.user.findMany({
    where: { id: { in: [...new Set(affected.map((b) => b.userId))] } },
    select: { id: true, email: true },
  });
  const emailById = new Map(residents.map((row) => [row.id, row.email]));

  for (const booking of affected) {
    intents.push({
      userId: booking.userId,
      email: emailById.get(booking.userId) ?? null,
      // Operational: a closure that cancels a reservation is not marketing.
      emailPolicy: "required",
      kind: "booking",
      title: `${booking.amenity.name} reservation cancelled`,
      body: `Your ${formatZonedDateTime(booking.startsAt, booking.timezone)} reservation (${booking.reference}) was cancelled. ${reason}`,
      linkPath: `/app/homeowner/amenities/${booking.amenityId}`,
      dedupeKey: `amenity-closure-cancel:${booking.id}`,
    });
  }

  const ops = await buildPreferenceAwareNotificationOps(intents);
  if (ops.length > 0) await db.$transaction(ops);
  scheduleOutboxDrain();

  return affected.length;
}

/* ── Notifications ───────────────────────────────────────────────────────── */

type BookingEventName =
  | "requested"
  | "confirmed"
  | "approved"
  | "declined"
  | "cancelled_by_resident"
  | "cancelled_by_manager"
  | "rescheduled"
  | "completed";

/**
 * Builds the notification rows for one booking transition.
 *
 * Residents hear about their own booking; managers hear about the ones that
 * need them (a new request under an approval policy, and a resident
 * cancellation). Nobody hears about anybody else's reservation, and no payload
 * carries the resident's note.
 */
async function buildBookingNotificationOps(
  booking: {
    id: string;
    reference: string;
    amenityId: string;
    userId: string;
    startsAt: Date;
    timezone: string;
    amenity: { name: string };
  },
  scope: AmenityScope,
  event: BookingEventName,
  reason?: string | null,
): Promise<BatchOp[]> {
  const when = formatZonedDateTime(booking.startsAt, booking.timezone);
  const residentLink = `/app/homeowner/amenities/${booking.amenityId}`;
  const managerLink = `/app/hoa/amenities`;

  const resident = await db.user.findUnique({
    where: { id: booking.userId },
    select: { id: true, email: true, fullName: true },
  });
  if (!resident) return [];

  const intents: NotificationIntent[] = [];

  const residentCopy: Partial<Record<BookingEventName, { title: string; body: string }>> = {
    requested: {
      title: `Reservation requested — ${booking.amenity.name}`,
      body: `We've asked your HOA manager to approve ${when}. Reference ${booking.reference}.`,
    },
    confirmed: {
      title: `Reservation confirmed — ${booking.amenity.name}`,
      body: `You're booked for ${when}. Reference ${booking.reference}.`,
    },
    approved: {
      title: `Reservation approved — ${booking.amenity.name}`,
      body: `Your manager approved ${when}. Reference ${booking.reference}.`,
    },
    declined: {
      title: `Reservation declined — ${booking.amenity.name}`,
      body: `Your ${when} request was declined.${reason ? ` ${reason}` : ""}`,
    },
    cancelled_by_resident: {
      title: `Reservation cancelled — ${booking.amenity.name}`,
      body: `Your ${when} reservation is cancelled.`,
    },
    cancelled_by_manager: {
      title: `Reservation cancelled — ${booking.amenity.name}`,
      body: `Your ${when} reservation was cancelled by the HOA.${reason ? ` ${reason}` : ""}`,
    },
    rescheduled: {
      title: `Reservation moved — ${booking.amenity.name}`,
      body: `Your reservation is now ${when}. Reference ${booking.reference}.`,
    },
    completed: {
      title: `How was ${booking.amenity.name}?`,
      body: "Your reservation is complete. Leave a review to help your neighbours.",
    },
  };

  const copy = residentCopy[event];
  if (copy) {
    intents.push({
      userId: resident.id,
      email: resident.email,
      // A manager cancelling on the resident's behalf is operational mail.
      emailPolicy: event === "cancelled_by_manager" ? "required" : "respect_preference",
      kind: event === "completed" ? "review" : "booking",
      title: copy.title,
      body: copy.body,
      linkPath: residentLink,
      dedupeKey: `amenity-booking:${booking.id}:${event}`,
    });
  }

  // Managers are told only what needs a decision or affects the calendar.
  if (event === "requested" || event === "cancelled_by_resident") {
    const managers = await listHoaManagerRecipients(scope.communityId);
    for (const manager of managers) {
      if (manager.id === booking.userId) continue;
      intents.push({
        userId: manager.id,
        email: manager.email,
        kind: "booking",
        title:
          event === "requested"
            ? `Approval needed — ${booking.amenity.name}`
            : `Reservation cancelled — ${booking.amenity.name}`,
        body:
          event === "requested"
            ? `${resident.fullName} requested ${when}.`
            : `${resident.fullName} cancelled their ${when} reservation.`,
        linkPath: managerLink,
        dedupeKey: `amenity-booking-manager:${booking.id}:${event}:${manager.id}`,
      });
    }
  }

  return buildPreferenceAwareNotificationOps(intents);
}

/* ── Manager reads ───────────────────────────────────────────────────────── */

export async function listManagerBookings(
  scope: AmenityScope,
  options: {
    amenityId?: string;
    status?: BookingView["status"];
    from?: Date;
    to?: Date;
    limit?: number;
  } = {},
  now = new Date(),
): Promise<ManagerBookingView[]> {
  const rows = await db.amenityBooking.findMany({
    where: {
      communityId: scope.communityId,
      ...(options.amenityId ? { amenityId: options.amenityId } : {}),
      ...(options.status ? { status: options.status } : {}),
      ...(options.from || options.to
        ? {
            startsAt: {
              ...(options.from ? { gte: options.from } : {}),
              ...(options.to ? { lte: options.to } : {}),
            },
          }
        : {}),
    },
    orderBy: { startsAt: "asc" },
    take: Math.min(options.limit ?? 100, 300),
    include: {
      ...BOOKING_INCLUDE,
      user: { select: { fullName: true, email: true } },
      unit: { select: { label: true } },
    },
  });

  return rows.map((row) => serializeManagerBooking(row, now));
}
