import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `POST /api/ai/chat` end to end: gate, rate limit, validation, the
 * streaming tool-call loop, and graceful failure. The individual tools are
 * mocked here (they have their own coverage in `ai-tools.test.ts`/
 * `ai-scope.test.ts`) so this suite stays focused on the route/orchestration
 * layer: auth, rate limiting, streaming protocol, and persistence.
 */

type FakeChunk = {
  choices: Array<{
    delta: { content?: string | null; tool_calls?: Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }> };
    finish_reason?: string | null;
  }>;
  usage?: { prompt_tokens: number; completion_tokens: number } | null;
};

function fakeStream(chunks: FakeChunk[]) {
  return {
    [Symbol.asyncIterator]: async function* () {
      for (const chunk of chunks) yield chunk;
    },
  };
}

const state = vi.hoisted(() => ({
  clerkUserId: null as string | null,
  role: "homeowner" as "homeowner" | "provider" | "admin",
  hasProfile: true,
  accessLevel: "owner" as "owner" | "admin" | null,
  guardFailure: null as { kind: "rate-limited"; retryAfterSeconds: number } | { kind: "unavailable" } | null,
  guardCalls: 0,
  openAiConfigured: true,
  /** Queue of fake streaming responses `chat.completions.create` returns, consumed one per call. */
  responses: [] as Array<FakeChunk[] | (() => never)>,
  createCalls: [] as unknown[],
  conversations: new Map<string, { id: string }>(),
  messages: [] as Array<{ id: string; conversationId: string; role: "user" | "assistant"; content: string; createdAt: Date }>,
  usageLogs: [] as Array<Record<string, unknown>>,
  toolCalls: [] as Array<{ name: string; args: string }>,
}));

let messageIdCounter = 0;

vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: state.clerkUserId }),
}));

vi.mock("@/lib/server/db", () => ({
  db: {
    user: {
      findUnique: async () =>
        state.hasProfile
          ? {
              id: "user-db-1",
              clerkUserId: state.clerkUserId,
              email: "person@bundleen.test",
              fullName: "Test Person",
              role: state.role,
              isVerified: true,
              adminAccess:
                state.accessLevel && state.role === "admin"
                  ? { email: "person@bundleen.test", level: state.accessLevel, status: "active" }
                  : null,
            }
          : null,
    },
    aiConversation: {
      upsert: async ({ where }: { where: { userId_contextKey: { userId: string } } }) => {
        const userId = where.userId_contextKey.userId;
        const existing = state.conversations.get(userId);
        if (existing) return existing;
        const created = { id: `conv-${userId}` };
        state.conversations.set(userId, created);
        return created;
      },
      update: async () => ({}),
    },
    aiMessage: {
      findMany: async ({ where }: { where: { conversationId: string } }) =>
        state.messages
          .filter((m) => m.conversationId === where.conversationId)
          .map((m) => ({ role: m.role, content: m.content })),
      create: async ({ data }: { data: { conversationId: string; role: "user" | "assistant"; content: string } }) => {
        messageIdCounter += 1;
        const row = { id: `msg-${messageIdCounter}`, createdAt: new Date(), ...data };
        state.messages.push(row);
        return row;
      },
    },
    aiUsageLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        state.usageLogs.push(data);
        return data;
      },
    },
  },
}));

vi.mock("@/lib/server/auth-guard", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/auth-guard")>();
  return {
    ...actual,
    guardAiChat: async () => {
      state.guardCalls += 1;
      return state.guardFailure;
    },
  };
});

vi.mock("@/lib/server/ai/openai-client", () => ({
  isAiConfigured: () => state.openAiConfigured,
  getAiModel: () => "gpt-4o-mini-test",
  getOpenAiClient: () =>
    state.openAiConfigured
      ? {
          chat: {
            completions: {
              create: async (params: unknown) => {
                state.createCalls.push(params);
                const next = state.responses.shift();
                if (!next) throw new Error("no fake response queued");
                if (typeof next === "function") return next();
                return fakeStream(next);
              },
            },
          },
        }
      : null,
}));

vi.mock("@/lib/server/ai/tools", () => ({
  AI_TOOLS: [],
  buildOpenAiTools: () => [{ type: "function", function: { name: "get_service_requests", description: "", parameters: {} } }],
  runTool: async (name: string, _scope: unknown, args: string) => {
    state.toolCalls.push({ name, args });
    return { data: { requests: [] }, sources: [{ type: "data", label: "Service requests", href: "/app/homeowner/bids" }] };
  },
}));

const { POST } = await import("@/app/api/ai/chat/route");

function chatRequest(body: unknown): Request {
  return new Request("https://bundleen.example/api/ai/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function readNdjson(response: Response): Promise<Array<Record<string, unknown>>> {
  const text = await response.text();
  return text
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}

function textOnlyResponse(text: string): FakeChunk[] {
  return [
    { choices: [{ delta: { content: text }, finish_reason: null }] },
    { choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 42, completion_tokens: 7 } },
  ];
}

beforeEach(() => {
  state.clerkUserId = "clerk_1";
  state.role = "homeowner";
  state.hasProfile = true;
  state.accessLevel = "owner";
  state.guardFailure = null;
  state.guardCalls = 0;
  state.openAiConfigured = true;
  state.responses = [];
  state.createCalls = [];
  state.conversations.clear();
  state.messages = [];
  state.usageLogs = [];
  state.toolCalls = [];
});

afterEach(() => vi.clearAllMocks());

describe("POST /api/ai/chat — gate and validation", () => {
  it("401s an anonymous caller before any OpenAI call", async () => {
    state.clerkUserId = null;
    const response = await POST(chatRequest({ message: "hi" }));
    expect(response.status).toBe(401);
    expect(state.createCalls).toHaveLength(0);
  });

  it("409s a signed-in Clerk identity with no Bundleen profile", async () => {
    state.hasProfile = false;
    const response = await POST(chatRequest({ message: "hi" }));
    expect(response.status).toBe(409);
  });

  it("400s an empty message", async () => {
    const response = await POST(chatRequest({ message: "" }));
    expect(response.status).toBe(400);
  });

  it("400s a message over the length limit", async () => {
    const response = await POST(chatRequest({ message: "x".repeat(2001) }));
    expect(response.status).toBe(400);
  });

  it("415s a non-JSON body", async () => {
    const response = await POST(
      new Request("https://bundleen.example/api/ai/chat", { method: "POST", body: "hi" }),
    );
    expect(response.status).toBe(415);
  });
});

describe("POST /api/ai/chat — rate limiting", () => {
  it("429s before making an OpenAI call once the limit is reached, with Retry-After", async () => {
    state.guardFailure = { kind: "rate-limited", retryAfterSeconds: 37 };
    const response = await POST(chatRequest({ message: "hi" }));
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("37");
    expect(state.createCalls).toHaveLength(0);
  });

  it("503s with a graceful message when the rate limiter itself is unavailable", async () => {
    state.guardFailure = { kind: "unavailable" };
    const response = await POST(chatRequest({ message: "hi" }));
    expect(response.status).toBe(503);
  });
});

describe("POST /api/ai/chat — unconfigured model", () => {
  it("streams a graceful 'not configured' error instead of crashing when OPENAI_API_KEY is unset", async () => {
    state.openAiConfigured = false;
    const response = await POST(chatRequest({ message: "hi" }));
    expect(response.status).toBe(200);
    const events = await readNdjson(response);
    expect(events).toEqual([{ type: "error", message: "The AI assistant is not configured yet." }]);
  });
});

describe("POST /api/ai/chat — grounded answers per role", () => {
  it.each(["homeowner", "provider", "admin"] as const)(
    "streams a grounded answer and persists it for role=%s",
    async (role) => {
      state.role = role;
      state.responses = [textOnlyResponse("Here is what I found in your account.")];

      const response = await POST(chatRequest({ message: "What's going on with my requests?" }));
      expect(response.status).toBe(200);

      const events = await readNdjson(response);
      const deltas = events.filter((e) => e.type === "delta").map((e) => e.text).join("");
      expect(deltas).toBe("Here is what I found in your account.");
      const done = events.find((e) => e.type === "done");
      expect(done).toBeTruthy();

      const assistantRow = state.messages.find((m) => m.role === "assistant");
      expect(assistantRow?.content).toBe("Here is what I found in your account.");
      expect(state.usageLogs.at(-1)).toMatchObject({ success: true, role });
    },
  );

  it("runs a tool round before answering, and reports the tool name and its source", async () => {
    state.responses = [
      [
        {
          choices: [
            {
              delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "get_service_requests", arguments: "" } }] },
              finish_reason: null,
            },
          ],
        },
        {
          choices: [
            {
              delta: { tool_calls: [{ index: 0, function: { arguments: '{"communityId":"c1"}' } }] },
              finish_reason: "tool_calls",
            },
          ],
        },
      ],
      textOnlyResponse("You have no open requests right now."),
    ];

    const response = await POST(chatRequest({ message: "What's open right now?" }));
    const events = await readNdjson(response);

    expect(events.some((e) => e.type === "tool" && e.name === "get_service_requests")).toBe(true);
    expect(state.toolCalls).toEqual([{ name: "get_service_requests", args: '{"communityId":"c1"}' }]);
    const done = events.find((e) => e.type === "done") as { sources: Array<{ label: string }> } | undefined;
    expect(done?.sources).toEqual([{ type: "data", label: "Service requests", href: "/app/homeowner/bids" }]);
  });
});

describe("POST /api/ai/chat — model failure", () => {
  it("streams a graceful error, logs failure, and persists no assistant message when the model call throws", async () => {
    state.responses = [
      () => {
        throw new Error("upstream exploded");
      },
    ];

    const response = await POST(chatRequest({ message: "hi" }));
    expect(response.status).toBe(200);
    const events = await readNdjson(response);
    expect(events).toEqual([
      { type: "error", message: "Something went wrong generating a response. Please try again." },
    ]);

    expect(state.messages.some((m) => m.role === "assistant")).toBe(false);
    expect(state.usageLogs.at(-1)).toMatchObject({ success: false });
  });
});
