import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The durable 30-minute reminder, driven by a controllable clock.
 *
 * The property that matters most is negative: a booking that was cancelled or
 * moved after its reminder was queued must produce *no* message. Deleting the
 * pending row handles the ordinary path, but a delete that races the worker's
 * claim would still deliver — so the worker re-reads the canonical booking,
 * and these tests drive that re-read directly.
 */

const state = vi.hoisted(() => ({
  booking: null as Record<string, unknown> | null,
  notifications: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/server/db", () => ({
  db: {
    amenityBooking: { findUnique: async () => state.booking },
    notification: {
      createMany: async (args: { data: Array<Record<string, unknown>> }) => {
        state.notifications.push(...args.data);
        return { count: args.data.length };
      },
    },
  },
}));

const { resolveBookingReminder, reminderDedupeKey, REMINDER_LEAD_MINUTES } =
  await import("@/lib/server/amenity-reminders");

const START = new Date("2026-06-10T14:00:00.000Z");
/** Exactly when the worker would first see the row as due. */
const DUE = new Date("2026-06-10T13:30:00.000Z");

const appUrl = (path: string) => `https://bundleen.test${path}`;

function confirmedBooking(overrides: Record<string, unknown> = {}) {
  return {
    id: "booking-1",
    reference: "BK-ABC123",
    status: "confirmed",
    startsAt: START,
    timezone: "America/Chicago",
    amenityId: "amenity-1",
    isManagerBlock: false,
    amenity: { name: "Badminton Court", locationLabel: "Behind the clubhouse" },
    user: {
      id: "user-1",
      email: "rae@example.com",
      homeownerProfile: { notifyEmail: true },
    },
    ...overrides,
  };
}

const payload = { bookingId: "booking-1", startsAt: START.toISOString() };

beforeEach(() => {
  state.booking = confirmedBooking();
  state.notifications = [];
});

describe("resolveBookingReminder", () => {
  it("promises delivery 30 minutes ahead", () => {
    expect(REMINDER_LEAD_MINUTES).toBe(30);
    expect(START.getTime() - DUE.getTime()).toBe(30 * 60_000);
  });

  it("writes one in-app notification and returns the email to send", async () => {
    const outcome = await resolveBookingReminder(payload, appUrl, DUE);

    expect(outcome.kind).toBe("sent");
    expect(outcome).toMatchObject({
      email: {
        to: "rae@example.com",
        subject: "Starting soon: Badminton Court",
      },
    });
    expect(state.notifications).toHaveLength(1);
    expect(state.notifications[0]).toMatchObject({
      userId: "user-1",
      kind: "reminder",
      dedupeKey: reminderDedupeKey("booking-1", START),
    });
  });

  it("uses a deterministic key so a retried delivery cannot duplicate it", async () => {
    await resolveBookingReminder(payload, appUrl, DUE);
    await resolveBookingReminder(payload, appUrl, DUE);

    // Both writes carry the identical key; `skipDuplicates` plus the unique
    // index collapse them to one row in the database.
    expect(new Set(state.notifications.map((row) => row.dedupeKey)).size).toBe(1);
  });

  it("sends nothing for a cancelled booking", async () => {
    state.booking = confirmedBooking({ status: "cancelled_by_resident" });

    const outcome = await resolveBookingReminder(payload, appUrl, DUE);

    expect(outcome).toEqual({ kind: "skipped", reason: "not_confirmed" });
    expect(state.notifications).toHaveLength(0);
  });

  it("sends nothing for a booking still awaiting approval", async () => {
    state.booking = confirmedBooking({ status: "pending_approval" });
    const outcome = await resolveBookingReminder(payload, appUrl, DUE);
    expect(outcome).toEqual({ kind: "skipped", reason: "not_confirmed" });
  });

  it("sends nothing when the booking was moved after the reminder was queued", async () => {
    // The row is still `confirmed`, but for a different hour. A worker that
    // trusted the queued payload would remind the resident about a slot that
    // no longer exists.
    state.booking = confirmedBooking({
      startsAt: new Date("2026-06-10T16:00:00.000Z"),
    });

    const outcome = await resolveBookingReminder(payload, appUrl, DUE);

    expect(outcome).toEqual({ kind: "skipped", reason: "rescheduled" });
    expect(state.notifications).toHaveLength(0);
  });

  it("sends nothing once the booking has started", async () => {
    const outcome = await resolveBookingReminder(
      payload,
      appUrl,
      new Date("2026-06-10T14:30:00.000Z"),
    );
    expect(outcome).toEqual({ kind: "skipped", reason: "already_started" });
  });

  it("sends nothing for a manager's maintenance block", async () => {
    state.booking = confirmedBooking({ isManagerBlock: true });
    const outcome = await resolveBookingReminder(payload, appUrl, DUE);
    expect(outcome).toEqual({ kind: "skipped", reason: "not_confirmed" });
  });

  it("resolves a deleted booking without failing the event", async () => {
    state.booking = null;
    const outcome = await resolveBookingReminder(payload, appUrl, DUE);
    expect(outcome).toEqual({ kind: "skipped", reason: "missing" });
  });

  it("rejects a malformed payload rather than guessing", async () => {
    expect(await resolveBookingReminder({}, appUrl, DUE)).toEqual({
      kind: "skipped",
      reason: "missing",
    });
    expect(await resolveBookingReminder(null, appUrl, DUE)).toEqual({
      kind: "skipped",
      reason: "missing",
    });
  });

  it("keeps the in-app copy but drops the email for an opted-out resident", async () => {
    state.booking = confirmedBooking({
      user: {
        id: "user-1",
        email: "rae@example.com",
        homeownerProfile: { notifyEmail: false },
      },
    });

    const outcome = await resolveBookingReminder(payload, appUrl, DUE);

    expect(outcome).toEqual({ kind: "sent", email: null });
    expect(state.notifications).toHaveLength(1);
  });

  it("puts no address or private note in the message body", async () => {
    const outcome = await resolveBookingReminder(payload, appUrl, DUE);
    const body = String(state.notifications[0].body);

    // The location label is a human hint the manager published to residents;
    // it is not an address, and nothing else personal is included.
    expect(body).toContain("Behind the clubhouse");
    expect(body).toContain("BK-ABC123");
    expect(body).not.toMatch(/\d{3,}\s+\w+\s+(Street|St|Lane|Ln|Road|Rd)/i);
  });

  it("renders the start time in the HOA's zone, not the server's", async () => {
    await resolveBookingReminder(payload, appUrl, DUE);
    // 14:00Z is 09:00 in America/Chicago on that date.
    expect(String(state.notifications[0].body)).toContain("9:00");
  });
});
