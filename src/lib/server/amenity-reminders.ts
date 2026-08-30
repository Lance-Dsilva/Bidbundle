import "server-only";

import { randomUUID } from "node:crypto";

import { db } from "@/lib/server/db";
import { formatZonedDateTime } from "@/lib/server/timezone";

/**
 * Delivery of the 30-minute booking reminder.
 *
 * ── Why this is an outbox row and not a timer ────────────────────────────
 *
 * `setTimeout` dies with the process. A service worker dies with the tab. The
 * once-daily recovery cron cannot hit a 30-minute window. The only durable
 * thing in this system that already understands "do this later, exactly once,
 * with retries" is `OutboxEvent` — so a reminder is one of those, with
 * `nextAttemptAt` set to `startsAt - 30 minutes`. A worker running every one to
 * five minutes drains it, and the existing claim-based `updateMany` makes two
 * overlapping workers safe without any new locking.
 *
 * ── Why the worker re-reads the booking ──────────────────────────────────
 *
 * Cancelling or rescheduling deletes the pending row, which handles the normal
 * case. But a delete that races the worker's claim would still deliver, so the
 * canonical booking is re-read here and checked against the start time the row
 * was queued for. A cancelled or moved booking resolves the event without
 * sending anything — a stale reminder is worse than a missing one.
 *
 * This module deliberately imports nothing from `notifications.ts`: that module
 * calls into this one from its drain loop, and the dependency has to run one
 * way.
 */

export const REMINDER_OUTBOX_KIND = "amenity_booking_reminder";
export const REMINDER_LEAD_MINUTES = 30;

/** The stable identity of "the reminder for this booking at this start time". */
export function reminderDedupeKey(bookingId: string, startsAt: Date): string {
  return `amenity-reminder:${bookingId}:${startsAt.toISOString()}`;
}

export type ReminderOutcome =
  /** An in-app row was written and, where allowed, an email is due. */
  | { kind: "sent"; email: { to: string; subject: string; text: string } | null }
  /** The booking moved, was cancelled, or already started. Nothing to send. */
  | { kind: "skipped"; reason: "not_confirmed" | "rescheduled" | "already_started" | "missing" };

type ReminderPayload = { bookingId?: unknown; startsAt?: unknown };

/**
 * Resolves one due reminder.
 *
 * Returns the email to send rather than sending it, so the caller can reuse
 * the drain loop's provider and its idempotency key, and so this function can
 * be tested with a controllable clock and no mail provider at all.
 */
export async function resolveBookingReminder(
  payload: unknown,
  appUrl: (path: string) => string,
  now = new Date(),
): Promise<ReminderOutcome> {
  const parsed = (payload ?? {}) as ReminderPayload;
  const bookingId = typeof parsed.bookingId === "string" ? parsed.bookingId : null;
  const queuedStartsAt =
    typeof parsed.startsAt === "string" ? parsed.startsAt : null;
  if (!bookingId || !queuedStartsAt) return { kind: "skipped", reason: "missing" };

  const booking = await db.amenityBooking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      reference: true,
      status: true,
      startsAt: true,
      timezone: true,
      amenityId: true,
      isManagerBlock: true,
      amenity: { select: { name: true, locationLabel: true } },
      user: {
        select: {
          id: true,
          email: true,
          homeownerProfile: { select: { notifyEmail: true } },
        },
      },
    },
  });

  if (!booking) return { kind: "skipped", reason: "missing" };
  // A manager's maintenance block is not a reservation and gets no reminder.
  if (booking.isManagerBlock) return { kind: "skipped", reason: "not_confirmed" };
  if (booking.status !== "confirmed") return { kind: "skipped", reason: "not_confirmed" };
  if (booking.startsAt.toISOString() !== queuedStartsAt) {
    return { kind: "skipped", reason: "rescheduled" };
  }
  if (booking.startsAt.getTime() <= now.getTime()) {
    return { kind: "skipped", reason: "already_started" };
  }

  const whenLabel = formatZonedDateTime(booking.startsAt, booking.timezone);
  const title = `Starting soon: ${booking.amenity.name}`;
  const body = booking.amenity.locationLabel
    ? `Your reservation starts at ${whenLabel} — ${booking.amenity.locationLabel}. Reference ${booking.reference}.`
    : `Your reservation starts at ${whenLabel}. Reference ${booking.reference}.`;
  const linkPath = `/app/homeowner/amenities/${booking.amenityId}`;

  // Written with the same deterministic key as the outbox row, so a retried
  // delivery cannot produce a second in-app notification.
  await db.notification.createMany({
    data: [
      {
        id: randomUUID(),
        userId: booking.user.id,
        kind: "reminder",
        title,
        body,
        linkPath,
        dedupeKey: reminderDedupeKey(booking.id, booking.startsAt),
      },
    ],
    skipDuplicates: true,
  });

  // A reminder is a convenience, not a security or operational notice, so an
  // email opt-out is honoured. The in-app copy above is always written.
  const wantsEmail = booking.user.homeownerProfile?.notifyEmail !== false;
  if (!wantsEmail || !booking.user.email) {
    return { kind: "sent", email: null };
  }

  return {
    kind: "sent",
    email: {
      to: booking.user.email,
      subject: title,
      text: `${body}\n\nOpen Bundleen: ${appUrl(linkPath)}`,
    },
  };
}
