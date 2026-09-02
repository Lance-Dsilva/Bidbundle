import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Authorization and input handling at the customer inbox's route boundary.
 *
 * The services are faked on purpose: what these tests are about is the
 * boundary — who gets in, what the handler passes down, and what it refuses.
 * The property worth stating plainly is that **no handler reads an owner from
 * the request**. Every call below that tries to name a provider, a customer,
 * or a conversation owner is answered with the session's own data.
 *
 * These routes replace `/api/homeowner/conversations?other_user_id=…`, which
 * had no handler at all and would have taken the other party straight off the
 * query string.
 */

const state = vi.hoisted(() => ({
  clerkUserId: "clerk_homeowner" as string | null,
  role: "homeowner" as "homeowner" | "hoa_staff" | "provider",
  calls: [] as Array<{ name: string; args: unknown[] }>,
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: state.clerkUserId }),
}));

vi.mock("@/lib/server/auth-guard", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/auth-guard")>();
  return { ...actual, guardHoaMutation: async () => null };
});

vi.mock("@/lib/server/db", () => ({
  db: {
    user: {
      findUnique: async () => ({
        id: "bundleen-customer-a",
        clerkUserId: state.clerkUserId,
        email: "resident@example.com",
        fullName: "Sam Okafor",
        role: state.role,
        isVerified: true,
        adminAccess: null,
      }),
    },
  },
}));

function spy<T>(name: string, result: T) {
  return async (...args: unknown[]) => {
    state.calls.push({ name, args });
    return result;
  };
}

vi.mock("@/lib/server/conversations", () => ({
  listConversations: spy("listConversations", { threads: [], unreadTotal: 0 }),
  getConversation: spy("getConversation", { thread: {}, messages: [] }),
  sendConversationMessage: spy("sendConversationMessage", { id: "msg-1" }),
  markConversationRead: spy("markConversationRead", { markedRead: 2 }),
  openCustomerConversation: spy("openCustomerConversation", { id: "conv-1" }),
}));

import { GET as getInbox, POST as postInbox } from "@/app/api/homeowner/inbox/route";
import { GET as getThread } from "@/app/api/homeowner/inbox/[threadId]/route";
import { POST as postMessage } from "@/app/api/homeowner/inbox/[threadId]/messages/route";
import { POST as postRead } from "@/app/api/homeowner/inbox/[threadId]/read/route";

const SESSION_USER = "bundleen-customer-a";

function jsonRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function argsOf(name: string): unknown[] {
  return state.calls.find((call) => call.name === name)?.args ?? [];
}

beforeEach(() => {
  state.clerkUserId = "clerk_homeowner";
  state.role = "homeowner";
  state.calls = [];
});

describe("who may reach the customer inbox", () => {
  it("refuses an anonymous caller", async () => {
    state.clerkUserId = null;
    expect((await getInbox()).status).toBe(401);
    expect(state.calls).toEqual([]);
  });

  it("refuses a provider account", async () => {
    // Providers have their own inbox at `/api/provider/inbox`; reaching the
    // customer one would be a role confusion, even though the rows are shared.
    state.role = "provider";
    expect((await getInbox()).status).toBe(403);
    expect(state.calls).toEqual([]);
  });

  it("admits an HOA manager, who can be the customer on a request", async () => {
    state.role = "hoa_staff";
    expect((await getInbox()).status).toBe(200);
    expect(argsOf("listConversations")[0]).toBe(SESSION_USER);
  });
});

describe("the customer is the session, never the request", () => {
  it("lists only the session user's threads", async () => {
    await getInbox();
    expect(argsOf("listConversations")).toEqual([SESSION_USER]);
  });

  it("opening a thread accepts a bid id and nothing else", async () => {
    const response = await postInbox(
      jsonRequest("http://localhost/api/homeowner/inbox", {
        bidId: "bid-1",
        providerUserId: "victim",
        customerUserId: "victim",
      }),
    );
    expect(response.status).toBe(201);
    // The extra fields are dropped by the schema, not passed through.
    expect(argsOf("openCustomerConversation")).toEqual([SESSION_USER, "bid-1"]);
  });

  it("refuses to open a thread with no bid id", async () => {
    const response = await postInbox(
      jsonRequest("http://localhost/api/homeowner/inbox", { providerUserId: "victim" }),
    );
    expect(response.status).toBe(400);
    expect((await response.json()).fields).toHaveProperty("bidId");
    expect(argsOf("openCustomerConversation")).toEqual([]);
  });

  it("a thread read passes only the session user and the path id", async () => {
    await getThread(
      new Request("http://localhost/api/homeowner/inbox/conv-9?userId=someone-else"),
      { params: Promise.resolve({ threadId: "conv-9" }) },
    );
    expect(argsOf("getConversation").slice(0, 2)).toEqual([SESSION_USER, "conv-9"]);
    expect(JSON.stringify(argsOf("getConversation"))).not.toContain("someone-else");
  });

  it("marking read passes only the session user and the path id", async () => {
    const response = await postRead(
      new Request("http://localhost/api/homeowner/inbox/conv-3/read", { method: "POST" }),
      { params: Promise.resolve({ threadId: "conv-3" }) },
    );
    expect(response.status).toBe(200);
    expect(argsOf("markConversationRead")).toEqual([SESSION_USER, "conv-3"]);
  });
});

describe("input validation", () => {
  it("clamps an oversized transcript page instead of honouring it", async () => {
    await getThread(
      new Request("http://localhost/api/homeowner/inbox/conv-1?limit=100000&offset=-5"),
      { params: Promise.resolve({ threadId: "conv-1" }) },
    );
    expect(argsOf("getConversation")[2]).toEqual({ limit: 100, offset: 0 });
  });

  it("rejects an empty message rather than storing it", async () => {
    const response = await postMessage(
      jsonRequest("http://localhost/api/homeowner/inbox/conv-1/messages", { body: "   " }),
      { params: Promise.resolve({ threadId: "conv-1" }) },
    );
    expect(response.status).toBe(400);
    expect(argsOf("sendConversationMessage")).toEqual([]);
  });

  it("normalizes a message rather than storing control characters", async () => {
    await postMessage(
      jsonRequest("http://localhost/api/homeowner/inbox/conv-1/messages", {
        body: "  Is Friday  still\r\nok?  ",
      }),
      { params: Promise.resolve({ threadId: "conv-1" }) },
    );
    expect(argsOf("sendConversationMessage")[2]).toBe("Is Friday  still\nok?");
  });

  it("refuses a body that is not JSON", async () => {
    const response = await postMessage(
      new Request("http://localhost/api/homeowner/inbox/conv-1/messages", {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: "hello",
      }),
      { params: Promise.resolve({ threadId: "conv-1" }) },
    );
    expect(response.status).toBe(415);
    expect(argsOf("sendConversationMessage")).toEqual([]);
  });
});
