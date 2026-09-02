import "server-only";

import { db } from "@/lib/server/db";
import { HoaWorkflowError } from "@/lib/server/hoa";
import { enqueueNotifications } from "@/lib/server/notifications";
import {
  MAX_INBOX_THREADS,
  MESSAGE_PAGE_SIZE,
} from "@/lib/validation/provider-console";

/**
 * Job conversations between a provider and the customer whose request they
 * quoted.
 *
 * Two rules hold every function in this file together:
 *
 * 1. **The pair is derived, never submitted.** A thread's customer is the
 *    request's creator and its provider is an account with a live bid or the
 *    award on that same request. There is no "message user X" entry point, so
 *    no caller can talk to a stranger by guessing an id.
 * 2. **Every read and write is participant-scoped.** Each query carries
 *    `OR: [{ providerUserId: userId }, { customerUserId: userId }]` in its
 *    `where`, so a conversation id belonging to somebody else resolves to
 *    nothing rather than to a permission check that could be forgotten.
 *
 * A non-participant is told the conversation "does not exist" rather than that
 * they may not see it: probing ids must not confirm which ones are real.
 */

/* ── Wire shapes ─────────────────────────────────────────────────────────── */

export type ConversationThread = {
  id: string;
  requestId: string;
  requestTitle: string;
  communityName: string;
  /** Display name of the participant who is *not* the caller. */
  otherPartyName: string;
  /** What the other party is to the caller. Drives the UI's labelling. */
  otherPartyRole: "customer" | "provider";
  lastMessagePreview: string | null;
  lastMessageAt: string | null;
  /** Messages the caller has not read yet. Never counts their own. */
  unreadCount: number;
};

export type ConversationMessageView = {
  id: string;
  conversationId: string;
  senderUserId: string;
  senderName: string;
  /** Resolved on the server so the browser never compares ids to decide sides. */
  isMine: boolean;
  body: string;
  readAt: string | null;
  createdAt: string;
};

export type ConversationPage = {
  thread: ConversationThread;
  /** Oldest-first, which is the order a transcript is read in. */
  messages: ConversationMessageView[];
  /** True when older messages exist before `messages[0]`. */
  hasMore: boolean;
  totalMessages: number;
};

/* ── Shared selection ────────────────────────────────────────────────────── */

const threadSelect = {
  id: true,
  requestId: true,
  providerUserId: true,
  customerUserId: true,
  lastMessageAt: true,
  request: {
    select: { title: true, community: { select: { name: true } } },
  },
  provider: { select: { fullName: true } },
  customer: { select: { fullName: true } },
} as const;

type ThreadRow = {
  id: string;
  requestId: string;
  providerUserId: string;
  customerUserId: string;
  lastMessageAt: Date | null;
  request: { title: string; community: { name: string } };
  provider: { fullName: string };
  customer: { fullName: string };
};

function toThread(
  row: ThreadRow,
  userId: string,
  extras: { lastMessagePreview: string | null; unreadCount: number },
): ConversationThread {
  const viewerIsProvider = row.providerUserId === userId;
  return {
    id: row.id,
    requestId: row.requestId,
    requestTitle: row.request.title,
    communityName: row.request.community.name,
    otherPartyName: viewerIsProvider ? row.customer.fullName : row.provider.fullName,
    otherPartyRole: viewerIsProvider ? "customer" : "provider",
    lastMessagePreview: extras.lastMessagePreview,
    lastMessageAt: row.lastMessageAt?.toISOString() ?? null,
    unreadCount: extras.unreadCount,
  };
}

/**
 * The single authorization gate. Every other function starts here.
 *
 * The participant test lives in the `where` clause rather than in a branch
 * afterwards, so there is no code path that loads a row first and checks
 * ownership second.
 */
async function requireParticipant(userId: string, conversationId: string): Promise<ThreadRow> {
  const row = await db.serviceConversation.findFirst({
    where: {
      id: conversationId,
      OR: [{ providerUserId: userId }, { customerUserId: userId }],
    },
    select: threadSelect,
  });
  if (!row) throw new HoaWorkflowError("That conversation does not exist.", 404);
  return row as ThreadRow;
}

/* ── Reads ───────────────────────────────────────────────────────────────── */

/**
 * The caller's inbox, most recently active first.
 *
 * Threads with no messages yet sort last rather than being hidden: a provider
 * who has just opened a thread should see it, empty, where they left it.
 */
export async function listConversations(
  userId: string,
  options: { limit?: number } = {},
): Promise<{ threads: ConversationThread[]; unreadTotal: number }> {
  const limit = Math.min(options.limit ?? MAX_INBOX_THREADS, MAX_INBOX_THREADS);

  const rows = await db.serviceConversation.findMany({
    where: { OR: [{ providerUserId: userId }, { customerUserId: userId }] },
    orderBy: [{ lastMessageAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
    take: limit,
    select: {
      ...threadSelect,
      // One message each for the preview, and the caller's unread tally. Both
      // are scoped to the thread ids this query already authorized.
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { body: true },
      },
      _count: {
        select: {
          messages: { where: { readAt: null, senderUserId: { not: userId } } },
        },
      },
    },
  });

  const threads = rows.map((row) =>
    toThread(row as unknown as ThreadRow, userId, {
      lastMessagePreview: row.messages[0]?.body ?? null,
      unreadCount: row._count.messages,
    }),
  );

  return {
    threads,
    unreadTotal: threads.reduce((sum, thread) => sum + thread.unreadCount, 0),
  };
}

/** Just the caller's unread total, for a badge. One indexed count, no rows. */
export async function countUnreadMessages(userId: string): Promise<number> {
  return db.conversationMessage.count({
    where: {
      readAt: null,
      senderUserId: { not: userId },
      conversation: { OR: [{ providerUserId: userId }, { customerUserId: userId }] },
    },
  });
}

/**
 * One thread's transcript.
 *
 * Paged from the newest backwards — which is how a chat is actually scrolled —
 * then reversed so the caller receives it oldest-first and can render it
 * without re-sorting.
 */
export async function getConversation(
  userId: string,
  conversationId: string,
  options: { limit?: number; offset?: number } = {},
): Promise<ConversationPage> {
  const row = await requireParticipant(userId, conversationId);
  const limit = options.limit ?? MESSAGE_PAGE_SIZE;
  const offset = options.offset ?? 0;

  const [total, unreadCount, newestFirst] = await Promise.all([
    db.conversationMessage.count({ where: { conversationId } }),
    db.conversationMessage.count({
      where: { conversationId, readAt: null, senderUserId: { not: userId } },
    }),
    db.conversationMessage.findMany({
      where: { conversationId },
      orderBy: { createdAt: "desc" },
      skip: offset,
      take: limit,
      select: {
        id: true,
        senderUserId: true,
        body: true,
        readAt: true,
        createdAt: true,
        sender: { select: { fullName: true } },
      },
    }),
  ]);

  const messages = [...newestFirst].reverse().map((message) => ({
    id: message.id,
    conversationId,
    senderUserId: message.senderUserId,
    senderName: message.sender.fullName,
    isMine: message.senderUserId === userId,
    body: message.body,
    readAt: message.readAt?.toISOString() ?? null,
    createdAt: message.createdAt.toISOString(),
  }));

  return {
    thread: toThread(row, userId, {
      lastMessagePreview: newestFirst[0]?.body ?? null,
      unreadCount,
    }),
    messages,
    hasMore: offset + newestFirst.length < total,
    totalMessages: total,
  };
}

/* ── Writes ──────────────────────────────────────────────────────────────── */

/**
 * Opens (or returns) the thread for one request and one provider.
 *
 * The caller names a *request*, not a person. Authorization is the business
 * relationship itself: the provider must hold a bid that was actually
 * submitted, or the award. A withdrawn bid does not open a new channel, though
 * it never closes one that already exists.
 */
export async function openProviderConversation(
  providerUserId: string,
  requestId: string,
): Promise<ConversationThread> {
  const existing = await db.serviceConversation.findUnique({
    where: { requestId_providerUserId: { requestId, providerUserId } },
    select: threadSelect,
  });
  // Opening a thread that already exists returns it as it stands — including
  // its unread count, so the caller is not told a reopened conversation is
  // empty when the customer has been waiting in it.
  if (existing) return describeThread(existing as ThreadRow, providerUserId);

  const request = await db.hoaServiceRequest.findFirst({
    where: {
      id: requestId,
      OR: [
        { bids: { some: { providerUserId, status: { in: ["submitted", "accepted"] } } } },
        { agreement: { providerUserId } },
      ],
    },
    select: { id: true, createdByUserId: true },
  });
  // Same answer for "no such request" and "you never quoted it": a provider
  // cannot enumerate other people's work by trying ids.
  if (!request) {
    throw new HoaWorkflowError("That request is not one you have quoted.", 404);
  }
  if (request.createdByUserId === providerUserId) {
    throw new HoaWorkflowError("You cannot open a conversation with yourself.", 409);
  }

  // `upsert` rather than `create`: two clicks, or both parties opening at
  // once, converge on the one row the unique pair allows.
  const created = await db.serviceConversation.upsert({
    where: { requestId_providerUserId: { requestId, providerUserId } },
    create: { requestId, providerUserId, customerUserId: request.createdByUserId },
    update: {},
    select: threadSelect,
  });

  return describeThread(created as ThreadRow, providerUserId);
}

/**
 * The customer's mirror of {@link openProviderConversation}.
 *
 * The caller names a *bid*, not a provider. The server reads the provider off
 * that bid and confirms the bid sits on a request this account created, so the
 * only providers reachable from here are ones who have already quoted the
 * caller's own work. Nothing in the request body identifies a person.
 */
export async function openCustomerConversation(
  customerUserId: string,
  bidId: string,
): Promise<ConversationThread> {
  const bid = await db.serviceBid.findFirst({
    where: {
      id: bidId,
      status: { in: ["submitted", "accepted"] },
      request: { createdByUserId: customerUserId },
    },
    select: { providerUserId: true, requestId: true },
  });
  // One answer for "no such bid" and "not your request": a customer cannot
  // enumerate other people's quotes by trying ids.
  if (!bid) throw new HoaWorkflowError("That quote is not on one of your requests.", 404);
  if (bid.providerUserId === customerUserId) {
    throw new HoaWorkflowError("You cannot open a conversation with yourself.", 409);
  }

  const conversation = await db.serviceConversation.upsert({
    where: {
      requestId_providerUserId: {
        requestId: bid.requestId,
        providerUserId: bid.providerUserId,
      },
    },
    create: {
      requestId: bid.requestId,
      providerUserId: bid.providerUserId,
      customerUserId,
    },
    update: {},
    select: threadSelect,
  });

  return describeThread(conversation as ThreadRow, customerUserId);
}

/** Fills in a thread's preview and unread count from its messages. */
async function describeThread(
  row: ThreadRow,
  userId: string,
): Promise<ConversationThread> {
  const [latest, unreadCount] = await Promise.all([
    db.conversationMessage.findFirst({
      where: { conversationId: row.id },
      orderBy: { createdAt: "desc" },
      select: { body: true },
    }),
    db.conversationMessage.count({
      where: { conversationId: row.id, readAt: null, senderUserId: { not: userId } },
    }),
  ]);

  return toThread(row, userId, { lastMessagePreview: latest?.body ?? null, unreadCount });
}

/**
 * Appends a message and notifies the other participant.
 *
 * The write and the thread's `lastMessageAt` move together in one transaction,
 * so an inbox can never show an ordering that the transcript contradicts.
 */
export async function sendConversationMessage(
  userId: string,
  conversationId: string,
  body: string,
): Promise<ConversationMessageView> {
  const row = await requireParticipant(userId, conversationId);
  const recipientUserId =
    row.providerUserId === userId ? row.customerUserId : row.providerUserId;

  const [message] = await db.$transaction([
    db.conversationMessage.create({
      data: { conversationId, senderUserId: userId, body },
      select: {
        id: true,
        senderUserId: true,
        body: true,
        readAt: true,
        createdAt: true,
        sender: { select: { fullName: true } },
      },
    }),
    db.serviceConversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: new Date() },
    }),
  ]);

  const senderName = message.sender.fullName;
  const recipientIsProvider = recipientUserId === row.providerUserId;
  await enqueueNotifications([
    {
      userId: recipientUserId,
      kind: "message",
      title: `New message from ${senderName}`,
      // The preview is the customer's or provider's own words, already
      // length-bounded on the way in and never rendered as markup.
      body: message.body.slice(0, 160),
      linkPath: recipientIsProvider
        ? `/app/provider/messages?thread=${conversationId}`
        : `/app/homeowner/chat?thread=${conversationId}`,
      // One notification per message, not per thread: a second message is a
      // genuinely new event.
      dedupeKey: `conversation-message:${message.id}`,
    },
  ]);

  return {
    id: message.id,
    conversationId,
    senderUserId: message.senderUserId,
    senderName,
    isMine: true,
    body: message.body,
    readAt: null,
    createdAt: message.createdAt.toISOString(),
  };
}

/**
 * Marks everything the *other* party sent as read.
 *
 * Deliberately cannot mark the caller's own messages read — that flag is the
 * recipient's receipt, and a sender writing it would make it a lie.
 */
export async function markConversationRead(
  userId: string,
  conversationId: string,
): Promise<{ markedRead: number }> {
  await requireParticipant(userId, conversationId);

  const result = await db.conversationMessage.updateMany({
    where: { conversationId, senderUserId: { not: userId }, readAt: null },
    data: { readAt: new Date() },
  });

  return { markedRead: result.count };
}
