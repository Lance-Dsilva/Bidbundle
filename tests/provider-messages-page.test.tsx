// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { ProviderSessionProvider } from "@/components/provider/ProviderSessionContext";
import ProviderMessagesPage from "@/app/app/provider/messages/page";

/**
 * The messages screen, against the conversation API that now exists.
 *
 * Before this, the page called `/api/provider/conversations`, got a 404, and
 * showed an empty inbox that was indistinguishable from a genuinely empty one.
 * What matters here is that each state says what it is, that opening a thread
 * costs exactly one request per resource, and that a refused send hands the
 * provider their words back instead of swallowing them.
 */

/** The `?thread=` deep link "Message customer" lands on. Empty by default. */
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

function renderPage() {
  return render(
    <ProviderSessionProvider
      seed={{ companyName: "ProFix", accountStatus: "active", unreadMessages: 3 }}
    >
      <ProviderMessagesPage />
    </ProviderSessionProvider>,
  );
}

const olderThread = {
  id: "conv-0",
  requestId: "request-0",
  requestTitle: "Spring hedge trim",
  communityName: "Oakwood",
  otherPartyName: "James Kaur",
  otherPartyRole: "customer",
  lastMessagePreview: "Thanks!",
  lastMessageAt: "2026-07-01T09:00:00.000Z",
  unreadCount: 0,
};

const oneThread = {
  threads: [
    {
      id: "conv-1",
      requestId: "request-1",
      requestTitle: "Autumn gutter clear",
      communityName: "Cedar Park",
      otherPartyName: "Sarah Mills",
      otherPartyRole: "customer",
      lastMessagePreview: "Can you start Friday?",
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
      senderUserId: "customer-1",
      senderName: "Sarah Mills",
      isMine: false,
      body: "Can you start Friday?",
      readAt: null,
      createdAt: "2026-08-20T09:00:00.000Z",
    },
  ],
  hasMore: false,
  totalMessages: 1,
};

/** Answers the inbox, the transcript, and the read receipt; POSTs are opt-in. */
function conversationServer(onPost?: (url: string) => unknown) {
  return (url: string, init?: RequestInit) => {
    if (init?.method === "POST" && onPost) return onPost(url);
    if (url.endsWith("/api/provider/inbox")) return jsonResponse(oneThread);
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

describe("provider messages page states", () => {
  it("explains how a conversation starts when there are none", async () => {
    stubFetch(() => jsonResponse({ threads: [], unreadTotal: 0 }));
    renderPage();

    expect(screen.getByText("Loading inbox…")).toBeInTheDocument();
    expect(
      await screen.findByText(/A thread opens once you have quoted a customer's request/),
    ).toBeInTheDocument();
    expect(screen.getByText("No conversation open")).toBeInTheDocument();
  });

  it("opens a thread, marks it read, and requests each resource once", async () => {
    const calls = stubFetch(conversationServer());
    renderPage();

    expect(await screen.findByText("Can you start Friday?")).toBeInTheDocument();
    await waitFor(() => expect(calls).toContain("/api/provider/inbox/conv-1/read"));

    // Exactly one request per resource for this navigation: the inbox, the
    // transcript, and the read receipt.
    expect(calls).toEqual([
      "/api/provider/inbox",
      "/api/provider/inbox/conv-1",
      "/api/provider/inbox/conv-1/read",
    ]);
  });

  it("follows the ?thread= deep link rather than the newest thread", async () => {
    // `conv-1` is the most recent, so this only passes if the link is honoured.
    search.value = "thread=conv-0";
    const calls = stubFetch((url, init) => {
      if (init?.method === "POST") return jsonResponse({ markedRead: 0 });
      if (url.endsWith("/api/provider/inbox")) {
        return jsonResponse({ threads: [...oneThread.threads, olderThread], unreadTotal: 1 });
      }
      return jsonResponse({ ...transcript, thread: olderThread, messages: [] });
    });
    renderPage();

    await waitFor(() => expect(calls).toContain("/api/provider/inbox/conv-0"));
    expect(calls).not.toContain("/api/provider/inbox/conv-1");
    expect(await screen.findByText("Spring hedge trim · Oakwood")).toBeInTheDocument();
  });

  it("keeps the draft and says why when a send is refused", async () => {
    stubFetch(
      conversationServer((url) =>
        url.endsWith("/messages")
          ? jsonResponse({ error: "Your provider account is suspended." }, { ok: false, status: 403 })
          : jsonResponse({ markedRead: 1 }),
      ),
    );
    renderPage();

    const composer = await screen.findByPlaceholderText("Reply to Sarah Mills…");
    fireEvent.change(composer, { target: { value: "On my way." } });
    fireEvent.click(screen.getByRole("button", { name: /Send/ }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Your provider account is suspended."),
    );
    expect(composer).toHaveValue("On my way.");
  });
});
