import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Behavioural tests for `createSupportTicket` — the path that returned 500 in
 * production and left orphaned tickets behind.
 *
 * These run the real service against a Prisma double, so they assert what the
 * code actually does rather than what it looks like. The two properties that
 * matter most:
 *
 * 1. The ticket, its opening message, the creation event, and the queued
 *    notification go into **one** `$transaction` batch. The outage happened
 *    because those statements ran on separate connections; a test that only
 *    checked "a ticket row was written" would have passed throughout it.
 * 2. Nothing downstream of the commit — email delivery, an outbox drain — can
 *    fail the request or void the ticket.
 */

type Op = { model: string; action: string; args: unknown };

const state = vi.hoisted(() => ({
  /** Operations recorded as they are *built*, before any transaction runs. */
  built: [] as Op[],
  /** Each `$transaction` call's batch, in order. */
  batches: [] as Op[][],
  existingTickets: [] as {
    id: string;
    subject: string;
    category: string;
    createdAt: Date;
    messages: { body: string }[];
  }[],
  transactionShouldFail: false,
  drainShouldThrow: false,
  ticketNumberSequence: 1000,
}));

/**
 * A Prisma double whose delegate calls return an opaque token rather than
 * executing. `$transaction` receives those tokens, which is exactly how the
 * real batch API works — and it is what lets these tests see whether the
 * writes were handed over together or issued separately.
 */
function op(model: string, action: string, args: unknown): Op {
  const record = { model, action, args };
  state.built.push(record);
  return record;
}

const db = vi.hoisted(() => {
  const self = {
    supportTicket: {
      create: (args: unknown) => op("supportTicket", "create", args),
      findMany: async (args: { where?: { subject?: string; category?: string } }) =>
        state.existingTickets.filter(
          (ticket) =>
            ticket.subject === args.where?.subject &&
            ticket.category === args.where?.category,
        ),
      findFirst: async () => ({
        id: "ticket-1",
        ticketNumber: "BDL-001000",
        subject: "Cannot sign in",
        category: "account",
        status: "new",
        priority: "normal",
        requesterUserId: "user-1",
        requesterRole: "provider",
        communityId: null,
        assignedAdminUserId: null,
        relatedRequestId: null,
        relatedBidId: null,
        relatedVisitId: null,
        reopenedFromTicketId: null,
        firstAdminReplyAt: null,
        lastCustomerMessageAt: new Date(),
        lastAdminMessageAt: null,
        lastActivityAt: new Date(),
        resolvedAt: null,
        closedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        requester: { fullName: "Green Crew", email: "crew@example.com" },
        community: null,
        assignedAdmin: null,
        _count: { messages: 1 },
      }),
    },
    supportTicketMessage: {
      create: (args: unknown) => op("supportTicketMessage", "create", args),
      findMany: async () => [
        {
          id: "message-1",
          kind: "customer_reply" as const,
          body: "It keeps rejecting my password.",
          fromAiDraftId: null,
          createdAt: new Date(),
          author: { id: "user-1", fullName: "Green Crew" },
        },
      ],
    },
    supportTicketEvent: {
      create: (args: unknown) => op("supportTicketEvent", "create", args),
    },
    communityStaffAssignment: { findMany: async () => [] },
    homeownerProfile: { findMany: async () => [] },
    notification: {
      createMany: (args: unknown) => op("notification", "createMany", args),
    },
    outboxEvent: {
      createMany: (args: unknown) => op("outboxEvent", "createMany", args),
    },
    $queryRaw: async () => [{ value: BigInt(state.ticketNumberSequence++) }],
    $transaction: async (ops: Op[]) => {
      state.batches.push(ops);
      if (state.transactionShouldFail) {
        const error = new Error(
          "Foreign key constraint violated on the constraint: `SupportTicketEvent_ticketId_fkey`",
        );
        (error as unknown as { code: string }).code = "P2003";
        throw error;
      }
      return ops.map(() => ({ count: 1 }));
    },
  };
  return self;
});

vi.mock("@/lib/server/db", () => ({ db }));

vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    // `after()` outside a request lifecycle is exactly the "drain trigger
    // failed" case the ticket must survive.
    after: () => {
      if (state.drainShouldThrow) throw new Error("no request scope");
    },
  };
});

const requester = {
  id: "user-1",
  role: "provider" as const,
  email: "crew@example.com",
  name: "Green Crew",
};

const input = {
  subject: "Cannot sign in",
  category: "account" as const,
  message: "It keeps rejecting my password.",
};

beforeEach(() => {
  state.built = [];
  state.batches = [];
  state.existingTickets = [];
  state.transactionShouldFail = false;
  state.drainShouldThrow = false;
  state.ticketNumberSequence = 1000;
});

describe("createSupportTicket", () => {
  it("writes the ticket, its first message, and the creation event in one transaction", async () => {
    const { createSupportTicket } = await import("@/lib/server/support");
    await createSupportTicket(requester, input);

    expect(state.batches).toHaveLength(1);
    const models = state.batches[0]!.map((entry) => `${entry.model}.${entry.action}`);
    expect(models).toContain("supportTicket.create");
    expect(models).toContain("supportTicketMessage.create");
    expect(models).toContain("supportTicketEvent.create");

    // Nothing was written outside the batch: every operation built during the
    // call is one of the operations handed to `$transaction`.
    for (const built of state.built) {
      expect(state.batches[0]).toContain(built);
    }
  });

  it("queues the customer notification inside the same transaction", async () => {
    const { createSupportTicket } = await import("@/lib/server/support");
    await createSupportTicket(requester, input);

    const models = state.batches[0]!.map((entry) => `${entry.model}.${entry.action}`);
    expect(models).toContain("notification.createMany");
    expect(models).toContain("outboxEvent.createMany");
  });

  it("derives requester identity from the session, never from the input", async () => {
    const { createSupportTicket } = await import("@/lib/server/support");
    await createSupportTicket(requester, input);

    const create = state.batches[0]!.find((entry) => entry.model === "supportTicket")!;
    const data = (create.args as { data: Record<string, unknown> }).data;
    expect(data.requesterUserId).toBe("user-1");
    expect(data.requesterRole).toBe("provider");
    // Server-owned fields are fixed, not negotiable.
    expect(data.status).toBe("new");
    expect(data.priority).toBe("normal");
    expect(data.assignedAdminUserId).toBeUndefined();
  });

  it("returns the created ticket when the outbox drain trigger fails", async () => {
    state.drainShouldThrow = true;
    const { createSupportTicket } = await import("@/lib/server/support");

    const ticket = await createSupportTicket(requester, input);

    expect(ticket.ticketNumber).toBe("BDL-001000");
    // The notification intent is still durably queued for the retrying worker.
    const models = state.batches[0]!.map((entry) => `${entry.model}.${entry.action}`);
    expect(models).toContain("outboxEvent.createMany");
  });

  it("propagates a failed transaction instead of reporting a ticket that does not exist", async () => {
    state.transactionShouldFail = true;
    const { createSupportTicket } = await import("@/lib/server/support");

    await expect(createSupportTicket(requester, input)).rejects.toMatchObject({
      code: "P2003",
    });
  });

  it("returns the original ticket for a rapid duplicate submission", async () => {
    state.existingTickets = [
      {
        id: "ticket-1",
        subject: input.subject,
        category: input.category,
        createdAt: new Date(),
        messages: [{ body: input.message }],
      },
    ];

    const { createSupportTicket } = await import("@/lib/server/support");
    const ticket = await createSupportTicket(requester, input);

    expect(ticket.id).toBe("ticket-1");
    // No second ticket, and no second ticket number drawn from the sequence.
    expect(state.batches).toHaveLength(0);
    expect(state.ticketNumberSequence).toBe(1000);
  });

  it("still opens a new ticket when a different problem is reported", async () => {
    state.existingTickets = [
      {
        id: "ticket-1",
        subject: input.subject,
        category: input.category,
        createdAt: new Date(),
        messages: [{ body: "A completely different problem." }],
      },
    ];

    const { createSupportTicket } = await import("@/lib/server/support");
    await createSupportTicket(requester, input);

    expect(state.batches).toHaveLength(1);
  });
});

describe("ticket numbering", () => {
  it("draws each number from the Postgres sequence", async () => {
    const { createSupportTicket } = await import("@/lib/server/support");

    const first = await createSupportTicket(requester, input);
    state.existingTickets = [];
    const second = await createSupportTicket(requester, {
      ...input,
      subject: "Another problem",
    });

    expect(first.ticketNumber).toBe("BDL-001000");
    expect(second.ticketNumber).toBe("BDL-001000");
    // Two distinct draws happened even though the read-back double is fixed.
    expect(state.ticketNumberSequence).toBe(1002);
  });
});
