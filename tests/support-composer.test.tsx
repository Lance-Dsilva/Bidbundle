// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { SupportCenter } from "@/components/support/SupportCenter";

/**
 * What the customer experiences when the support composer fails.
 *
 * During the outage the page said "Something went wrong on our end" and left
 * the customer with no reference to quote and — on some paths — a cleared form.
 * These assert the three things that make a failed send survivable: the typing
 * stays, the message is a sentence rather than a status code, and a second
 * click cannot open a second ticket.
 */

const originalFetch = global.fetch;

function ticket(number: string) {
  return {
    id: "ticket-1",
    ticketNumber: number,
    subject: "Cannot sign in",
    category: "account",
    status: "new",
    messageCount: 1,
    lastActivityAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  };
}

/** Fills the composer with a valid ticket. */
async function openComposer() {
  fireEvent.click(await screen.findByRole("button", { name: "New request" }));
  fireEvent.change(screen.getByPlaceholderText("A one-line summary"), {
    target: { value: "Cannot sign in" },
  });
  fireEvent.change(
    screen.getByPlaceholderText(
      "What happened, what you expected, and anything you already tried.",
    ),
    { target: { value: "It keeps rejecting my password." } },
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  cleanup();
  global.fetch = originalFetch;
});

describe("support composer", () => {
  it("keeps the subject, topic, and details after a failed submission", async () => {
    const fetchMock = vi
      .fn()
      // Initial list load.
      .mockResolvedValueOnce({ ok: true, json: async () => ({ tickets: [] }) })
      // The failed send.
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({
          error: "Something went wrong on our end and your request was not saved.",
          reference: "A1B2C3D4E5F6",
        }),
      });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<SupportCenter />);
    await openComposer();
    const topic = screen.getByRole("combobox") as HTMLSelectElement;
    fireEvent.change(topic, { target: { value: "billing" } });

    fireEvent.click(screen.getByRole("button", { name: "Send request" }));

    await screen.findByRole("alert");
    expect(screen.getByDisplayValue("Cannot sign in")).toBeInTheDocument();
    expect(
      screen.getByDisplayValue("It keeps rejecting my password."),
    ).toBeInTheDocument();
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("billing");
  });

  it("shows the server's reference so support can find the log line", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ tickets: [] }) })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error: "Something went wrong.", reference: "A1B2C3D4E5F6" }),
      }) as unknown as typeof fetch;

    render(<SupportCenter />);
    await openComposer();
    fireEvent.click(screen.getByRole("button", { name: "Send request" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("A1B2C3D4E5F6");
  });

  it("renders per-field errors from a 400 rather than one blanket message", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ tickets: [] }) })
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({
          error: "Please check the highlighted fields.",
          fields: { subject: "Add a short subject." },
        }),
      }) as unknown as typeof fetch;

    render(<SupportCenter />);
    await openComposer();
    fireEvent.click(screen.getByRole("button", { name: "Send request" }));

    expect(await screen.findByText("Add a short subject.")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("A one-line summary")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });

  it("never displays a bare HTTP status when the server sends no message", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ tickets: [] }) })
      .mockResolvedValueOnce({
        ok: false,
        status: 502,
        json: async () => {
          throw new Error("not json");
        },
      }) as unknown as typeof fetch;

    render(<SupportCenter />);
    await openComposer();
    fireEvent.click(screen.getByRole("button", { name: "Send request" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/still here/i);
    expect(alert.textContent).not.toBe("HTTP 502");
  });

  it("sends exactly one request when the button is clicked twice in a row", async () => {
    let resolveSend: ((value: unknown) => void) | undefined;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ tickets: [] }) })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSend = resolve as (value: unknown) => void;
          }),
      )
      .mockResolvedValue({ ok: true, json: async () => ({ tickets: [] }) });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<SupportCenter />);
    await openComposer();

    const button = screen.getByRole("button", { name: "Send request" });
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);

    // One load + one send, no matter how many clicks landed.
    expect(fetchMock.mock.calls.filter((call) => call[1]?.method === "POST")).toHaveLength(
      1,
    );

    resolveSend!({
      ok: true,
      status: 201,
      json: async () => ({ ticket: ticket("BDL-001000") }),
    });
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("BDL-001000"),
    );
  });

  it("clears the composer and refreshes the list on success", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ tickets: [] }) })
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({ ticket: ticket("BDL-001001") }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ tickets: [ticket("BDL-001001")] }),
      });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<SupportCenter />);
    await openComposer();
    fireEvent.click(screen.getByRole("button", { name: "Send request" }));

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("BDL-001001"),
    );
    // The list was re-read, so the new ticket is visible without a reload.
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(screen.queryByPlaceholderText("A one-line summary")).not.toBeInTheDocument();
  });
});
