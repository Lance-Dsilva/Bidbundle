import "server-only";

import {
  addDaysToDateKey,
  daysBetweenDateKeys,
  formatMinuteOfDay,
  parseDateKey,
  weekdayOfDateKey,
  WEEKDAY_BY_INDEX,
  zonedDateKey,
  zonedToUtc,
  type WeekdayName,
} from "@/lib/server/timezone";

/**
 * The single authority on whether an amenity can be booked at a given time.
 *
 * Deliberately pure: it takes a snapshot of the rules and the rows that hold
 * capacity and returns a decision. No database, no clock, no session. The
 * browser calls it (through an API) to *preview* slots and the booking service
 * calls it again to *decide*, so a client that renders a stale calendar cannot
 * talk the server into accepting a slot that is closed, full, or in the past.
 *
 * It is not, however, the last line of defence against a double booking. Two
 * requests can both evaluate the final slot as free before either inserts. The
 * `AmenityBooking_no_overlap` exclusion constraint resolves that race in the
 * database; this module's job is to give everyone else a correct answer and a
 * useful reason.
 */

export type AmenityPolicy = {
  slotMinutes: number;
  minDurationMinutes: number;
  maxDurationMinutes: number;
  bufferMinutes: number;
  maxPartySize: number;
  advanceDays: number;
  minNoticeMinutes: number;
  cancellationCutoffMinutes: number;
  maxActiveBookingsPerResident: number;
  maxActiveBookingsPerUnit: number | null;
  approvalRequired: boolean;
};

export type AmenityHoursInput = {
  weekday: WeekdayName;
  opensMinute: number;
  /** May exceed 1440 for an overnight window. */
  closesMinute: number;
};

export type AmenityClosureInput = {
  id: string;
  kind: "blackout" | "maintenance" | "holiday" | "private_event";
  startsAt: Date | null;
  endsAt: Date | null;
  recurringWeekday: WeekdayName | null;
  recurringStartMinute: number | null;
  recurringEndMinute: number | null;
  residentVisible: boolean;
  reason: string | null;
};

/** One live booking's occupied range, including its own buffer. */
export type HeldBlock = {
  bookingId: string;
  resourceId: string;
  blockStartsAt: Date;
  blockEndsAt: Date;
};

export type AmenityResourceInput = {
  id: string;
  label: string;
};

export type AvailabilitySnapshot = {
  timeZone: string;
  policy: AmenityPolicy;
  bookingRequired: boolean;
  /** `published` amenities are the only bookable ones. */
  status: "draft" | "published" | "archived";
  operationalStatus: "open" | "closed" | "maintenance" | "temporarily_unavailable";
  /** Active resources only; capacity is the number of rows. */
  resources: readonly AmenityResourceInput[];
  hours: readonly AmenityHoursInput[];
  closures: readonly AmenityClosureInput[];
  heldBlocks: readonly HeldBlock[];
};

export type SlotUnavailableReason =
  | "amenity_unavailable"
  | "closed"
  | "blackout"
  | "maintenance"
  | "holiday"
  | "private_event"
  | "fully_booked"
  | "too_soon"
  | "too_far"
  | "past";

export type SlotView = {
  /** UTC instant, ISO. The only value a booking request may send back. */
  startsAt: string;
  endsAt: string;
  /** Local `HH:MM` in the HOA's zone, for rendering without a second lookup. */
  startLabel: string;
  endLabel: string;
  available: boolean;
  /** Resources still free for this slot. */
  remaining: number;
  reason: SlotUnavailableReason | null;
};

export type AvailabilityDayView = {
  date: string;
  weekday: WeekdayName;
  /** False when the amenity keeps no hours that weekday or is fully closed. */
  open: boolean;
  /** Resident-visible explanation when the whole day is unavailable. */
  closedReason: string | null;
  slots: SlotView[];
};

export type AvailabilityQuery = {
  now: Date;
  /** First local date to render, `YYYY-MM-DD`. */
  fromDate: string;
  /** How many local days to render, bounded by the caller. */
  days: number;
  /** Requested booking length; defaults to the policy minimum. */
  durationMinutes?: number;
  /**
   * A booking being rescheduled. Its own held block is ignored so a resident
   * moving 10:00 -> 10:30 is not blocked by their own reservation.
   */
  excludeBookingId?: string | null;
};

const MAX_DAYS = 62;

const CLOSURE_REASON: Record<AmenityClosureInput["kind"], SlotUnavailableReason> = {
  blackout: "blackout",
  maintenance: "maintenance",
  holiday: "holiday",
  private_event: "private_event",
};

const OPERATIONAL_MESSAGE: Record<
  AvailabilitySnapshot["operationalStatus"],
  string | null
> = {
  open: null,
  closed: "Closed",
  maintenance: "Under maintenance",
  temporarily_unavailable: "Temporarily unavailable",
};

/** A resolved UTC interval a slot must not touch. */
type ClosureInterval = {
  start: number;
  end: number;
  kind: AmenityClosureInput["kind"];
  reason: string | null;
  residentVisible: boolean;
};

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/**
 * Resolves every closure into concrete UTC intervals covering the queried
 * range. Recurring closures are expanded per local date, so a weekly
 * "Wednesdays 09:00-11:00" block lands on the right instant on both sides of a
 * daylight-saving change instead of drifting by an hour.
 */
function resolveClosures(
  snapshot: AvailabilitySnapshot,
  fromDate: string,
  days: number,
): ClosureInterval[] {
  const intervals: ClosureInterval[] = [];

  for (const closure of snapshot.closures) {
    if (closure.startsAt && closure.endsAt) {
      intervals.push({
        start: closure.startsAt.getTime(),
        end: closure.endsAt.getTime(),
        kind: closure.kind,
        reason: closure.reason,
        residentVisible: closure.residentVisible,
      });
      continue;
    }

    if (
      closure.recurringWeekday === null ||
      closure.recurringStartMinute === null ||
      closure.recurringEndMinute === null
    ) {
      continue;
    }

    // One day of slack on each side so an overnight window that began the day
    // before the range still masks the slots it covers.
    for (let offset = -1; offset <= days; offset += 1) {
      const dateKey = addDaysToDateKey(fromDate, offset);
      const weekday = WEEKDAY_BY_INDEX[weekdayOfDateKey(dateKey)];
      if (weekday !== closure.recurringWeekday) continue;

      const parsed = parseDateKey(dateKey);
      if (!parsed) continue;
      const start = zonedToUtc(
        parsed.year,
        parsed.month,
        parsed.day,
        closure.recurringStartMinute,
        snapshot.timeZone,
      ).instant;
      const end = zonedToUtc(
        parsed.year,
        parsed.month,
        parsed.day,
        closure.recurringEndMinute,
        snapshot.timeZone,
      ).instant;

      intervals.push({
        start: start.getTime(),
        end: end.getTime(),
        kind: closure.kind,
        reason: closure.reason,
        residentVisible: closure.residentVisible,
      });
    }
  }

  return intervals;
}

/**
 * Opening windows that touch one local date: that weekday's own windows, plus
 * the previous day's windows that run past midnight.
 */
function windowsForDate(
  snapshot: AvailabilitySnapshot,
  dateKey: string,
): Array<{ baseDate: string; opensMinute: number; closesMinute: number }> {
  const weekday = WEEKDAY_BY_INDEX[weekdayOfDateKey(dateKey)];
  const windows = snapshot.hours
    .filter((entry) => entry.weekday === weekday)
    .map((entry) => ({
      baseDate: dateKey,
      opensMinute: entry.opensMinute,
      closesMinute: entry.closesMinute,
    }));

  return windows.sort((a, b) => a.opensMinute - b.opensMinute);
}

function chooseFreeResource(
  snapshot: AvailabilitySnapshot,
  blockStart: number,
  blockEnd: number,
  excludeBookingId: string | null,
): { resourceId: string | null; remaining: number } {
  let firstFree: string | null = null;
  let remaining = 0;

  for (const resource of snapshot.resources) {
    const busy = snapshot.heldBlocks.some(
      (held) =>
        held.resourceId === resource.id &&
        held.bookingId !== excludeBookingId &&
        overlaps(
          blockStart,
          blockEnd,
          held.blockStartsAt.getTime(),
          held.blockEndsAt.getTime(),
        ),
    );
    if (busy) continue;
    remaining += 1;
    if (firstFree === null) firstFree = resource.id;
  }

  return { resourceId: firstFree, remaining };
}

/**
 * Evaluates one concrete requested range against every rule.
 *
 * This is the function the booking service trusts. {@link computeAvailability}
 * is a loop over it, so a slot the calendar renders as bookable and a slot the
 * server accepts can never disagree.
 */
export type BookingEvaluation =
  | {
      ok: true;
      resourceId: string;
      blockStartsAt: Date;
      blockEndsAt: Date;
      remaining: number;
    }
  | { ok: false; reason: SlotUnavailableReason | "invalid_duration" | "not_bookable"; message: string };

export function evaluateBookingRange(
  snapshot: AvailabilitySnapshot,
  startsAt: Date,
  endsAt: Date,
  options: { now: Date; excludeBookingId?: string | null } = { now: new Date() },
): BookingEvaluation {
  const { policy } = snapshot;
  const excludeBookingId = options.excludeBookingId ?? null;
  const now = options.now;

  if (!snapshot.bookingRequired) {
    return {
      ok: false,
      reason: "not_bookable",
      message: "This amenity does not take reservations.",
    };
  }
  if (snapshot.status !== "published") {
    return {
      ok: false,
      reason: "not_bookable",
      message: "This amenity is not open for reservations.",
    };
  }
  if (snapshot.resources.length === 0) {
    return {
      ok: false,
      reason: "fully_booked",
      message: "This amenity has no bookable spaces configured.",
    };
  }
  if (snapshot.operationalStatus !== "open") {
    return {
      ok: false,
      reason: "amenity_unavailable",
      message: `${OPERATIONAL_MESSAGE[snapshot.operationalStatus] ?? "Unavailable"}. New reservations are paused.`,
    };
  }

  const startMs = startsAt.getTime();
  const endMs = endsAt.getTime();
  const durationMinutes = Math.round((endMs - startMs) / 60_000);

  if (
    !Number.isFinite(startMs) ||
    !Number.isFinite(endMs) ||
    durationMinutes <= 0 ||
    durationMinutes < policy.minDurationMinutes ||
    durationMinutes > policy.maxDurationMinutes ||
    durationMinutes % policy.slotMinutes !== 0
  ) {
    return {
      ok: false,
      reason: "invalid_duration",
      message: `Reservations run in ${policy.slotMinutes}-minute blocks between ${policy.minDurationMinutes} and ${policy.maxDurationMinutes} minutes.`,
    };
  }

  if (startMs <= now.getTime()) {
    return { ok: false, reason: "past", message: "That time has already passed." };
  }
  if (startMs < now.getTime() + policy.minNoticeMinutes * 60_000) {
    return {
      ok: false,
      reason: "too_soon",
      message: `Reservations need at least ${policy.minNoticeMinutes} minutes' notice.`,
    };
  }

  const todayKey = zonedDateKey(now, snapshot.timeZone);
  const startKey = zonedDateKey(startsAt, snapshot.timeZone);
  if (daysBetweenDateKeys(todayKey, startKey) > policy.advanceDays) {
    return {
      ok: false,
      reason: "too_far",
      message: `Reservations open ${policy.advanceDays} days ahead.`,
    };
  }

  // The requested range has to sit inside one opening window. Checking both
  // the start date's windows and the previous date's handles overnight hours.
  const candidateWindows = [
    ...windowsForDate(snapshot, addDaysToDateKey(startKey, -1)).map((w) => ({
      ...w,
      baseDate: addDaysToDateKey(startKey, -1),
    })),
    ...windowsForDate(snapshot, startKey),
  ];

  const insideHours = candidateWindows.some((window) => {
    const parsed = parseDateKey(window.baseDate);
    if (!parsed) return false;
    const opensAt = zonedToUtc(
      parsed.year,
      parsed.month,
      parsed.day,
      window.opensMinute,
      snapshot.timeZone,
    ).instant.getTime();
    const closesAt = zonedToUtc(
      parsed.year,
      parsed.month,
      parsed.day,
      window.closesMinute,
      snapshot.timeZone,
    ).instant.getTime();
    return startMs >= opensAt && endMs <= closesAt;
  });

  if (!insideHours) {
    return {
      ok: false,
      reason: "closed",
      message: "The amenity is closed at that time.",
    };
  }

  const closures = resolveClosures(snapshot, addDaysToDateKey(startKey, -1), 3);
  const hit = closures.find((interval) =>
    overlaps(startMs, endMs, interval.start, interval.end),
  );
  if (hit) {
    return {
      ok: false,
      reason: CLOSURE_REASON[hit.kind],
      message: hit.residentVisible && hit.reason
        ? hit.reason
        : "That time is unavailable.",
    };
  }

  const blockStart = startMs;
  const blockEnd = endMs + policy.bufferMinutes * 60_000;
  const { resourceId, remaining } = chooseFreeResource(
    snapshot,
    blockStart,
    blockEnd,
    excludeBookingId,
  );

  if (!resourceId) {
    return {
      ok: false,
      reason: "fully_booked",
      message: "That time was just taken. Pick another slot.",
    };
  }

  return {
    ok: true,
    resourceId,
    blockStartsAt: new Date(blockStart),
    blockEndsAt: new Date(blockEnd),
    remaining,
  };
}

/**
 * Renders the bookable calendar for a date range.
 *
 * A non-bookable amenity returns days with hours and closure reasons and no
 * slots at all — the product rule is that a common area must never show a fake
 * calendar.
 */
export function computeAvailability(
  snapshot: AvailabilitySnapshot,
  query: AvailabilityQuery,
): AvailabilityDayView[] {
  const days = Math.min(Math.max(query.days, 1), MAX_DAYS);
  const duration = query.durationMinutes ?? snapshot.policy.minDurationMinutes;
  const excludeBookingId = query.excludeBookingId ?? null;
  const closures = resolveClosures(snapshot, addDaysToDateKey(query.fromDate, -1), days + 2);

  const result: AvailabilityDayView[] = [];

  for (let offset = 0; offset < days; offset += 1) {
    const dateKey = addDaysToDateKey(query.fromDate, offset);
    const weekday = WEEKDAY_BY_INDEX[weekdayOfDateKey(dateKey)];
    const parsed = parseDateKey(dateKey);
    const windows = windowsForDate(snapshot, dateKey);

    if (!parsed || windows.length === 0) {
      result.push({
        date: dateKey,
        weekday,
        open: false,
        closedReason: windows.length === 0 ? "Closed" : null,
        slots: [],
      });
      continue;
    }

    // A full-day closure is worth naming once at the top of the day rather
    // than repeating on twenty greyed-out slots.
    const dayStart = zonedToUtc(parsed.year, parsed.month, parsed.day, 0, snapshot.timeZone)
      .instant.getTime();
    const dayEnd = zonedToUtc(parsed.year, parsed.month, parsed.day, 1440, snapshot.timeZone)
      .instant.getTime();
    const fullDayClosure = closures.find(
      (interval) => interval.start <= dayStart && interval.end >= dayEnd,
    );

    if (snapshot.operationalStatus !== "open") {
      result.push({
        date: dateKey,
        weekday,
        open: false,
        closedReason: OPERATIONAL_MESSAGE[snapshot.operationalStatus],
        slots: [],
      });
      continue;
    }

    if (fullDayClosure) {
      result.push({
        date: dateKey,
        weekday,
        open: false,
        closedReason:
          fullDayClosure.residentVisible && fullDayClosure.reason
            ? fullDayClosure.reason
            : "Unavailable",
        slots: [],
      });
      continue;
    }

    const slots: SlotView[] = [];
    if (snapshot.bookingRequired) {
      for (const window of windows) {
        for (
          let startMinute = window.opensMinute;
          startMinute + duration <= window.closesMinute;
          startMinute += snapshot.policy.slotMinutes
        ) {
          const zoned = zonedToUtc(
            parsed.year,
            parsed.month,
            parsed.day,
            startMinute,
            snapshot.timeZone,
          );

          // On a spring-forward day the local clock skips an hour. A slot
          // labelled 02:00 that no clock in the HOA will ever show is not a
          // slot; emitting it would also collide with the 03:00 slot, since
          // both resolve to the same instant.
          if (zoned.resolution === "nonexistent") continue;

          const startsAt = zoned.instant;
          const endsAt = new Date(startsAt.getTime() + duration * 60_000);

          const evaluation = evaluateBookingRange(snapshot, startsAt, endsAt, {
            now: query.now,
            excludeBookingId,
          });

          slots.push({
            startsAt: startsAt.toISOString(),
            endsAt: endsAt.toISOString(),
            startLabel: formatMinuteOfDay(startMinute),
            endLabel: formatMinuteOfDay(startMinute + duration),
            available: evaluation.ok,
            remaining: evaluation.ok ? evaluation.remaining : 0,
            reason: evaluation.ok
              ? null
              : evaluation.reason === "invalid_duration" ||
                  evaluation.reason === "not_bookable"
                ? "closed"
                : evaluation.reason,
          });
        }
      }
    }

    result.push({
      date: dateKey,
      weekday,
      open: true,
      closedReason: null,
      slots,
    });
  }

  return result;
}

/** The next bookable slot in the range, for the catalog card's teaser line. */
export function nextAvailableSlot(days: readonly AvailabilityDayView[]): SlotView | null {
  for (const day of days) {
    const slot = day.slots.find((candidate) => candidate.available);
    if (slot) return slot;
  }
  return null;
}

/** Today's opening window as a label, or null when closed today. */
export function todayHoursLabel(
  snapshot: AvailabilitySnapshot,
  now: Date,
): string | null {
  const dateKey = zonedDateKey(now, snapshot.timeZone);
  const windows = windowsForDate(snapshot, dateKey);
  if (windows.length === 0) return null;
  return windows
    .map(
      (window) =>
        `${formatMinuteOfDay(window.opensMinute)}–${formatMinuteOfDay(window.closesMinute)}`,
    )
    .join(", ");
}
