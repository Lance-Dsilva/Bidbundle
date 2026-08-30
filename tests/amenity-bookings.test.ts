import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The booking lifecycle, against a scripted database.
 *
 * The interesting cases are the ones a naive implementation gets wrong:
 *
 *  - two residents reaching the same last slot (the exclusion constraint has
 *    to decide, and the loser has to be re-evaluated onto a free resource);
 *  - a double-clicked submit (one reservation, not two);
 *  - a cancelled or moved booking leaving a live reminder behind.
 *
 * The scripted `db` records every write, so a test can assert that a refusal
 * wrote nothing at all.
 */

type Op = { model: string; action: string; args: Record<string, unknown> };

const state = vi.hoisted(() => ({
  amenity: null as Record<string, unknown> | null,
  existingBooking: null as Record<string, unknown> | null,
  heldBlocks: [] as Array<Record<string, unknown>>,
  myActiveCount: 0,
  unitActiveCount: 0,
  bookingRow: null as Record<string, unknown> | null,
  /** Queue of errors the next `$transaction` calls should throw. */
  transactionErrors: [] as Array<unknown>,
  writes: [] as Op[],
  batches: [] as Op[][],
  countCalls: [] as Array<Record<string, unknown>>,
}));

function op(model: string, action: string) {
  return (args: Record<string, unknown> = {}): Op => {
    const entry = { model, action, args };
    state.writes.push(entry);
    return entry;
  };
}

vi.mock("@/lib/server/db", () => ({
  db: {
    amenity: {
      findFirst: async () => state.amenity,
      findUnique: async () => state.amenity,
    },
    amenityBooking: {
      findFirst: async () => state.existingBooking,
      findMany: async () => state.heldBlocks,
      findUnique: async () => state.bookingRow,
      findUniqueOrThrow: async () => state.bookingRow,
      count: async (args: Record<string, unknown>) => {
        state.countCalls.push(args);
        const where = (args.where ?? {}) as Record<string, unknown>;
        return where.unitId ? state.unitActiveCount : state.myActiveCount;
      },
      create: op("amenityBooking", "create"),
      update: op("amenityBooking", "update"),
      updateMany: (args: Record<string, unknown>) => {
        op("amenityBooking", "updateMany")(args);
        return Promise.resolve({ count: 1 });
      },
    },
    amenityBookingEvent: {
      create: op("amenityBookingEvent", "create"),
      createMany: op("amenityBookingEvent", "createMany"),
    },
    outboxEvent: {
      createMany: op("outboxEvent", "createMany"),
      deleteMany: op("outboxEvent", "deleteMany"),
    },
    notification: { createMany: op("notification", "createMany") },
    adminAuditLog: { create: op("adminAuditLog", "create") },
    homeownerProfile: { findMany: async () => [] },
    user: {
      findUnique: async () => ({
        id: "user-resident",
        email: "rae@example.com",
        fullName: "Rae",
      }),
      findMany: async () => [{ id: "user-resident", email: "rae@example.com" }],
    },
    communityStaffAssignment: { findMany: async () => [] },
    $transaction: async (arg: unknown) => {
      const failure = state.transactionErrors.shift();
      if (failure) throw failure;
      const ops = Array.isArray(arg) ? (arg as Op[]) : [];
      state.batches.push(ops);
      return ops;
    },
  },
}));

vi.mock("next/server", () => ({ after: () => undefined }));

const {
  buildReminderCancelOps,
  buildReminderOps,
  cancelBooking,
  createBooking,
  isOverlapViolation,
  reminderDedupeKey,
} = await import("@/lib/server/amenity-bookings");

const CHICAGO = "America/Chicago";
const NOW = new Date("2026-06-09T12:00:00.000Z");
/** Local 09:00 on Wednesday 2026-06-10 (CDT). */
const SLOT = "2026-06-10T14:00:00.000Z";

const SCOPE = {
  userId: "user-resident",
  communityId: "hoa-1",
  communityName: "Cedar Ridge",
  timezone: CHICAGO,
  role: "resident" as const,
  membershipId: "m-1",
  unitId: "unit-1",
  unitLabel: "Home 1",
  canManage: false,
};

const AMENITY = {
  id: "amenity-1",
  communityId: "hoa-1",
  name: "Badminton Court",
  status: "published",
  bookingRequired: true,
  approvalRequired: false,
  maxPartySize: 4,
  minDurationMinutes: 60,
  maxDurationMinutes: 120,
  slotMinutes: 60,
  bufferMinutes: 0,
  minNoticeMinutes: 0,
  advanceDays: 14,
  maxActiveBookingsPerResident: 2,
  maxActiveBookingsPerUnit: null,
  cancellationCutoffMinutes: 120,
  // Fields the availability snapshot needs.
  description: null,
  features: [],
  locationLabel: null,
  rules: null,
  permittedUses: null,
  ageRestriction: null,
  guestPolicy: null,
  cancellationPolicy: null,
  contactInstructions: null,
  operationalStatus: "open",
  operationalNote: null,
  reopensAt: null,
  ratingCount: 0,
  ratingSum: 0,
  coverMedia: null,
  type: "badminton_court",
  resources: [
    { id: "court-1", label: "Court 1" },
    { id: "court-2", label: "Court 2" },
  ],
  hours: [{ weekday: "wed", opensMinute: 7 * 60, closesMinute: 21 * 60 }],
  closures: [],
};

beforeEach(() => {
  state.amenity = { ...AMENITY };
  state.existingBooking = null;
  state.heldBlocks = [];
  state.myActiveCount = 0;
  state.unitActiveCount = 0;
  state.bookingRow = null;
  state.transactionErrors = [];
  state.writes = [];
  state.batches = [];
  state.countCalls = [];
});

/** The exclusion-constraint violation PostgreSQL raises on a lost race. */
const overlapError = Object.assign(new Error('conflicting key value violates exclusion constraint "AmenityBooking_no_overlap"'), {
  code: "23P01",
});

describe("isOverlapViolation", () => {
  it("recognises the raw PostgreSQL code", () => {
    expect(isOverlapViolation({ code: "23P01" })).toBe(true);
  });

  it("recognises the constraint by name in a wrapped message", () => {
    expect(
      isOverlapViolation(new Error('violates exclusion constraint "AmenityBooking_no_overlap"')),
    ).toBe(true);
  });

  it("recognises it inside Prisma's `meta`", () => {
    expect(isOverlapViolation({ meta: { code: "23P01" } })).toBe(true);
  });

  it("does not mistake an ordinary unique violation for an overlap", () => {
    expect(isOverlapViolation({ code: "P2002" })).toBe(false);
    expect(isOverlapViolation(null)).toBe(false);
  });
});

describe("createBooking", () => {
  it("writes the booking, its first event, and its reminder in one batch", async () => {
    const result = await createBooking(SCOPE, "amenity-1", { startsAt: SLOT }, NOW);

    expect(result.idempotent).toBe(false);
    expect(result.status).toBe("confirmed");
    expect(result.reference).toMatch(/^BK-[0-9A-HJKMNP-TV-Z]{6}$/);

    // One transaction. Atomicity is the point: a committed booking with no
    // reminder, or a reminder with no booking, are both wrong.
    expect(state.batches).toHaveLength(1);
    const models = state.batches[0].map((entry) => `${entry.model}.${entry.action}`);
    expect(models).toContain("amenityBooking.create");
    expect(models).toContain("amenityBookingEvent.create");
    expect(models).toContain("outboxEvent.createMany");
  });

  it("snapshots the policy and the timezone onto the row", async () => {
    await createBooking(SCOPE, "amenity-1", { startsAt: SLOT }, NOW);

    const create = state.writes.find(
      (entry) => entry.model === "amenityBooking" && entry.action === "create",
    );
    const data = create?.args.data as Record<string, unknown>;

    expect(data.timezone).toBe(CHICAGO);
    expect(data.policySnapshot).toMatchObject({
      slotMinutes: 60,
      cancellationCutoffMinutes: 120,
      approvalRequired: false,
    });
    // Server-derived, never client-supplied.
    expect(data.communityId).toBe("hoa-1");
    expect(data.userId).toBe("user-resident");
    expect(data.unitId).toBe("unit-1");
    expect(data.status).toBe("confirmed");
  });

  it("is idempotent for a repeated submission of the same slot", async () => {
    state.existingBooking = {
      id: "booking-existing",
      reference: "BK-AAAAAA",
      status: "confirmed",
    };

    const result = await createBooking(SCOPE, "amenity-1", { startsAt: SLOT }, NOW);

    expect(result).toEqual({
      bookingId: "booking-existing",
      reference: "BK-AAAAAA",
      status: "confirmed",
      idempotent: true,
    });
    // Nothing written at all — this is the double-click case.
    expect(state.writes).toHaveLength(0);
  });

  it("holds the booking for approval when the amenity requires it", async () => {
    state.amenity = { ...AMENITY, approvalRequired: true };

    const result = await createBooking(SCOPE, "amenity-1", { startsAt: SLOT }, NOW);

    expect(result.status).toBe("pending_approval");

    // No *reminder* yet: it is queued when the manager approves, not before.
    // The notification email for "requested" is also an outbox row, so the
    // assertion has to look at the row kind rather than the model name.
    const outboxRows = state.batches[0]
      .filter((entry) => entry.model === "outboxEvent" && entry.action === "createMany")
      .flatMap((entry) => (entry.args.data ?? []) as Array<Record<string, unknown>>);
    expect(outboxRows.some((row) => row.kind === "amenity_booking_reminder")).toBe(false);
    expect(outboxRows.some((row) => row.kind === "notification_email")).toBe(true);
  });

  it("queues exactly one reminder for an instantly confirmed booking", async () => {
    await createBooking(SCOPE, "amenity-1", { startsAt: SLOT }, NOW);

    const reminders = state.batches[0]
      .filter((entry) => entry.model === "outboxEvent" && entry.action === "createMany")
      .flatMap((entry) => (entry.args.data ?? []) as Array<Record<string, unknown>>)
      .filter((row) => row.kind === "amenity_booking_reminder");

    expect(reminders).toHaveLength(1);
    expect((reminders[0].nextAttemptAt as Date).toISOString()).toBe(
      "2026-06-10T13:30:00.000Z",
    );
  });

  it("recovers from a lost race by re-evaluating onto a free resource", async () => {
    // First insert loses the exclusion constraint; the retry must succeed.
    state.transactionErrors = [overlapError];

    const result = await createBooking(SCOPE, "amenity-1", { startsAt: SLOT }, NOW);

    expect(result.idempotent).toBe(false);
    // Two attempts were made; only the second committed.
    expect(
      state.writes.filter(
        (entry) => entry.model === "amenityBooking" && entry.action === "create",
      ),
    ).toHaveLength(2);
    expect(state.batches).toHaveLength(1);
  });

  it("gives up with a clear message when every attempt loses the race", async () => {
    state.transactionErrors = [overlapError, overlapError];

    await expect(
      createBooking(SCOPE, "amenity-1", { startsAt: SLOT }, NOW),
    ).rejects.toMatchObject({
      status: 409,
      message: "That time was just taken. Pick another slot.",
    });
    expect(state.batches).toHaveLength(0);
  });

  it("refuses when both courts are already held for that slot", async () => {
    state.heldBlocks = [
      {
        id: "b1",
        resourceId: "court-1",
        blockStartsAt: new Date(SLOT),
        blockEndsAt: new Date("2026-06-10T15:00:00.000Z"),
      },
      {
        id: "b2",
        resourceId: "court-2",
        blockStartsAt: new Date(SLOT),
        blockEndsAt: new Date("2026-06-10T15:00:00.000Z"),
      },
    ];

    await expect(
      createBooking(SCOPE, "amenity-1", { startsAt: SLOT }, NOW),
    ).rejects.toMatchObject({ status: 409 });
    expect(state.writes).toHaveLength(0);
  });

  it("enforces the per-resident concurrent booking limit", async () => {
    state.myActiveCount = 2;

    await expect(
      createBooking(SCOPE, "amenity-1", { startsAt: SLOT }, NOW),
    ).rejects.toMatchObject({ status: 409 });
    expect(state.writes).toHaveLength(0);
  });

  it("enforces a per-unit limit when one is configured", async () => {
    state.amenity = { ...AMENITY, maxActiveBookingsPerUnit: 1 };
    state.myActiveCount = 0;
    state.unitActiveCount = 1;

    await expect(
      createBooking(SCOPE, "amenity-1", { startsAt: SLOT }, NOW),
    ).rejects.toMatchObject({ status: 409 });

    // The unit query has to be scoped to the resident's own unit.
    const unitQuery = state.countCalls.find(
      (args) => (args.where as Record<string, unknown>).unitId !== undefined,
    );
    expect((unitQuery?.where as Record<string, unknown>).unitId).toBe("unit-1");
  });

  it("refuses a party larger than the amenity allows", async () => {
    await expect(
      createBooking(SCOPE, "amenity-1", { startsAt: SLOT, partySize: 9 }, NOW),
    ).rejects.toMatchObject({ status: 422 });
    expect(state.writes).toHaveLength(0);
  });

  it("refuses to book a non-bookable common area", async () => {
    state.amenity = { ...AMENITY, bookingRequired: false };
    await expect(
      createBooking(SCOPE, "amenity-1", { startsAt: SLOT }, NOW),
    ).rejects.toMatchObject({ status: 422 });
  });

  it("refuses a draft amenity", async () => {
    state.amenity = { ...AMENITY, status: "draft" };
    await expect(
      createBooking(SCOPE, "amenity-1", { startsAt: SLOT }, NOW),
    ).rejects.toMatchObject({ status: 422 });
  });

  it("refuses a caller with no active membership", async () => {
    await expect(
      createBooking({ ...SCOPE, membershipId: null }, "amenity-1", { startsAt: SLOT }, NOW),
    ).rejects.toMatchObject({ status: 403 });
    expect(state.writes).toHaveLength(0);
  });

  it("refuses a slot outside opening hours", async () => {
    // Local 23:00 on the Wednesday — the court closes at 21:00.
    await expect(
      createBooking(SCOPE, "amenity-1", { startsAt: "2026-06-11T04:00:00.000Z" }, NOW),
    ).rejects.toMatchObject({ status: 409 });
  });
});

describe("reminder scheduling", () => {
  it("keys a reminder on the booking and its start instant", () => {
    const key = reminderDedupeKey("booking-1", new Date(SLOT));
    expect(key).toBe("amenity-reminder:booking-1:2026-06-10T14:00:00.000Z");

    // A different start time is a different reminder, which is what makes a
    // reschedule unable to fire the old one.
    expect(reminderDedupeKey("booking-1", new Date("2026-06-10T15:00:00.000Z"))).not.toBe(
      key,
    );
  });

  it("queues the reminder 30 minutes before the start", () => {
    state.writes = [];
    buildReminderOps({ id: "booking-1", startsAt: new Date(SLOT) }, NOW);

    const write = state.writes[0];
    const row = (write.args.data as Array<Record<string, unknown>>)[0];
    expect(row.kind).toBe("amenity_booking_reminder");
    expect((row.nextAttemptAt as Date).toISOString()).toBe("2026-06-10T13:30:00.000Z");
    // Ids only — no address, no note, nothing personal in the queue.
    expect(row.payload).toEqual({ bookingId: "booking-1", startsAt: SLOT });
  });

  it("makes a reminder due immediately when the booking starts in under 30 minutes", () => {
    state.writes = [];
    const soon = new Date("2026-06-10T13:50:00.000Z"); // 10 minutes before
    buildReminderOps({ id: "booking-2", startsAt: new Date(SLOT) }, soon);

    const row = (state.writes[0].args.data as Array<Record<string, unknown>>)[0];
    expect((row.nextAttemptAt as Date).getTime()).toBe(soon.getTime());
  });

  it("queues nothing for a booking that has already started", () => {
    state.writes = [];
    const ops = buildReminderOps(
      { id: "booking-3", startsAt: new Date(SLOT) },
      new Date("2026-06-10T15:00:00.000Z"),
    );
    expect(ops).toHaveLength(0);
    expect(state.writes).toHaveLength(0);
  });

  it("cancels every pending reminder for a booking, whatever its start time was", () => {
    state.writes = [];
    buildReminderCancelOps("booking-1");

    const where = state.writes[0].args.where as Record<string, unknown>;
    expect(where).toMatchObject({
      kind: "amenity_booking_reminder",
      status: "pending",
      dedupeKey: { startsWith: "amenity-reminder:booking-1:" },
    });
  });
});

describe("cancelBooking", () => {
  const liveBooking = {
    id: "booking-1",
    reference: "BK-ZZZZZZ",
    amenityId: "amenity-1",
    userId: "user-resident",
    status: "confirmed",
    startsAt: new Date(SLOT),
    endsAt: new Date("2026-06-10T15:00:00.000Z"),
    partySize: 1,
    timezone: CHICAGO,
    residentNote: null,
    cancellationReason: null,
    createdAt: NOW,
    amenity: { id: "amenity-1", name: "Badminton Court", cancellationCutoffMinutes: 120 },
    resource: { label: "Court 1" },
  };

  it("cancels and kills the pending reminder in the same batch", async () => {
    state.existingBooking = liveBooking;
    state.bookingRow = liveBooking;

    const result = await cancelBooking(SCOPE, "booking-1", "Away that week", NOW);
    expect(result.changed).toBe(true);

    const models = state.batches[0].map((entry) => `${entry.model}.${entry.action}`);
    expect(models).toContain("outboxEvent.deleteMany");
    expect(models).toContain("amenityBookingEvent.create");
  });

  it("refuses after the cancellation cutoff and writes nothing", async () => {
    state.existingBooking = liveBooking;
    // 09:00 start, 120-minute cutoff — 08:00 local is already too late.
    const tooLate = new Date("2026-06-10T13:30:00.000Z");

    await expect(
      cancelBooking(SCOPE, "booking-1", null, tooLate),
    ).rejects.toMatchObject({ status: 409 });
    expect(state.batches).toHaveLength(0);
  });

  it("treats cancelling an already-cancelled booking as success", async () => {
    state.existingBooking = { ...liveBooking, status: "cancelled_by_resident" };

    const result = await cancelBooking(SCOPE, "booking-1", null, NOW);
    expect(result.changed).toBe(false);
    expect(state.batches).toHaveLength(0);
  });
});
