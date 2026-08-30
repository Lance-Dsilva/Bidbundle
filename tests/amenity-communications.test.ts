import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * HOA-scoped amenity messages.
 *
 * The requirement is negative and absolute: an HOA manager must never reach
 * another HOA's residents or the Bundleen-wide audience. That is guaranteed
 * structurally — this module never touches the `Broadcast` model or its
 * segment machinery — and the tests below check both the structure and the
 * queries it actually issues.
 */

type Op = { model: string; action: string; args: Record<string, unknown> };

const state = vi.hoisted(() => ({
  memberships: [] as Array<Record<string, unknown>>,
  bookings: [] as Array<Record<string, unknown>>,
  amenity: { name: "Badminton Court" } as Record<string, unknown> | null,
  queries: [] as Array<{ model: string; where: Record<string, unknown> }>,
  writes: [] as Op[],
  batches: [] as Op[][],
  emails: [] as Array<Record<string, unknown>>,
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
    communityMembership: {
      findMany: async (args: Record<string, unknown>) => {
        state.queries.push({
          model: "communityMembership",
          where: (args.where ?? {}) as Record<string, unknown>,
        });
        return state.memberships;
      },
    },
    amenityBooking: {
      findMany: async (args: Record<string, unknown>) => {
        state.queries.push({
          model: "amenityBooking",
          where: (args.where ?? {}) as Record<string, unknown>,
        });
        return state.bookings;
      },
    },
    amenity: { findFirst: async () => state.amenity },
    user: { findUnique: async () => ({ email: "morgan@example.com" }) },
    homeownerProfile: { findMany: async () => [] },
    notification: { createMany: op("notification", "createMany") },
    outboxEvent: { createMany: op("outboxEvent", "createMany") },
    adminAuditLog: { create: op("adminAuditLog", "create") },
    $transaction: async (ops: Op[]) => {
      state.batches.push(ops);
      return ops;
    },
  },
}));

vi.mock("@/lib/server/email", () => ({
  getEmailProvider: () => ({
    send: async (message: Record<string, unknown>) => {
      state.emails.push(message);
      return { providerMessageId: "msg-1" };
    },
  }),
}));

vi.mock("next/server", () => ({ after: () => undefined }));

const { previewAmenityAudience, sendAmenityBroadcast } = await import(
  "@/lib/server/amenity-communications"
);

const MANAGER = {
  userId: "user-manager",
  communityId: "hoa-1",
  communityName: "Cedar Ridge",
  timezone: "America/Chicago",
  role: "manager" as const,
  membershipId: null,
  unitId: null,
  unitLabel: null,
  canManage: true,
};

const RESIDENT = { ...MANAGER, userId: "user-resident", role: "resident" as const, canManage: false };

function member(id: string, name: string, notifyEmail = true) {
  return {
    user: {
      id,
      email: `${id}@example.com`,
      fullName: name,
      homeownerProfile: { notifyEmail },
    },
  };
}

const NOW = new Date("2026-06-09T12:00:00.000Z");

beforeEach(() => {
  state.memberships = [member("u1", "Rae"), member("u2", "Sam")];
  state.bookings = [member("u2", "Sam")];
  state.amenity = { name: "Badminton Court" };
  state.queries = [];
  state.writes = [];
  state.batches = [];
  state.emails = [];
});

describe("audience scoping", () => {
  it("resolves all-residents to the manager's own HOA only", async () => {
    await previewAmenityAudience(MANAGER, "all_residents", null, false, NOW);

    const query = state.queries.find((entry) => entry.model === "communityMembership");
    expect(query?.where).toMatchObject({
      communityId: "hoa-1",
      status: "active",
      community: { type: "hoa" },
      user: { role: "homeowner" },
    });
  });

  it("resolves booking audiences within the same HOA", async () => {
    await previewAmenityAudience(MANAGER, "upcoming_bookings", "amenity-1", false, NOW);

    const query = state.queries.find((entry) => entry.model === "amenityBooking");
    expect(query?.where).toMatchObject({
      communityId: "hoa-1",
      amenityId: "amenity-1",
      status: { in: ["pending_approval", "confirmed"] },
    });
  });

  it("counts recipients and how many will also get email", async () => {
    state.memberships = [
      member("u1", "Rae"),
      member("u2", "Sam", false),
      member("u3", "Ash"),
    ];

    const preview = await previewAmenityAudience(MANAGER, "all_residents", null, false, NOW);

    expect(preview.recipientCount).toBe(3);
    expect(preview.emailCount).toBe(2);
    expect(preview.sample).toEqual(["Rae", "Sam", "Ash"]);
  });

  it("counts every recipient for an urgent notice, opt-outs included", async () => {
    state.memberships = [member("u1", "Rae"), member("u2", "Sam", false)];
    const preview = await previewAmenityAudience(MANAGER, "all_residents", null, true, NOW);
    expect(preview.emailCount).toBe(2);
  });

  it("deduplicates a resident who holds two affected bookings", async () => {
    state.bookings = [member("u2", "Sam"), member("u2", "Sam")];
    const preview = await previewAmenityAudience(
      MANAGER,
      "upcoming_bookings",
      "amenity-1",
      false,
      NOW,
    );
    expect(preview.recipientCount).toBe(1);
  });

  it("refuses a resident who does not manage the HOA", async () => {
    await expect(
      previewAmenityAudience(RESIDENT, "all_residents", null, false, NOW),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("requires an amenity for the booking-derived audiences", async () => {
    await expect(
      previewAmenityAudience(MANAGER, "upcoming_bookings", null, false, NOW),
    ).rejects.toMatchObject({ status: 422 });
  });
});

describe("sending", () => {
  it("previews without writing anything", async () => {
    const result = await sendAmenityBroadcast(
      MANAGER,
      null,
      { audience: "all_residents", subject: "Pool hours", body: "New hours.", mode: "preview" },
      NOW,
    );

    expect(result.mode).toBe("preview");
    expect(state.writes).toHaveLength(0);
    expect(state.emails).toHaveLength(0);
  });

  it("sends a test to the manager alone and records no delivery", async () => {
    await sendAmenityBroadcast(
      MANAGER,
      "amenity-1",
      { audience: "all_residents", subject: "Pool hours", body: "New hours.", mode: "test" },
      NOW,
    );

    expect(state.emails).toHaveLength(1);
    expect(state.emails[0]).toMatchObject({
      to: "morgan@example.com",
      subject: "[Test] Badminton Court: Pool hours",
    });
    // A test is not a delivery: no notification rows for residents.
    expect(state.writes).toHaveLength(0);
  });

  it("writes one notification per resident with a per-recipient dedupe key", async () => {
    await sendAmenityBroadcast(
      MANAGER,
      null,
      { audience: "all_residents", subject: "Pool hours", body: "New hours.", mode: "send" },
      NOW,
    );

    const rows = state.writes
      .filter((entry) => entry.model === "notification")
      .flatMap((entry) => (entry.args.data ?? []) as Array<Record<string, unknown>>);

    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((row) => row.dedupeKey)).size).toBe(2);
    expect(rows.every((row) => String(row.dedupeKey).startsWith("amenity-broadcast:"))).toBe(
      true,
    );
  });

  it("produces the same keys for an immediate resend, so a double click sends once", async () => {
    const message = {
      audience: "all_residents" as const,
      subject: "Pool hours",
      body: "New hours.",
      mode: "send" as const,
    };

    await sendAmenityBroadcast(MANAGER, null, message, NOW);
    const first = state.writes
      .filter((entry) => entry.model === "notification")
      .flatMap((entry) => (entry.args.data ?? []) as Array<Record<string, unknown>>)
      .map((row) => row.dedupeKey);

    state.writes = [];
    await sendAmenityBroadcast(MANAGER, null, message, new Date(NOW.getTime() + 5_000));
    const second = state.writes
      .filter((entry) => entry.model === "notification")
      .flatMap((entry) => (entry.args.data ?? []) as Array<Record<string, unknown>>)
      .map((row) => row.dedupeKey);

    expect(second).toEqual(first);
  });

  it("lets a genuine resend through once the bucket rolls over", async () => {
    const message = {
      audience: "all_residents" as const,
      subject: "Pool hours",
      body: "New hours.",
      mode: "send" as const,
    };

    await sendAmenityBroadcast(MANAGER, null, message, NOW);
    const first = state.writes
      .filter((entry) => entry.model === "notification")
      .flatMap((entry) => (entry.args.data ?? []) as Array<Record<string, unknown>>)
      .map((row) => row.dedupeKey);

    state.writes = [];
    // 15 minutes later is a different ten-minute bucket.
    await sendAmenityBroadcast(MANAGER, null, message, new Date(NOW.getTime() + 15 * 60_000));
    const second = state.writes
      .filter((entry) => entry.model === "notification")
      .flatMap((entry) => (entry.args.data ?? []) as Array<Record<string, unknown>>)
      .map((row) => row.dedupeKey);

    expect(second).not.toEqual(first);
  });

  it("requires a written justification before overriding email preferences", async () => {
    await expect(
      sendAmenityBroadcast(
        MANAGER,
        null,
        {
          audience: "all_residents",
          subject: "Pool closed",
          body: "Chemical spill.",
          urgent: true,
          mode: "send",
        },
        NOW,
      ),
    ).rejects.toMatchObject({ status: 422 });
    expect(state.writes).toHaveLength(0);
  });

  it("audits an urgent override with its justification and the HOA", async () => {
    await sendAmenityBroadcast(
      MANAGER,
      "amenity-1",
      {
        audience: "all_residents",
        subject: "Pool closed",
        body: "Chemical spill.",
        urgent: true,
        urgentJustification: "Safety closure affecting all residents.",
        mode: "send",
      },
      NOW,
    );

    const audit = state.writes.find((entry) => entry.model === "adminAuditLog");
    const data = audit?.args.data as Record<string, unknown>;
    expect(data.action).toBe("amenity_broadcast_sent");
    expect(data.metadata).toMatchObject({
      via: "manager",
      category: "all_residents",
      reason: "Safety closure affecting all residents.",
    });
    // The message text itself never enters the immutable log.
    expect(JSON.stringify(data.metadata)).not.toContain("Chemical spill");
  });

  it("writes the audit row in the same transaction as the notifications", async () => {
    await sendAmenityBroadcast(
      MANAGER,
      null,
      { audience: "all_residents", subject: "Hi", body: "Body.", mode: "send" },
      NOW,
    );

    expect(state.batches).toHaveLength(1);
    expect(state.batches[0].some((entry) => entry.model === "adminAuditLog")).toBe(true);
    expect(state.batches[0].some((entry) => entry.model === "notification")).toBe(true);
  });

  it("refuses a resident outright", async () => {
    await expect(
      sendAmenityBroadcast(
        RESIDENT,
        null,
        { audience: "all_residents", subject: "Hi", body: "Body.", mode: "send" },
        NOW,
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(state.writes).toHaveLength(0);
  });
});

describe("structural isolation from the global broadcast", () => {
  it("does not import the global broadcast module at all", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(
      new URL("../src/lib/server/amenity-communications.ts", import.meta.url),
      "utf8",
    );

    // The strongest available guarantee that a manager cannot reach the
    // Bundleen-wide audience: the machinery is not in scope here. Checked
    // against the import statements rather than the whole file, since the
    // module's own header explains the separation by naming that module.
    const imports = source
      .split("\n")
      .filter((line) => /^\s*import\b/.test(line) || /^\s*}\s*from\s+"/.test(line))
      .join("\n");

    // `AmenityBroadcastInput` is this feature's own validated input and is
    // expected; the global module and its exports are what must be absent.
    expect(imports).not.toContain("server/communications");
    expect(imports).not.toContain("validation/communications");
    for (const global of [
      "sendBroadcast",
      "BroadcastSegment",
      "BroadcastError",
      "previewBroadcastAudience",
      "db.broadcast",
      "broadcastRecipient",
    ]) {
      expect(source).not.toContain(global);
    }
  });

  it("has no audience option that is not community-scoped", async () => {
    const { amenityBroadcastSchema } = await import("@/lib/validation/amenities");
    const shape = amenityBroadcastSchema.safeParse({
      audience: "all_users",
      subject: "x",
      body: "y",
      mode: "send",
    });
    expect(shape.success).toBe(false);
  });
});
