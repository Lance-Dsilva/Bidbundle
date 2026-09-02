import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Authorization and input handling at the provider console's route boundary.
 *
 * The services are faked here on purpose: what these tests are about is the
 * boundary itself — who gets in, what the handler passes down, and what it
 * refuses. The one property worth stating plainly is that **no handler reads an
 * owner from the request**. Every call below that tries to name a provider,
 * a customer, or a conversation owner in the query string is answered with the
 * session's own data.
 */

type Row = Record<string, unknown>;

const state = vi.hoisted(() => ({
  clerkUserId: "clerk_provider" as string | null,
  role: "provider" as "provider" | "homeowner",
  accountStatus: "active" as "pending" | "active" | "suspended" | null,
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
        id: "bundleen-provider-a",
        clerkUserId: state.clerkUserId,
        email: "pro@example.com",
        fullName: "Pat Rivera",
        role: state.role,
        isVerified: true,
        adminAccess: null,
      }),
    },
    providerProfile: {
      findUnique: async () =>
        state.accountStatus ? { accountStatus: state.accountStatus } : null,
    },
  },
}));

function spy<T>(name: string, result: T) {
  return async (...args: unknown[]) => {
    state.calls.push({ name, args });
    return result;
  };
}

vi.mock("@/lib/server/provider-overview", () => ({
  getProviderOverview: spy("getProviderOverview", { companyName: "ProFix" } as Row),
}));

vi.mock("@/lib/server/provider-reviews", () => ({
  getProviderReviews: spy("getProviderReviews", { reviews: [], summary: {}, page: {} } as Row),
}));

vi.mock("@/lib/server/conversations", () => ({
  listConversations: spy("listConversations", { threads: [], unreadTotal: 0 }),
  getConversation: spy("getConversation", { thread: {}, messages: [] } as Row),
  sendConversationMessage: spy("sendConversationMessage", { id: "msg-1" } as Row),
  markConversationRead: spy("markConversationRead", { markedRead: 2 }),
  openProviderConversation: spy("openProviderConversation", { id: "conv-1" } as Row),
}));

import { GET as getOverview } from "@/app/api/provider/overview/route";
import { GET as getRatings } from "@/app/api/provider/ratings/route";
import { GET as getInbox, POST as postInbox } from "@/app/api/provider/inbox/route";
import { GET as getThread } from "@/app/api/provider/inbox/[threadId]/route";
import { POST as postMessage } from "@/app/api/provider/inbox/[threadId]/messages/route";
import { POST as postRead } from "@/app/api/provider/inbox/[threadId]/read/route";

const SESSION_USER = "bundleen-provider-a";

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
  state.clerkUserId = "clerk_provider";
  state.role = "provider";
  state.accountStatus = "active";
  state.calls = [];
});

describe("who may reach the provider console", () => {
  it("refuses an anonymous caller", async () => {
    state.clerkUserId = null;
    expect((await getOverview()).status).toBe(401);
    expect(state.calls).toEqual([]);
  });

  it("refuses a signed-in customer", async () => {
    state.role = "homeowner";
    expect((await getOverview()).status).toBe(403);
    expect((await getInbox()).status).toBe(403);
    expect(state.calls).toEqual([]);
  });

  it("refuses a provider role with no provider account behind it", async () => {
    state.accountStatus = null;
    const response = await getOverview();
    expect(response.status).toBe(409);
    expect(state.calls).toEqual([]);
  });

  it("admits a pending provider to their own (empty) console", async () => {
    state.accountStatus = "pending";
    expect((await getOverview()).status).toBe(200);
  });

  it("lets a suspended provider read but not write", async () => {
    state.accountStatus = "suspended";
    expect((await getOverview()).status).toBe(200);

    const response = await postMessage(
      jsonRequest("http://localhost/api/provider/inbox/conv-1/messages", { body: "hello" }),
      { params: Promise.resolve({ threadId: "conv-1" }) },
    );
    expect(response.status).toBe(403);
    expect(argsOf("sendConversationMessage")).toEqual([]);
  });
});

describe("the provider is the session, never the request", () => {
  it("overview ignores a providerId in the query string", async () => {
    await getOverview();
    expect(argsOf("getProviderOverview")[0]).toBe(SESSION_USER);
  });

  it("ratings ignores a providerId in the query string", async () => {
    await getRatings(new Request("http://localhost/api/provider/ratings?providerId=someone-else"));
    expect(argsOf("getProviderReviews")[0]).toBe(SESSION_USER);
    expect(JSON.stringify(argsOf("getProviderReviews"))).not.toContain("someone-else");
  });

  it("a thread read passes only the session user and the path id", async () => {
    await getThread(new Request("http://localhost/api/provider/inbox/conv-9?userId=someone-else"), {
      params: Promise.resolve({ threadId: "conv-9" }),
    });
    expect(argsOf("getConversation").slice(0, 2)).toEqual([SESSION_USER, "conv-9"]);
  });

  it("opening a thread accepts a request id and nothing else", async () => {
    const response = await postInbox(
      jsonRequest("http://localhost/api/provider/inbox", {
        requestId: "request-1",
        customerUserId: "victim",
        providerUserId: "victim",
      }),
    );
    expect(response.status).toBe(201);
    // The extra fields are dropped by the schema, not passed through.
    expect(argsOf("openProviderConversation")).toEqual([SESSION_USER, "request-1"]);
  });

  it("marking read passes only the session user and the path id", async () => {
    const response = await postRead(
      new Request("http://localhost/api/provider/inbox/conv-3/read", { method: "POST" }),
      { params: Promise.resolve({ threadId: "conv-3" }) },
    );
    expect(response.status).toBe(200);
    expect(argsOf("markConversationRead")).toEqual([SESSION_USER, "conv-3"]);
  });
});

describe("input validation", () => {
  it("clamps an oversized page request instead of honouring it", async () => {
    await getRatings(new Request("http://localhost/api/provider/ratings?limit=100000&offset=-5"));
    expect(argsOf("getProviderReviews")[1]).toEqual({ limit: 50, offset: 0 });
  });

  it("falls back to the default page size for unparseable values", async () => {
    await getRatings(new Request("http://localhost/api/provider/ratings?limit=abc&offset=NaN"));
    expect(argsOf("getProviderReviews")[1]).toEqual({ limit: 20, offset: 0 });
  });

  it("rejects an empty message with a field error rather than storing it", async () => {
    const response = await postMessage(
      jsonRequest("http://localhost/api/provider/inbox/conv-1/messages", { body: "   " }),
      { params: Promise.resolve({ threadId: "conv-1" }) },
    );
    expect(response.status).toBe(400);
    expect((await response.json()).fields).toHaveProperty("body");
    expect(argsOf("sendConversationMessage")).toEqual([]);
  });

  it("rejects a message longer than the ceiling", async () => {
    const response = await postMessage(
      jsonRequest("http://localhost/api/provider/inbox/conv-1/messages", { body: "x".repeat(4_001) }),
      { params: Promise.resolve({ threadId: "conv-1" }) },
    );
    expect(response.status).toBe(400);
    expect(argsOf("sendConversationMessage")).toEqual([]);
  });

  it("normalizes a message rather than storing control characters", async () => {
    await postMessage(
      jsonRequest("http://localhost/api/provider/inbox/conv-1/messages", {
        body: "  Friday  works\r\nfor me.  ",
      }),
      { params: Promise.resolve({ threadId: "conv-1" }) },
    );
    expect(argsOf("sendConversationMessage")[2]).toBe("Friday works\nfor me.");
  });

  it("refuses a body that is not JSON", async () => {
    const response = await postMessage(
      new Request("http://localhost/api/provider/inbox/conv-1/messages", {
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
