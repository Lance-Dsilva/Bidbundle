import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Participant isolation for job conversations.
 *
 * The screen this backs used to call an endpoint that took `other_user_id`
 * from the browser, which would have let any provider open a channel to any
 * account by guessing an id. The replacement derives both participants from the
 * request and the bid, and scopes every read and write to them.
 *
 * The database is faked, but the fake *applies the `where` clause* rather than
 * returning fixtures regardless of it. That is the point: these tests fail if
 * the service stops filtering, which a mock that ignored `where` could never
 * detect.
 */

type Row = Record<string, unknown>;

const state = vi.hoisted(() => ({
  conversations: [] as Row[],
  messages: [] as Row[],
  requests: [] as Row[],
  bids: [] as Row[],
  notifications: [] as Row[],
}));

/**
 * Evaluates the subset of Prisma `where` syntax these services use: scalar
 * equality, `{ not: … }`, `OR`, and one level of relation filter.
 */
const evaluate = vi.hoisted(() => {
  function matchRow(row: Row, where: Row | undefined, resolveRelation: (row: Row, key: string) => Row | null): boolean {
    if (!where) return true;
    return Object.entries(where).every(([key, condition]) => {
      if (key === "OR") {
        return (condition as Row[]).some((clause) => matchRow(row, clause, resolveRelation));
      }
      if (key === "AND") {
        return (condition as Row[]).every((clause) => matchRow(row, clause, resolveRelation));
      }
      if (condition !== null && typeof condition === "object" && !(condition instanceof Date)) {
        const record = condition as Row;
        if ("not" in record) return row[key] !== record.not;
        if ("in" in record) return (record.in as unknown[]).includes(row[key]);
        if ("gte" in record) return (row[key] as Date) >= (record.gte as Date);
        if ("some" in record) return false;
        // A relation filter: resolve the related row and recurse.
        const related = resolveRelation(row, key);
        return related ? matchRow(related, record, resolveRelation) : false;
      }
      return row[key] === condition;
    });
  }
  return matchRow;
});

vi.mock("@/lib/server/notifications", () => ({
  enqueueNotifications: async (intents: Row[]) => {
    state.notifications.push(...intents);
  },
}));

vi.mock("@/lib/server/db", () => {
  const named = (id: string) => ({ fullName: `Name ${id}` });
  const conversationOf = (message: Row) =>
    state.conversations.find((conversation) => conversation.id === message.conversationId) ?? null;

  const hydrate = (conversation: Row) => {
    const request = state.requests.find((row) => row.id === conversation.requestId);
    return {
      ...conversation,
      request: {
        title: (request?.title as string) ?? "Untitled",
        community: { name: (request?.communityName as string) ?? "Community" },
      },
      provider: named(conversation.providerUserId as string),
      customer: named(conversation.customerUserId as string),
    };
  };

  const conversationsMatching = (where: Row | undefined) =>
    state.conversations.filter((row) => evaluate(row, where, () => null));

  const messagesMatching = (where: Row | undefined) =>
    state.messages.filter((row) => evaluate(row, where, (message, key) => (key === "conversation" ? conversationOf(message) : null)));

  return {
    db: {
      serviceConversation: {
        findFirst: async ({ where }: { where?: Row }) => {
          const found = conversationsMatching(where)[0];
          return found ? hydrate(found) : null;
        },
        findUnique: async ({ where }: { where?: Row }) => {
          const key = where?.requestId_providerUserId as Row | undefined;
          if (!key) return null;
          const found = state.conversations.find(
            (row) =>
              row.requestId === key.requestId && row.providerUserId === key.providerUserId,
          );
          return found ? hydrate(found) : null;
        },
        findMany: async ({ where, take, select }: { where?: Row; take?: number; select?: Row }) => {
          const rows = conversationsMatching(where)
            .slice()
            .sort(
              (a, b) =>
                new Date((b.lastMessageAt as Date) ?? 0).getTime() -
                new Date((a.lastMessageAt as Date) ?? 0).getTime(),
            )
            .slice(0, take ?? 100);
          const unreadWhere = (
            (select?._count as Row | undefined)?.select as Row | undefined
          )?.messages as Row | undefined;
          return rows.map((row) => ({
            ...hydrate(row),
            messages: state.messages
              .filter((message) => message.conversationId === row.id)
              .sort(
                (a, b) =>
                  (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime(),
              )
              .slice(0, 1),
            _count: {
              messages: state.messages.filter(
                (message) =>
                  message.conversationId === row.id &&
                  evaluate(message, unreadWhere?.where as Row, () => null),
              ).length,
            },
          }));
        },
        upsert: async ({ where, create }: { where?: Row; create: Row }) => {
          // Honours the unique pair, like the real one: this is what stops the
          // two sides opening the same thread from forking it.
          const key = where?.requestId_providerUserId as Row | undefined;
          const existing = state.conversations.find(
            (row) =>
              row.requestId === key?.requestId && row.providerUserId === key?.providerUserId,
          );
          if (existing) return hydrate(existing);

          const created = { id: `conv-${state.conversations.length + 1}`, lastMessageAt: null, ...create };
          state.conversations.push(created);
          return hydrate(created);
        },
        update: async ({ where, data }: { where: Row; data: Row }) => {
          const found = state.conversations.find((row) => row.id === where.id);
          if (found) Object.assign(found, data);
          return found;
        },
      },
      conversationMessage: {
        count: async ({ where }: { where?: Row }) => messagesMatching(where).length,
        findFirst: async ({ where }: { where?: Row }) =>
          messagesMatching(where)
            .slice()
            .sort((a, b) => (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime())[0] ??
          null,
        findMany: async ({ where, skip, take }: { where?: Row; skip?: number; take?: number }) =>
          messagesMatching(where)
            .slice()
            .sort((a, b) => (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime())
            .slice(skip ?? 0, (skip ?? 0) + (take ?? 50))
            .map((row) => ({ ...row, sender: named(row.senderUserId as string) })),
        create: ({ data }: { data: Row }) => {
          const created: Row = {
            id: `msg-${state.messages.length + 1}`,
            readAt: null,
            createdAt: new Date(),
            ...data,
          };
          state.messages.push(created);
          return { ...created, sender: named(created.senderUserId as string) };
        },
        updateMany: async ({ where, data }: { where?: Row; data: Row }) => {
          const targets = messagesMatching(where);
          for (const target of targets) Object.assign(target, data);
          return { count: targets.length };
        },
      },
      serviceBid: {
        findFirst: async ({ where }: { where?: Row }) => {
          const bid = state.bids.find((row) => row.id === where?.id);
          if (!bid) return null;
          const statuses = (where?.status as Row | undefined)?.in as string[] | undefined;
          if (statuses && !statuses.includes(bid.status as string)) return null;
          // `request: { createdByUserId }` is the ownership test.
          const owner = (where?.request as Row | undefined)?.createdByUserId;
          const request = state.requests.find((row) => row.id === bid.requestId);
          if (owner && request?.createdByUserId !== owner) return null;
          return bid;
        },
      },
      hoaServiceRequest: {
        findFirst: async ({ where }: { where?: Row }) => {
          const id = where?.id;
          const request = state.requests.find((row) => row.id === id);
          if (!request) return null;
          // The service's `OR` names bid/agreement relations; model it as the
          // set of providers who actually quoted this request.
          const quoted = (request.quotedBy as string[]) ?? [];
          const clauses = (where?.OR as Row[]) ?? [];
          const providerId =
            ((clauses[0]?.bids as Row)?.some as Row)?.providerUserId ??
            ((clauses[1]?.agreement as Row)?.providerUserId);
          if (providerId && !quoted.includes(providerId as string)) return null;
          return request;
        },
      },
      $transaction: async (ops: unknown[]) => Promise.all(ops),
    },
  };
});

import {
  countUnreadMessages,
  getConversation,
  listConversations,
  markConversationRead,
  openCustomerConversation,
  openProviderConversation,
  sendConversationMessage,
} from "@/lib/server/conversations";

const PROVIDER = "provider-a";
const OTHER_PROVIDER = "provider-b";
const CUSTOMER = "customer-1";

function at(minutes: number): Date {
  return new Date(Date.UTC(2026, 7, 1, 9, minutes));
}

beforeEach(() => {
  state.requests = [
    { id: "request-1", title: "Autumn gutter clear", communityName: "Cedar Park", createdByUserId: CUSTOMER, quotedBy: [PROVIDER] },
    { id: "request-2", title: "Lawn care", communityName: "Oakwood", createdByUserId: "customer-2", quotedBy: [OTHER_PROVIDER] },
  ];
  state.conversations = [
    { id: "conv-mine", requestId: "request-1", providerUserId: PROVIDER, customerUserId: CUSTOMER, lastMessageAt: at(30) },
    { id: "conv-theirs", requestId: "request-2", providerUserId: OTHER_PROVIDER, customerUserId: "customer-2", lastMessageAt: at(40) },
  ];
  state.messages = [
    { id: "m1", conversationId: "conv-mine", senderUserId: CUSTOMER, body: "Can you start Friday?", readAt: null, createdAt: at(10) },
    { id: "m2", conversationId: "conv-mine", senderUserId: PROVIDER, body: "Friday works.", readAt: at(12), createdAt: at(20) },
    { id: "m3", conversationId: "conv-mine", senderUserId: CUSTOMER, body: "Great, see you then.", readAt: null, createdAt: at(30) },
    { id: "m4", conversationId: "conv-theirs", senderUserId: "customer-2", body: "Private to the other provider.", readAt: null, createdAt: at(40) },
  ];
  state.bids = [
    { id: "bid-1", requestId: "request-1", providerUserId: PROVIDER, status: "submitted" },
    { id: "bid-2", requestId: "request-2", providerUserId: OTHER_PROVIDER, status: "submitted" },
    { id: "bid-withdrawn", requestId: "request-1", providerUserId: OTHER_PROVIDER, status: "withdrawn" },
  ];
  state.notifications = [];
});

describe("one provider cannot reach another provider's conversation", () => {
  it("lists only their own threads", async () => {
    const inbox = await listConversations(PROVIDER);
    expect(inbox.threads.map((thread) => thread.id)).toEqual(["conv-mine"]);
  });

  it("refuses to read another provider's transcript", async () => {
    await expect(getConversation(PROVIDER, "conv-theirs")).rejects.toMatchObject({ status: 404 });
  });

  it("says 'does not exist' rather than confirming the thread is real", async () => {
    let message = "";
    try {
      await getConversation(PROVIDER, "conv-theirs");
    } catch (caught) {
      message = caught instanceof Error ? caught.message : String(caught);
    }
    expect(message).toMatch(/does not exist/i);
    // Nothing about the other party's job leaks through the refusal.
    expect(message).not.toContain("Oakwood");
    expect(message).not.toContain("customer-2");
  });

  it("refuses to send into another provider's thread, and writes nothing", async () => {
    await expect(
      sendConversationMessage(PROVIDER, "conv-theirs", "Undercutting you"),
    ).rejects.toMatchObject({ status: 404 });
    expect(state.messages.filter((row) => row.conversationId === "conv-theirs")).toHaveLength(1);
  });

  it("refuses to mark another provider's thread read", async () => {
    await expect(markConversationRead(PROVIDER, "conv-theirs")).rejects.toMatchObject({
      status: 404,
    });
    expect(state.messages.find((row) => row.id === "m4")?.readAt).toBeNull();
  });

  it("counts only the caller's own unread messages", async () => {
    // Two unread from the customer in their own thread; the other provider's
    // unread message is not theirs to see.
    await expect(countUnreadMessages(PROVIDER)).resolves.toBe(2);
    await expect(countUnreadMessages(OTHER_PROVIDER)).resolves.toBe(1);
  });

  it("the customer sees their own side of the same thread", async () => {
    const inbox = await listConversations(CUSTOMER);
    expect(inbox.threads).toHaveLength(1);
    expect(inbox.threads[0]!.otherPartyRole).toBe("provider");
    // The customer's own messages are not unread *to them*.
    expect(inbox.threads[0]!.unreadCount).toBe(0);
  });
});

describe("opening a thread names a request, never a person", () => {
  it("opens the thread for a request this provider quoted", async () => {
    state.conversations = [];
    const thread = await openProviderConversation(PROVIDER, "request-1");
    expect(thread.requestId).toBe("request-1");
    // The customer is read off the request, not supplied by the caller.
    expect(state.conversations[0]!.customerUserId).toBe(CUSTOMER);
  });

  it("refuses a request this provider never quoted", async () => {
    state.conversations = [];
    await expect(openProviderConversation(PROVIDER, "request-2")).rejects.toMatchObject({
      status: 404,
    });
    expect(state.conversations).toHaveLength(0);
  });

  it("is idempotent, and reopening reports the thread as it actually stands", async () => {
    const thread = await openProviderConversation(PROVIDER, "request-1");
    expect(thread.id).toBe("conv-mine");
    expect(state.conversations).toHaveLength(2);
    // Not reported as a fresh, empty thread: the customer is waiting in it.
    expect(thread.unreadCount).toBe(2);
    expect(thread.lastMessagePreview).toBe("Great, see you then.");
  });
});

describe("ordering, unread counts, and read transitions", () => {
  it("returns a transcript oldest first", async () => {
    const page = await getConversation(PROVIDER, "conv-mine");
    expect(page.messages.map((message) => message.body)).toEqual([
      "Can you start Friday?",
      "Friday works.",
      "Great, see you then.",
    ]);
    expect(page.hasMore).toBe(false);
    expect(page.totalMessages).toBe(3);
  });

  it("pages from the newest backwards", async () => {
    const page = await getConversation(PROVIDER, "conv-mine", { limit: 2, offset: 0 });
    expect(page.messages.map((message) => message.body)).toEqual([
      "Friday works.",
      "Great, see you then.",
    ]);
    expect(page.hasMore).toBe(true);
  });

  it("resolves each side without the browser comparing ids", async () => {
    const page = await getConversation(PROVIDER, "conv-mine");
    expect(page.messages.map((message) => message.isMine)).toEqual([false, true, false]);
  });

  it("marking read clears the other party's messages only", async () => {
    // One message from the provider that the customer has not opened yet.
    await sendConversationMessage(PROVIDER, "conv-mine", "Confirmed for Friday.");

    await expect(markConversationRead(PROVIDER, "conv-mine")).resolves.toEqual({ markedRead: 2 });
    await expect(countUnreadMessages(PROVIDER)).resolves.toBe(0);
    // A sender cannot write a receipt for their own message: the provider
    // clearing their inbox leaves the customer's unread count alone.
    await expect(countUnreadMessages(CUSTOMER)).resolves.toBe(1);
  });

  it("sending appends, bumps the thread, and notifies the other party", async () => {
    const sent = await sendConversationMessage(PROVIDER, "conv-mine", "On my way.");
    expect(sent.isMine).toBe(true);
    expect(sent.readAt).toBeNull();

    const page = await getConversation(PROVIDER, "conv-mine");
    expect(page.messages.at(-1)!.body).toBe("On my way.");
    expect(state.conversations.find((row) => row.id === "conv-mine")!.lastMessageAt).toBeInstanceOf(Date);

    expect(state.notifications).toHaveLength(1);
    expect(state.notifications[0]).toMatchObject({ userId: CUSTOMER, kind: "message" });
    // The recipient is derived from the row, never from the sender's input.
    expect(state.notifications[0]!.userId).not.toBe(PROVIDER);
  });

  it("a sent message is unread for the recipient and read once they open it", async () => {
    await sendConversationMessage(PROVIDER, "conv-mine", "On my way.");
    await expect(countUnreadMessages(CUSTOMER)).resolves.toBe(1);
    await markConversationRead(CUSTOMER, "conv-mine");
    await expect(countUnreadMessages(CUSTOMER)).resolves.toBe(0);
  });

  it("orders the inbox by last activity", async () => {
    state.conversations.push({
      id: "conv-newer",
      requestId: "request-1",
      providerUserId: PROVIDER,
      customerUserId: "customer-3",
      lastMessageAt: at(99),
    });
    const inbox = await listConversations(PROVIDER);
    expect(inbox.threads.map((thread) => thread.id)).toEqual(["conv-newer", "conv-mine"]);
    expect(inbox.unreadTotal).toBe(2);
  });
});

describe("the customer opens a thread by naming a quote, not a provider", () => {
  it("opens the thread for a quote on their own request", async () => {
    state.conversations = [];
    const thread = await openCustomerConversation(CUSTOMER, "bid-1");

    expect(thread.requestId).toBe("request-1");
    expect(thread.otherPartyRole).toBe("provider");
    // The provider is read off the bid; the caller never named them.
    expect(state.conversations[0]!.providerUserId).toBe(PROVIDER);
    expect(state.conversations[0]!.customerUserId).toBe(CUSTOMER);
  });

  it("refuses a quote on somebody else's request", async () => {
    state.conversations = [];
    // `bid-2` is real, but it sits on customer-2's request.
    await expect(openCustomerConversation(CUSTOMER, "bid-2")).rejects.toMatchObject({
      status: 404,
    });
    expect(state.conversations).toHaveLength(0);
  });

  it("refuses a withdrawn quote", async () => {
    state.conversations = [];
    await expect(openCustomerConversation(CUSTOMER, "bid-withdrawn")).rejects.toMatchObject({
      status: 404,
    });
    expect(state.conversations).toHaveLength(0);
  });

  it("refuses an id that is not a quote at all, without saying which it was", async () => {
    state.conversations = [];
    let message = "";
    try {
      await openCustomerConversation(CUSTOMER, "bid-does-not-exist");
    } catch (caught) {
      message = caught instanceof Error ? caught.message : String(caught);
    }
    // Same sentence as "not yours", so ids cannot be enumerated.
    expect(message).toMatch(/not on one of your requests/i);
  });

  it("converges on the thread the provider already opened", async () => {
    // `conv-mine` is that thread; opening from the other side must not fork it.
    const thread = await openCustomerConversation(CUSTOMER, "bid-1");
    expect(thread.id).toBe("conv-mine");
    expect(state.conversations).toHaveLength(2);
    expect(thread.otherPartyName).toBe(`Name ${PROVIDER}`);
  });

  it("gives both sides the same thread, described from their own point of view", async () => {
    const providerView = await openProviderConversation(PROVIDER, "request-1");
    const customerView = await openCustomerConversation(CUSTOMER, "bid-1");

    expect(providerView.id).toBe(customerView.id);
    expect(providerView.otherPartyRole).toBe("customer");
    expect(customerView.otherPartyRole).toBe("provider");
    // Unread is per-reader: the customer's own messages are not unread to them.
    expect(providerView.unreadCount).toBe(2);
    expect(customerView.unreadCount).toBe(0);
  });
});
