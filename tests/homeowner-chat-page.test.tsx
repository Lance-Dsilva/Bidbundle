// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import HomeownerChat from "@/app/app/homeowner/chat/page";

/**
 * The customer's messages screen, against the conversation API that now exists.
 *
 * Before this, the page called three endpoints that had no Route Handler and
 * showed an empty inbox indistinguishable from a genuinely empty one — plus two
 * sections (group chats, the neighbourhood channel) that no table has ever
 * backed. What matters now is that each state says what it is, that opening a
 * thread costs one request per resource, and that the removed sections stay
 * removed rather than coming back as inert chrome.
 */

/** The `?thread=` deep link "Message provider" lands on. Empty by default. */
const search = { value: "" };

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(search.value),
}));

const originalFetch = global.fetch;

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
  } as unknown as Response;
}

function stubFetch(handler: (url: string, init?: RequestInit) => unknown) {
  const calls: string[] = [];
  global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push(String(input));
    return handler(String(input), init) as Response;
  }) as unknown as typeof fetch;
  return calls;
}

const oneThread = {
  threads: [
    {
      id: "conv-1",
      requestId: "request-1",
      requestTitle: "Autumn gutter clear",
      communityName: "Oakwood Heights",
      otherPartyName: "ProFix Plumbing",
      otherPartyRole: "provider",
      lastMessagePreview: "Friday works for us.",
      lastMessageAt: "2026-08-20T09:00:00.000Z",
      unreadCount: 1,
    },
  ],
  unreadTotal: 1,
};

const transcript = {
  thread: oneThread.threads[0],
  messages: [
    {
      id: "m1",
      conversationId: "conv-1",
      senderUserId: "provider-1",
      senderName: "ProFix Plumbing",
      isMine: false,
      body: "Friday works for us.",
      readAt: null,
      createdAt: "2026-08-20T09:00:00.000Z",
    },
  ],
  hasMore: false,
  totalMessages: 1,
};

function conversationServer(onPost?: (url: string) => unknown) {
  return (url: string, init?: RequestInit) => {
    if (init?.method === "POST" && onPost) return onPost(url);
    if (url.endsWith("/api/homeowner/inbox")) return jsonResponse(oneThread);
    if (url.endsWith("/read")) return jsonResponse({ markedRead: 1 });
    return jsonResponse(transcript);
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  search.value = "";
  global.fetch = originalFetch;
});

describe("homeowner chat page states", () => {
  it("says how a conversation starts, and offers no unbacked channels", async () => {
    stubFetch(() => jsonResponse({ threads: [], unreadTotal: 0 }));
    render(<HomeownerChat />);

    expect(await screen.findByText(/Open one from a quote on your bids page/)).toBeInTheDocument();
    expect(screen.getByText("No conversation open")).toBeInTheDocument();

    // The two surfaces with no table behind them are gone, not stubbed.
    expect(screen.queryByText(/Group conversations/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Your neighbourhood/)).not.toBeInTheDocument();
    expect(screen.queryByText(/General community channel/)).not.toBeInTheDocument();
  });

  it("opens a thread, marks it read, and requests each resource once", async () => {
    const calls = stubFetch(conversationServer());
    render(<HomeownerChat />);

    expect(await screen.findByText("Friday works for us.")).toBeInTheDocument();
    await waitFor(() => expect(calls).toContain("/api/homeowner/inbox/conv-1/read"));

    expect(calls).toEqual([
      "/api/homeowner/inbox",
      "/api/homeowner/inbox/conv-1",
      "/api/homeowner/inbox/conv-1/read",
    ]);
  });

  it("states an inbox failure once, with a retry, and does not loop", async () => {
    const calls = stubFetch(() =>
      jsonResponse({ error: "We could not reach the server." }, { ok: false, status: 503 }),
    );
    render(<HomeownerChat />);

    expect(await screen.findByRole("alert")).toHaveTextContent("We could not reach the server.");
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(calls).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(calls).toHaveLength(2));
  });
});
