import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The amenity issue ticket lifecycle.
 *
 * Two things are checked that the serializer tests in `amenity-privacy` cannot
 * reach: the *queries* used to fetch a thread (a resident's must be pinned to
 * their own reporter id) and the write path for internal notes, which must
 * notify nobody — telling a resident "there is an update you cannot read"
 * leaks the note's existence.
 */

type Op = { model: string; action: string; args: Record<string, unknown> };

const state = vi.hoisted(() => ({
  amenity: { id: "amenity-1", name: "Badminton Court" } as Record<string, unknown> | null,
  issue: null as Record<string, unknown> | null,
  booking: null as Record<string, unknown> | null,
  staffAssignment: null as Record<string, unknown> | null,
  managers: [] as Array<Record<string, unknown>>,
  queries: [] as Array<{ model: string; where: Record<string, unknown> }>,
  writes: [] as Op[],
  batches: [] as Op[][],
}));

function op(model: string, action: string) {
  return (args: Record<string, unknown> = {}): Op => {
    const entry = { model, action, args };
    state.writes.push(entry);
    return entry;
  };
}

function trackFindFirst(model: string, value: () => unknown) {
  return async (args: Record<string, unknown> = {}) => {
    state.queries.push({ model, where: (args.where ?? {}) as Record<string, unknown> });
    return value();
  };
}

vi.mock("@/lib/server/db", () => ({
  db: {
    amenity: { findFirst: trackFindFirst("amenity", () => state.amenity) },
    amenityBooking: { findFirst: trackFindFirst("amenityBooking", () => state.booking) },
    amenityIssue: {
      findFirst: trackFindFirst("amenityIssue", () => state.issue),
      findMany: async (args: Record<string, unknown> = {}) => {
        state.queries.push({
          model: "amenityIssue.findMany",
          where: (args.where ?? {}) as Record<string, unknown>,
        });
        return state.issue ? [state.issue] : [];
      },
      create: async (args: Record<string, unknown>) => {
        op("amenityIssue", "create")(args);
        return { id: "issue-new" };
      },
      update: op("amenityIssue", "update"),
    },
    amenityIssueMessage: {
      create: async (args: Record<string, unknown>) => {
        op("amenityIssueMessage", "create")(args);
        return { id: "message-new" };
      },
    },
    amenityIssueEvent: { create: op("amenityIssueEvent", "create") },
    communityStaffAssignment: {
      findFirst: trackFindFirst(
        "communityStaffAssignment",
        () => state.staffAssignment,
      ),
      findMany: async () => state.managers,
    },
    notification: { createMany: op("notification", "createMany") },
    outboxEvent: { createMany: op("outboxEvent", "createMany") },
    adminAuditLog: { create: op("adminAuditLog", "create") },
    homeownerProfile: { findMany: async () => [] },
    $transaction: async (ops: Op[]) => {
      state.batches.push(ops);
      return ops;
    },
  },
}));

vi.mock("next/server", () => ({ after: () => undefined }));

const { addIssueMessage, createIssue, getIssue, listHoaIssues, updateIssue } =
  await import("@/lib/server/amenity-issues");

const REPORTER = {
  userId: "user-reporter",
  communityId: "hoa-1",
  communityName: "Cedar Ridge",
  timezone: "America/Chicago",
  role: "resident" as const,
  membershipId: "m-1",
  unitId: "unit-1",
  unitLabel: "Home 1",
  canManage: false,
};

const MANAGER = {
  ...REPORTER,
  userId: "user-manager",
  role: "manager" as const,
  canManage: true,
  membershipId: null,
};

const THREAD = {
  id: "issue-1",
  reference: "AI-ABC123",
  communityId: "hoa-1",
  amenityId: "amenity-1",
  reporterUserId: "user-reporter",
  bookingId: null,
  category: "damage",
  priority: "normal",
  status: "acknowledged",
  subject: "Broken net",
  description: "Torn.",
  assignedToUserId: null,
  resolutionSummary: null,
  resolvedAt: null,
  closedAt: null,
  withdrawnAt: null,
  createdAt: new Date("2026-06-01T00:00:00Z"),
  updatedAt: new Date("2026-06-01T00:00:00Z"),
  amenity: { id: "amenity-1", name: "Badminton Court" },
  reporter: { id: "user-reporter", fullName: "Rae", email: "rae@example.com" },
  assignedTo: null,
  media: [],
  events: [],
  messages: [],
};

beforeEach(() => {
  state.amenity = { id: "amenity-1", name: "Badminton Court" };
  state.issue = { ...THREAD };
  state.booking = null;
  state.staffAssignment = null;
  state.managers = [
    { user: { id: "user-manager", email: "morgan@example.com", fullName: "Morgan" } },
  ];
  state.queries = [];
  state.writes = [];
  state.batches = [];
});

describe("createIssue", () => {
  it("records the report and notifies the HOA's managers", async () => {
    const result = await createIssue(REPORTER, "amenity-1", {
      category: "damage",
      subject: "Broken net",
      description: "The net is torn near the post.",
    });

    expect(result.reference).toMatch(/^AI-[0-9A-HJKMNP-TV-Z]{6}$/);

    const create = state.writes.find((entry) => entry.model === "amenityIssue");
    expect(create?.args.data).toMatchObject({
      communityId: "hoa-1",
      amenityId: "amenity-1",
      reporterUserId: "user-reporter",
    });

    const notifications = state.writes
      .filter((entry) => entry.model === "notification")
      .flatMap((entry) => (entry.args.data ?? []) as Array<Record<string, unknown>>);
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({ userId: "user-manager", kind: "issue" });
  });

  it("keeps the resident's description out of the notification body", async () => {
    await createIssue(REPORTER, "amenity-1", {
      category: "safety",
      subject: "Broken glass",
      description: "My neighbour at 118 Cedar Lane said it happened Tuesday.",
    });

    const notification = state.writes
      .filter((entry) => entry.model === "notification")
      .flatMap((entry) => (entry.args.data ?? []) as Array<Record<string, unknown>>)[0];

    // The subject is fine; free text a resident typed is not, because it ends
    // up in an outbox payload and an email.
    expect(String(notification.body)).not.toContain("Cedar Lane");
  });

  it("refuses a caller with no active membership", async () => {
    await expect(
      createIssue({ ...REPORTER, membershipId: null }, "amenity-1", {
        category: "damage",
        subject: "x",
        description: "y",
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect(state.writes).toHaveLength(0);
  });

  it("refuses an amenity that is not published in this HOA", async () => {
    state.amenity = null;
    await expect(
      createIssue(REPORTER, "amenity-1", {
        category: "damage",
        subject: "x",
        description: "y",
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("drops a booking reference that is not the reporter's own", async () => {
    // The lookup filters on `userId`, so someone else's booking returns null
    // and the report is filed without the link rather than failing.
    state.booking = null;

    await createIssue(REPORTER, "amenity-1", {
      category: "reservation_conflict",
      subject: "Double booked",
      description: "Someone else was there.",
      bookingId: "not-mine",
    });

    const create = state.writes.find((entry) => entry.model === "amenityIssue");
    expect((create?.args.data as Record<string, unknown>).bookingId).toBeNull();
  });
});

describe("reading a thread", () => {
  it("pins a resident's read to their own reporter id", async () => {
    await getIssue(REPORTER, "issue-1");

    const query = state.queries.find((entry) => entry.model === "amenityIssue");
    expect(query?.where).toMatchObject({
      id: "issue-1",
      communityId: "hoa-1",
      reporterUserId: "user-reporter",
    });
  });

  it("lets staff read any thread in their own HOA, and no other", async () => {
    await getIssue(MANAGER, "issue-1");

    const query = state.queries.find((entry) => entry.model === "amenityIssue");
    expect(query?.where).toMatchObject({ id: "issue-1", communityId: "hoa-1" });
    expect(query?.where.reporterUserId).toBeUndefined();
  });

  it("reports someone else's thread as missing, not forbidden", async () => {
    // The scripted lookup honours the guard's own filter: a resident asking
    // for a neighbour's report gets nothing back.
    state.issue = null;
    await expect(getIssue(REPORTER, "issue-other")).rejects.toMatchObject({
      status: 404,
    });
  });

  it("refuses to hand a resident the HOA queue", async () => {
    await expect(listHoaIssues(REPORTER)).rejects.toMatchObject({ status: 403 });
  });
});

describe("messages", () => {
  it("notifies nobody about an internal note", async () => {
    await addIssueMessage(MANAGER, "issue-1", "Escalate to the board.", true);

    const message = state.writes.find(
      (entry) => entry.model === "amenityIssueMessage",
    );
    expect((message?.args.data as Record<string, unknown>).kind).toBe("internal_note");

    // No notification at all: its existence is itself private.
    expect(state.writes.some((entry) => entry.model === "notification")).toBe(false);
  });

  it("notifies the reporter about a manager reply", async () => {
    await addIssueMessage(MANAGER, "issue-1", "We've ordered a new net.", false);

    const notification = state.writes
      .filter((entry) => entry.model === "notification")
      .flatMap((entry) => (entry.args.data ?? []) as Array<Record<string, unknown>>)[0];
    expect(notification).toMatchObject({ userId: "user-reporter", kind: "issue" });
    // The reply text stays in the thread rather than the email queue.
    expect(String(notification.body)).not.toContain("ordered a new net");
  });

  it("forces a resident's message to be resident-visible, whatever they send", async () => {
    // `internal: true` from a resident must not create a staff-only note in
    // their own thread.
    await addIssueMessage(REPORTER, "issue-1", "Any update?", true);

    const message = state.writes.find(
      (entry) => entry.model === "amenityIssueMessage",
    );
    expect((message?.args.data as Record<string, unknown>).kind).toBe(
      "resident_message",
    );
  });

  it("refuses to add a message to a closed report", async () => {
    state.issue = { ...THREAD, status: "closed" };
    await expect(
      addIssueMessage(REPORTER, "issue-1", "One more thing.", false),
    ).rejects.toMatchObject({ status: 409 });
    expect(state.writes).toHaveLength(0);
  });
});

describe("manager updates", () => {
  it("refuses a resident outright", async () => {
    await expect(
      updateIssue(REPORTER, "issue-1", { status: "resolved" }),
    ).rejects.toMatchObject({ status: 403 });
    expect(state.writes).toHaveLength(0);
  });

  it("writes the status change, its event, and an audit row together", async () => {
    await updateIssue(MANAGER, "issue-1", {
      status: "resolved",
      resolutionSummary: "New net fitted.",
    });

    const models = state.batches[0].map((entry) => entry.model);
    expect(models).toContain("amenityIssue");
    expect(models).toContain("amenityIssueEvent");
    expect(models).toContain("adminAuditLog");

    const audit = state.batches[0].find((entry) => entry.model === "adminAuditLog");
    expect((audit?.args.data as Record<string, unknown>).action).toBe(
      "amenity_issue_status_changed",
    );
  });

  it("refuses to assign someone who does not staff this HOA", async () => {
    state.staffAssignment = null;

    await expect(
      updateIssue(MANAGER, "issue-1", { assignedToUserId: "user-outsider" }),
    ).rejects.toMatchObject({ status: 422 });
    expect(state.batches).toHaveLength(0);
  });

  it("accepts an assignment to active HOA staff", async () => {
    state.staffAssignment = { id: "s-1" };

    await updateIssue(MANAGER, "issue-1", { assignedToUserId: "user-team" });

    const query = state.queries.find(
      (entry) => entry.model === "communityStaffAssignment",
    );
    expect(query?.where).toMatchObject({
      userId: "user-team",
      communityId: "hoa-1",
      status: "active",
      role: { in: ["hoa_manager", "hoa_team"] },
    });
  });

  it("tells the reporter when their report is resolved", async () => {
    await updateIssue(MANAGER, "issue-1", {
      status: "resolved",
      resolutionSummary: "New net fitted.",
    });

    const notification = state.writes
      .filter((entry) => entry.model === "notification")
      .flatMap((entry) => (entry.args.data ?? []) as Array<Record<string, unknown>>)[0];
    expect(notification).toMatchObject({ userId: "user-reporter" });
  });
});
