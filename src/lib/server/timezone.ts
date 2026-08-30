import "server-only";

/**
 * IANA timezone arithmetic for the amenity booking engine.
 *
 * Every instant Bundleen stores is UTC. Every rule a manager writes — "the
 * court opens at 07:00 on Saturdays", "no bookings more than 14 days ahead" —
 * is expressed in the HOA's local wall clock. This module is the only place
 * the two are converted, so daylight-saving behaviour is decided once.
 *
 * There is no date library in this project's dependencies and none is added:
 * `Intl.DateTimeFormat` already knows the full IANA database, and the two
 * conversions below are all the engine needs.
 *
 * ── Why the round trip in {@link zonedToUtc} ──────────────────────────────
 *
 * A local wall-clock time does not always identify one instant.
 *
 *  - On the spring-forward day, 02:30 America/Chicago never happens.
 *  - On the fall-back day, 01:30 America/Chicago happens twice.
 *
 * Guessing an offset and subtracting it is wrong on both days. Instead the
 * function computes candidate instants, keeps only those that actually render
 * back to the requested wall-clock time, and reports which case it hit so the
 * caller can decide rather than silently booking the wrong hour.
 */

/** How a requested local time mapped onto the timeline. */
export type ZonedResolution =
  /** Exactly one instant. The ordinary case. */
  | "exact"
  /** Two instants (fall-back). The earlier one is returned. */
  | "ambiguous"
  /** No instant (spring-forward gap). The instant after the gap is returned. */
  | "nonexistent";

export type ZonedInstant = {
  instant: Date;
  resolution: ZonedResolution;
};

export type LocalFields = {
  year: number;
  /** 1-12. */
  month: number;
  /** 1-31. */
  day: number;
  /** Minutes since local midnight, 0-1439. */
  minutes: number;
  /** 0 = Sunday, matching `Date.prototype.getDay`. */
  weekday: number;
};

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/** Prisma's `Weekday` enum in `Date.getDay()` order. */
export const WEEKDAY_BY_INDEX = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

export type WeekdayName = (typeof WEEKDAY_BY_INDEX)[number];

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timeZone);
  if (cached) return cached;

  // `hourCycle: "h23"` matters: the default for en-US renders midnight as
  // hour 24 in some ICU versions, which would silently shift a day.
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
  });
  formatterCache.set(timeZone, formatter);
  return formatter;
}

/** True when `timeZone` is a zone this runtime's ICU data recognises. */
export function isSupportedTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** Renders `instant` as wall-clock fields in `timeZone`. */
export function utcToZoned(instant: Date, timeZone: string): LocalFields {
  const parts = formatterFor(timeZone).formatToParts(instant);
  const lookup: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== "literal") lookup[part.type] = part.value;
  }

  const hour = Number(lookup.hour ?? "0");
  return {
    year: Number(lookup.year),
    month: Number(lookup.month),
    day: Number(lookup.day),
    // h23 still emits "24" for midnight under some ICU builds; normalise it.
    minutes: (hour % 24) * 60 + Number(lookup.minute ?? "0"),
    weekday: WEEKDAY_INDEX[lookup.weekday ?? "Sun"] ?? 0,
  };
}

/** The zone's UTC offset, in minutes east of UTC, at one instant. */
export function zoneOffsetMinutes(instant: Date, timeZone: string): number {
  const local = utcToZoned(instant, timeZone);
  const asIfUtc = Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    Math.floor(local.minutes / 60),
    local.minutes % 60,
  );
  // Seconds and milliseconds are dropped by the formatter, so compare against
  // the instant truncated to the minute rather than the raw value.
  const truncated = Math.floor(instant.getTime() / 60_000) * 60_000;
  return (asIfUtc - truncated) / 60_000;
}

/**
 * Converts a local wall-clock date and minute-of-day in `timeZone` to a UTC
 * instant, reporting how the conversion resolved.
 *
 * `minutes` may exceed 1439 to express a time on the following day, which is
 * how an overnight opening window (22:00 -> 26:00) is written.
 */
export function zonedToUtc(
  year: number,
  month: number,
  day: number,
  minutes: number,
  timeZone: string,
): ZonedInstant {
  const dayOverflow = Math.floor(minutes / 1440);
  const minuteOfDay = minutes - dayOverflow * 1440;

  // Normalise the calendar date first so `day + dayOverflow` cannot produce
  // a 32nd of the month.
  const normalized = new Date(Date.UTC(year, month - 1, day + dayOverflow));
  const targetYear = normalized.getUTCFullYear();
  const targetMonth = normalized.getUTCMonth() + 1;
  const targetDay = normalized.getUTCDate();

  const wallClockAsUtc =
    Date.UTC(targetYear, targetMonth - 1, targetDay) + minuteOfDay * 60_000;

  // Probe the offsets in force a day either side of the naive instant, as well
  // as at the instant itself. A zone changes offset at most once a day, so
  // those three cover both sides of any transition — which is what the
  // repeated hour needs. Probing only near the naive instant finds one of the
  // two valid instants on a fall-back day and reports it as unambiguous.
  const DAY_MS = 24 * 60 * 60 * 1_000;
  const offsets = new Set(
    [wallClockAsUtc - DAY_MS, wallClockAsUtc, wallClockAsUtc + DAY_MS].map((probe) =>
      zoneOffsetMinutes(new Date(probe), timeZone),
    ),
  );

  const seen = new Set<number>();
  const matches: number[] = [];
  const candidates: number[] = [];
  for (const offset of offsets) {
    const candidate = wallClockAsUtc - offset * 60_000;
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    candidates.push(candidate);
    const rendered = utcToZoned(new Date(candidate), timeZone);
    if (
      rendered.year === targetYear &&
      rendered.month === targetMonth &&
      rendered.day === targetDay &&
      rendered.minutes === minuteOfDay
    ) {
      matches.push(candidate);
    }
  }

  if (matches.length === 1) {
    return { instant: new Date(matches[0]), resolution: "exact" };
  }
  if (matches.length > 1) {
    // Fall-back: the wall clock repeats. The first occurrence is the one a
    // resident booking "1:30am" means, and it is the earlier instant.
    return { instant: new Date(Math.min(...matches)), resolution: "ambiguous" };
  }

  // Spring-forward gap: the requested time was skipped. Land on the instant
  // the clock jumped to, which is the latest candidate — for a 02:30 request
  // in a zone that jumps 02:00 -> 03:00, that is 03:30 local.
  return {
    instant: new Date(Math.max(...candidates)),
    resolution: "nonexistent",
  };
}

/** `YYYY-MM-DD` for an instant, as seen in `timeZone`. */
export function zonedDateKey(instant: Date, timeZone: string): string {
  const local = utcToZoned(instant, timeZone);
  return formatDateKey(local.year, local.month, local.day);
}

export function formatDateKey(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Parses `YYYY-MM-DD`. Returns null for anything else, including `2026-02-31`. */
export function parseDateKey(
  key: string,
): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() + 1 !== month ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

/** `YYYY-MM-DD` shifted by whole calendar days. */
export function addDaysToDateKey(key: string, days: number): string {
  const parsed = parseDateKey(key);
  if (!parsed) throw new Error(`Invalid date key: ${key}`);
  const shifted = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day + days));
  return formatDateKey(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth() + 1,
    shifted.getUTCDate(),
  );
}

/** `Date.getDay()` index for a `YYYY-MM-DD` key. */
export function weekdayOfDateKey(key: string): number {
  const parsed = parseDateKey(key);
  if (!parsed) throw new Error(`Invalid date key: ${key}`);
  return new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day)).getUTCDay();
}

/** Whole days between two `YYYY-MM-DD` keys (`to - from`). */
export function daysBetweenDateKeys(from: string, to: string): number {
  const a = parseDateKey(from);
  const b = parseDateKey(to);
  if (!a || !b) throw new Error("Invalid date key");
  const msPerDay = 24 * 60 * 60 * 1_000;
  return Math.round(
    (Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) /
      msPerDay,
  );
}

/** `07:30` for 450. Minutes past 1440 wrap, so `1560` renders as `02:00`. */
export function formatMinuteOfDay(minutes: number): string {
  const normalized = ((minutes % 1440) + 1440) % 1440;
  const hour = Math.floor(normalized / 60);
  const minute = normalized % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** Human 12-hour rendering used in notification copy: `7:30 AM`. */
export function formatClockLabel(minutes: number): string {
  const normalized = ((minutes % 1440) + 1440) % 1440;
  const hour24 = Math.floor(normalized / 60);
  const minute = normalized % 60;
  const suffix = hour24 < 12 ? "AM" : "PM";
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${String(minute).padStart(2, "0")} ${suffix}`;
}

/** `Sat 14 Mar, 7:30 AM` in the HOA's zone. For emails and in-app copy. */
export function formatZonedDateTime(instant: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
    }).format(instant);
  } catch {
    return instant.toISOString();
  }
}
