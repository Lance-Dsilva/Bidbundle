import { describe, expect, it } from "vitest";

import {
  computeAvailability,
  evaluateBookingRange,
  nextAvailableSlot,
  todayHoursLabel,
  type AmenityPolicy,
  type AvailabilitySnapshot,
  type HeldBlock,
} from "@/lib/server/amenity-availability";
import {
  addDaysToDateKey,
  daysBetweenDateKeys,
  formatClockLabel,
  formatMinuteOfDay,
  parseDateKey,
  weekdayOfDateKey,
  zonedDateKey,
  zonedToUtc,
  zoneOffsetMinutes,
} from "@/lib/server/timezone";

/**
 * The availability engine and the timezone layer under it.
 *
 * These are behavioural tests over real instants, not shape assertions: the
 * daylight-saving cases in particular are the ones that quietly book residents
 * into the wrong hour when a codebase reaches for naive date arithmetic.
 */

const CHICAGO = "America/Chicago";

const BASE_POLICY: AmenityPolicy = {
  slotMinutes: 60,
  minDurationMinutes: 60,
  maxDurationMinutes: 120,
  bufferMinutes: 0,
  maxPartySize: 4,
  advanceDays: 14,
  minNoticeMinutes: 0,
  cancellationCutoffMinutes: 120,
  maxActiveBookingsPerResident: 2,
  maxActiveBookingsPerUnit: null,
  approvalRequired: false,
};

function snapshot(overrides: Partial<AvailabilitySnapshot> = {}): AvailabilitySnapshot {
  return {
    timeZone: CHICAGO,
    policy: BASE_POLICY,
    bookingRequired: true,
    status: "published",
    operationalStatus: "open",
    resources: [{ id: "court-1", label: "Court 1" }],
    // Wednesday 2026-06-10 is the day most cases below exercise.
    hours: [
      { weekday: "wed", opensMinute: 7 * 60, closesMinute: 21 * 60 },
      { weekday: "thu", opensMinute: 7 * 60, closesMinute: 21 * 60 },
    ],
    closures: [],
    heldBlocks: [],
    ...overrides,
  };
}

function held(resourceId: string, startIso: string, endIso: string, id = "b1"): HeldBlock {
  return {
    bookingId: id,
    resourceId,
    blockStartsAt: new Date(startIso),
    blockEndsAt: new Date(endIso),
  };
}

/** 2026-06-10 is CDT (UTC-5), so local 09:00 is 14:00Z. */
const JUNE_10_0900 = "2026-06-10T14:00:00.000Z";
const JUNE_10_1000 = "2026-06-10T15:00:00.000Z";
const JUNE_10_1100 = "2026-06-10T16:00:00.000Z";
/** A "now" well before the day under test, so notice/advance rules pass. */
const NOW = new Date("2026-06-09T12:00:00.000Z");

describe("timezone conversion", () => {
  it("resolves an ordinary local time to exactly one instant", () => {
    const result = zonedToUtc(2026, 6, 10, 9 * 60, CHICAGO);
    expect(result.resolution).toBe("exact");
    expect(result.instant.toISOString()).toBe(JUNE_10_0900);
  });

  it("reports the fall-back repeat as ambiguous and picks the first occurrence", () => {
    // US DST ends 2026-11-01. 01:30 local happens twice: 06:30Z (CDT) and
    // 07:30Z (CST). A resident booking "1:30am" means the first one.
    const result = zonedToUtc(2026, 11, 1, 90, CHICAGO);
    expect(result.resolution).toBe("ambiguous");
    expect(result.instant.toISOString()).toBe("2026-11-01T06:30:00.000Z");
  });

  it("reports the spring-forward gap as nonexistent and lands after the jump", () => {
    // US DST starts 2026-03-08. 02:30 local never occurs; the clock goes
    // 01:59:59 CST -> 03:00:00 CDT.
    const result = zonedToUtc(2026, 3, 8, 150, CHICAGO);
    expect(result.resolution).toBe("nonexistent");
    // Whatever instant is chosen must render as a real local time, never 02:30.
    const rendered = zonedDateKey(result.instant, CHICAGO);
    expect(rendered).toBe("2026-03-08");
    expect(result.instant.getTime()).toBeGreaterThan(
      new Date("2026-03-08T07:59:59.000Z").getTime(),
    );
  });

  it("tracks the offset across the transition", () => {
    expect(zoneOffsetMinutes(new Date("2026-01-15T12:00:00Z"), CHICAGO)).toBe(-360);
    expect(zoneOffsetMinutes(new Date("2026-06-15T12:00:00Z"), CHICAGO)).toBe(-300);
  });

  it("handles minute-of-day values past midnight for overnight windows", () => {
    // 26:00 on 2026-06-10 is 02:00 on 2026-06-11 local = 07:00Z.
    const result = zonedToUtc(2026, 6, 10, 26 * 60, CHICAGO);
    expect(result.instant.toISOString()).toBe("2026-06-11T07:00:00.000Z");
  });

  it("derives local date keys, weekdays, and spans", () => {
    expect(zonedDateKey(new Date("2026-06-11T04:00:00Z"), CHICAGO)).toBe("2026-06-10");
    expect(weekdayOfDateKey("2026-06-10")).toBe(3);
    expect(addDaysToDateKey("2026-02-28", 1)).toBe("2026-03-01");
    expect(daysBetweenDateKeys("2026-06-01", "2026-06-15")).toBe(14);
    expect(parseDateKey("2026-02-31")).toBeNull();
    expect(formatMinuteOfDay(1_560)).toBe("02:00");
    expect(formatClockLabel(0)).toBe("12:00 AM");
    expect(formatClockLabel(13 * 60 + 5)).toBe("1:05 PM");
  });
});

describe("computeAvailability", () => {
  it("renders one slot per opening hour", () => {
    const days = computeAvailability(snapshot(), {
      now: NOW,
      fromDate: "2026-06-10",
      days: 1,
    });

    expect(days).toHaveLength(1);
    expect(days[0].open).toBe(true);
    // 07:00 through 20:00 starts, each 60 minutes, closing at 21:00.
    expect(days[0].slots).toHaveLength(14);
    expect(days[0].slots[0].startLabel).toBe("07:00");
    expect(days[0].slots.at(-1)?.startLabel).toBe("20:00");
    expect(days[0].slots.every((slot) => slot.available)).toBe(true);
  });

  it("closes a weekday with no configured hours", () => {
    const days = computeAvailability(snapshot(), {
      now: NOW,
      fromDate: "2026-06-12",
      days: 1,
    });
    expect(days[0].open).toBe(false);
    expect(days[0].slots).toHaveLength(0);
  });

  it("marks a taken slot unavailable and leaves its neighbours open", () => {
    const days = computeAvailability(
      snapshot({ heldBlocks: [held("court-1", JUNE_10_0900, JUNE_10_1000)] }),
      { now: NOW, fromDate: "2026-06-10", days: 1 },
    );

    const nine = days[0].slots.find((slot) => slot.startLabel === "09:00");
    const ten = days[0].slots.find((slot) => slot.startLabel === "10:00");
    expect(nine?.available).toBe(false);
    expect(nine?.reason).toBe("fully_booked");
    expect(nine?.remaining).toBe(0);
    expect(ten?.available).toBe(true);
  });

  it("keeps a slot open while any equivalent resource is free", () => {
    const twoCourts = snapshot({
      resources: [
        { id: "court-1", label: "Court 1" },
        { id: "court-2", label: "Court 2" },
      ],
      heldBlocks: [held("court-1", JUNE_10_0900, JUNE_10_1000)],
    });

    const days = computeAvailability(twoCourts, {
      now: NOW,
      fromDate: "2026-06-10",
      days: 1,
    });
    const nine = days[0].slots.find((slot) => slot.startLabel === "09:00");
    expect(nine?.available).toBe(true);
    expect(nine?.remaining).toBe(1);

    const bothTaken = computeAvailability(
      {
        ...twoCourts,
        heldBlocks: [
          held("court-1", JUNE_10_0900, JUNE_10_1000, "b1"),
          held("court-2", JUNE_10_0900, JUNE_10_1000, "b2"),
        ],
      },
      { now: NOW, fromDate: "2026-06-10", days: 1 },
    );
    expect(
      bothTaken[0].slots.find((slot) => slot.startLabel === "09:00")?.available,
    ).toBe(false);
  });

  it("lets a cleanup buffer consume the following slot", () => {
    const withBuffer = snapshot({
      policy: { ...BASE_POLICY, bufferMinutes: 15 },
      // 09:00-10:00 booked, blocked through 10:15.
      heldBlocks: [held("court-1", JUNE_10_0900, "2026-06-10T15:15:00.000Z")],
    });

    const days = computeAvailability(withBuffer, {
      now: NOW,
      fromDate: "2026-06-10",
      days: 1,
    });
    expect(days[0].slots.find((slot) => slot.startLabel === "10:00")?.available).toBe(
      false,
    );
    expect(days[0].slots.find((slot) => slot.startLabel === "11:00")?.available).toBe(
      true,
    );
  });

  it("removes slots covered by a one-off maintenance closure", () => {
    const days = computeAvailability(
      snapshot({
        closures: [
          {
            id: "c1",
            kind: "maintenance",
            startsAt: new Date(JUNE_10_1000),
            endsAt: new Date("2026-06-10T17:00:00.000Z"),
            recurringWeekday: null,
            recurringStartMinute: null,
            recurringEndMinute: null,
            residentVisible: true,
            reason: "Resurfacing",
          },
        ],
      }),
      { now: NOW, fromDate: "2026-06-10", days: 1 },
    );

    const blocked = days[0].slots.filter((slot) => slot.reason === "maintenance");
    expect(blocked.map((slot) => slot.startLabel)).toEqual(["10:00", "11:00"]);
    expect(days[0].slots.find((slot) => slot.startLabel === "12:00")?.available).toBe(
      true,
    );
  });

  it("expands a weekly recurring closure onto the right local hours", () => {
    const days = computeAvailability(
      snapshot({
        closures: [
          {
            id: "c2",
            kind: "private_event",
            startsAt: null,
            endsAt: null,
            recurringWeekday: "wed",
            recurringStartMinute: 9 * 60,
            recurringEndMinute: 11 * 60,
            residentVisible: false,
            reason: "Board meeting",
          },
        ],
      }),
      { now: NOW, fromDate: "2026-06-10", days: 1 },
    );

    expect(days[0].slots.find((slot) => slot.startLabel === "09:00")?.available).toBe(
      false,
    );
    expect(days[0].slots.find((slot) => slot.startLabel === "10:00")?.available).toBe(
      false,
    );
    expect(days[0].slots.find((slot) => slot.startLabel === "08:00")?.available).toBe(
      true,
    );
  });

  it("closes the whole day when a closure spans it, naming a visible reason", () => {
    const days = computeAvailability(
      snapshot({
        closures: [
          {
            id: "c3",
            kind: "holiday",
            startsAt: new Date("2026-06-09T00:00:00Z"),
            endsAt: new Date("2026-06-12T00:00:00Z"),
            recurringWeekday: null,
            recurringStartMinute: null,
            recurringEndMinute: null,
            residentVisible: true,
            reason: "Community festival",
          },
        ],
      }),
      { now: NOW, fromDate: "2026-06-10", days: 1 },
    );

    expect(days[0].open).toBe(false);
    expect(days[0].closedReason).toBe("Community festival");
    expect(days[0].slots).toHaveLength(0);
  });

  it("honours minimum notice and the advance window", () => {
    const closeNow = new Date("2026-06-10T13:30:00.000Z"); // 08:30 local
    const days = computeAvailability(
      snapshot({ policy: { ...BASE_POLICY, minNoticeMinutes: 120, advanceDays: 1 } }),
      { now: closeNow, fromDate: "2026-06-10", days: 1 },
    );

    // 09:00 local is only 30 minutes away, inside the 2-hour notice rule.
    expect(days[0].slots.find((slot) => slot.startLabel === "09:00")?.reason).toBe(
      "too_soon",
    );
    expect(days[0].slots.find((slot) => slot.startLabel === "16:00")?.available).toBe(
      true,
    );

    const tooFar = computeAvailability(
      snapshot({ policy: { ...BASE_POLICY, advanceDays: 0 } }),
      { now: closeNow, fromDate: "2026-06-11", days: 1 },
    );
    expect(tooFar[0].slots.every((slot) => slot.reason === "too_far")).toBe(true);
  });

  it("pauses the calendar while the amenity is in maintenance", () => {
    const days = computeAvailability(snapshot({ operationalStatus: "maintenance" }), {
      now: NOW,
      fromDate: "2026-06-10",
      days: 1,
    });
    expect(days[0].open).toBe(false);
    expect(days[0].closedReason).toBe("Under maintenance");
    expect(days[0].slots).toHaveLength(0);
  });

  it("renders no calendar at all for a non-bookable common area", () => {
    const days = computeAvailability(snapshot({ bookingRequired: false }), {
      now: NOW,
      fromDate: "2026-06-10",
      days: 1,
    });
    expect(days[0].open).toBe(true);
    expect(days[0].slots).toHaveLength(0);
    expect(todayHoursLabel(snapshot(), new Date("2026-06-10T18:00:00Z"))).toBe(
      "07:00–21:00",
    );
  });

  it("keeps every generated slot on a real local clock time across a DST jump", () => {
    // Hours that straddle the spring-forward gap on 2026-03-08.
    const overnight = snapshot({
      hours: [{ weekday: "sun", opensMinute: 0, closesMinute: 6 * 60 }],
      policy: { ...BASE_POLICY, advanceDays: 365 },
    });

    const days = computeAvailability(overnight, {
      now: new Date("2026-03-01T12:00:00Z"),
      fromDate: "2026-03-08",
      days: 1,
    });

    // 02:00 local never happens that morning, so it must not be offered — and
    // emitting it anyway would collide with 03:00, which resolves to the same
    // instant. Five real slots remain.
    expect(days[0].slots.map((slot) => slot.startLabel)).toEqual([
      "00:00",
      "01:00",
      "03:00",
      "04:00",
      "05:00",
    ]);

    const instants = days[0].slots.map((slot) => new Date(slot.startsAt).getTime());
    expect(new Set(instants).size).toBe(instants.length);
    for (let index = 1; index < instants.length; index += 1) {
      expect(instants[index]).toBeGreaterThan(instants[index - 1]);
    }
  });

  it("finds the next open slot across days", () => {
    const days = computeAvailability(snapshot(), {
      now: NOW,
      fromDate: "2026-06-12",
      days: 3,
    });
    // Friday and Saturday are closed; Sunday has no hours either, so the next
    // open day in this window is none — the helper must say so rather than
    // returning a closed slot.
    expect(nextAvailableSlot(days)).toBeNull();

    const withWed = computeAvailability(snapshot(), {
      now: NOW,
      fromDate: "2026-06-10",
      days: 2,
    });
    expect(nextAvailableSlot(withWed)?.startLabel).toBe("07:00");
  });
});

describe("evaluateBookingRange", () => {
  it("accepts a valid range and names the resource it allocated", () => {
    const result = evaluateBookingRange(
      snapshot(),
      new Date(JUNE_10_0900),
      new Date(JUNE_10_1000),
      { now: NOW },
    );
    expect(result).toMatchObject({ ok: true, resourceId: "court-1", remaining: 1 });
  });

  it("rejects a duration that is not a whole number of slots", () => {
    const result = evaluateBookingRange(
      snapshot(),
      new Date(JUNE_10_0900),
      new Date("2026-06-10T14:45:00.000Z"),
      { now: NOW },
    );
    expect(result).toMatchObject({ ok: false, reason: "invalid_duration" });
  });

  it("rejects a range that runs past closing time", () => {
    const result = evaluateBookingRange(
      snapshot(),
      new Date("2026-06-11T01:00:00.000Z"), // 20:00 local
      new Date("2026-06-11T03:00:00.000Z"), // 22:00 local, past 21:00 close
      { now: NOW },
    );
    expect(result).toMatchObject({ ok: false, reason: "closed" });
  });

  it("refuses to book a non-bookable amenity at all", () => {
    const result = evaluateBookingRange(
      snapshot({ bookingRequired: false }),
      new Date(JUNE_10_0900),
      new Date(JUNE_10_1000),
      { now: NOW },
    );
    expect(result).toMatchObject({ ok: false, reason: "not_bookable" });
  });

  it("refuses a draft amenity even when its hours would allow it", () => {
    const result = evaluateBookingRange(
      snapshot({ status: "draft" }),
      new Date(JUNE_10_0900),
      new Date(JUNE_10_1000),
      { now: NOW },
    );
    expect(result).toMatchObject({ ok: false, reason: "not_bookable" });
  });

  it("ignores the booking being rescheduled when checking its own slot", () => {
    const withOwnHold = snapshot({
      heldBlocks: [held("court-1", JUNE_10_0900, JUNE_10_1000, "mine")],
    });

    expect(
      evaluateBookingRange(withOwnHold, new Date(JUNE_10_0900), new Date(JUNE_10_1000), {
        now: NOW,
      }),
    ).toMatchObject({ ok: false, reason: "fully_booked" });

    expect(
      evaluateBookingRange(withOwnHold, new Date(JUNE_10_0900), new Date(JUNE_10_1000), {
        now: NOW,
        excludeBookingId: "mine",
      }),
    ).toMatchObject({ ok: true });
  });

  it("rejects a start that has already passed", () => {
    const result = evaluateBookingRange(
      snapshot(),
      new Date(JUNE_10_0900),
      new Date(JUNE_10_1000),
      { now: new Date(JUNE_10_1100) },
    );
    expect(result).toMatchObject({ ok: false, reason: "past" });
  });
});
