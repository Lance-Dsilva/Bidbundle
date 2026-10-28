// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import HomeownerRequestPage from "@/app/app/homeowner/request/page";

/**
 * The new-request page after the 404s.
 *
 * Three behaviours are asserted, all of which were broken in production: the
 * page reads eligibility before rendering a form, an ineligible homeowner is
 * told what to do instead of being handed a form the server will refuse, and a
 * failure produces a sentence rather than the raw `HTTP 404` the old
 * `apiFetch` error surfaced.
 */

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

const originalFetch = global.fetch;

const eligible = {
  canCreate: true,
  communityId: "community-1",
  communityName: "Oakwood Heights",
};

const created = {
  id: "request-1",
  title: "Pressure washing",
  categoryLabel: "Cleaning",
  communityName: "Oakwood Heights",
  budgetMinCents: 10_000,
  budgetMaxCents: 30_000,
};

function jsonOnce(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
  };
}

/** Fills the form with the acceptance-scenario values. */
function fillValidRequest() {
  fireEvent.change(screen.getByLabelText("Title"), {
    target: { value: "Pressure washing" },
  });
  fireEvent.click(screen.getByRole("radio", { name: "Cleaning" }));
  fireEvent.change(screen.getByLabelText("Description"), {
    target: { value: "Driveway and back patio." },
  });
  fireEvent.change(screen.getByLabelText("Min ($)"), { target: { value: "100" } });
  fireEvent.change(screen.getByLabelText("Max ($)"), { target: { value: "300" } });
}

beforeEach(() => {
  vi.restoreAllMocks();
  push.mockClear();
});

afterEach(() => {
  cleanup();
  global.fetch = originalFetch;
});

describe("new request page", () => {
  it("takes the form back to the owned requests list", async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonOnce({ eligibility: eligible })) as unknown as typeof fetch;
    render(<HomeownerRequestPage />);
    await screen.findByText("For Oakwood Heights");
    fireEvent.click(screen.getByRole("button", { name: "Back to my requests" }));
    expect(push).toHaveBeenCalledWith("/app/homeowner/requests");
  });

  it("offers the same canonical services as provider onboarding", async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonOnce({ requests: [], eligibility: eligible })) as unknown as typeof fetch;
    render(<HomeownerRequestPage />);
    await screen.findByText("For Oakwood Heights");
    const category = screen.getByRole("group", { name: /^Category/ });
    for (const [label, slug] of [
      ["Lawn care", "lawn"], ["Pool care", "pool_care"], ["Gutters", "gutter"],
      ["Landscaping", "landscaping"], ["Seasonal maintenance", "seasonal_maintenance"],
      ["Painting", "painting"], ["Pest control", "pest_control"],
    ]) {
      const choice = screen.getByRole("radio", { name: label });
      expect(category).toContainElement(choice);
      expect(choice).toHaveAttribute("value", slug);
      fireEvent.click(choice);
      expect(choice).toBeChecked();
    }
  });

  it("asks the canonical endpoint for eligibility, and nothing else, on load", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonOnce({ requests: [], eligibility: eligible }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<HomeownerRequestPage />);
    await screen.findByText("For Oakwood Heights");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/homeowner/requests");
    // The dashboard fetch that 404'd is gone.
    for (const call of fetchMock.mock.calls) {
      expect(String(call[0])).not.toContain("/api/homeowner/dashboard");
      expect(String(call[0])).not.toBe("/api/requests");
    }
  });

  it("explains the allowed next action instead of showing a form that can only fail", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      jsonOnce({
        requests: [],
        eligibility: {
          canCreate: false,
          reason: "hoa_resident",
          message: "Your home is in an HOA, so services are arranged by your HOA manager.",
          actionLabel: "Open your community",
          actionPath: "/app/homeowner/community",
        },
      }),
    ) as unknown as typeof fetch;

    render(<HomeownerRequestPage />);

    expect(await screen.findByText(/arranged by your HOA manager/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open your community" })).toHaveAttribute(
      "href",
      "/app/homeowner/community",
    );
    expect(screen.queryByLabelText("Title")).not.toBeInTheDocument();
  });

  it("posts whole cents to the canonical endpoint and shows the created request", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonOnce({ requests: [], eligibility: eligible }))
      .mockResolvedValueOnce(jsonOnce({ request: created }, { status: 201 }));
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<HomeownerRequestPage />);
    await screen.findByText("For Oakwood Heights");
    fillValidRequest();
    fireEvent.click(screen.getByRole("button", { name: /Post request/ }));

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Request posted"),
    );

    expect(screen.getByRole("link", { name: "View your request" })).toHaveAttribute(
      "href", `/app/homeowner/requests#request-${encodeURIComponent(created.id)}`,
    );

    const [url, init] = fetchMock.mock.calls[1]!;
    expect(url).toBe("/api/homeowner/requests");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      title: "Pressure washing",
      category: "cleaning",
      description: "Driveway and back patio.",
      budgetMinCents: 10_000,
      budgetMaxCents: 30_000,
    });
    // Identity and lifecycle are never claimed by the browser.
    expect(body).not.toHaveProperty("status");
    expect(body).not.toHaveProperty("neighborhood");
    expect(body).not.toHaveProperty("createdByUserId");
  });

  it("shows only real values in the success state", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(jsonOnce({ requests: [], eligibility: eligible }))
      .mockResolvedValueOnce(jsonOnce({ request: created }, { status: 201 })) as unknown as typeof fetch;

    render(<HomeownerRequestPage />);
    await screen.findByText("For Oakwood Heights");
    fillValidRequest();
    fireEvent.click(screen.getByRole("button", { name: /Post request/ }));

    await screen.findByRole("status");
    const body = document.body.textContent ?? "";
    expect(body).toContain("Oakwood Heights");
    expect(body).toContain("$100");
    expect(body).toContain("$300");
    // The invented progress numbers the old screen displayed are gone.
    expect(body).not.toMatch(/of 8 neighbors joined/);
    expect(body).not.toMatch(/32h 16m/);
  });

  it("renders a sentence, never a raw HTTP status, when the server refuses", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(jsonOnce({ requests: [], eligibility: eligible }))
      .mockResolvedValueOnce(
        jsonOnce(
          { error: "Your neighbourhood membership is still being reviewed.", reason: "membership_pending" },
          { ok: false, status: 409 },
        ),
      )
      .mockResolvedValue(jsonOnce({ requests: [], eligibility: eligible })) as unknown as typeof fetch;

    render(<HomeownerRequestPage />);
    await screen.findByText("For Oakwood Heights");
    fillValidRequest();
    fireEvent.click(screen.getByRole("button", { name: /Post request/ }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("still being reviewed");
    expect(alert.textContent).not.toMatch(/^HTTP \d+$/);
  });

  it("reports invalid budgets inline without contacting the server", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonOnce({ requests: [], eligibility: eligible }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<HomeownerRequestPage />);
    await screen.findByText("For Oakwood Heights");
    fillValidRequest();
    fireEvent.change(screen.getByLabelText("Min ($)"), { target: { value: "300" } });
    fireEvent.change(screen.getByLabelText("Max ($)"), { target: { value: "100" } });
    fireEvent.click(screen.getByRole("button", { name: /Post request/ }));

    expect(
      await screen.findByText("The maximum budget cannot be below the minimum."),
    ).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter((call) => call[1]?.method === "POST")).toHaveLength(
      0,
    );
  });

  it("keeps every entered value after a failed submission", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(jsonOnce({ requests: [], eligibility: eligible }))
      .mockResolvedValueOnce(
        jsonOnce({ error: "Something went wrong." }, { ok: false, status: 500 }),
      ) as unknown as typeof fetch;

    render(<HomeownerRequestPage />);
    await screen.findByText("For Oakwood Heights");
    fillValidRequest();
    fireEvent.click(screen.getByRole("button", { name: /Post request/ }));

    await screen.findByRole("alert");
    expect(screen.getByLabelText("Title")).toHaveValue("Pressure washing");
    expect(screen.getByLabelText("Description")).toHaveValue("Driveway and back patio.");
    expect(screen.getByLabelText("Min ($)")).toHaveValue(100);
    expect(screen.getByLabelText("Max ($)")).toHaveValue(300);
  });

  it("posts once when the button is clicked repeatedly", async () => {
    let resolvePost: ((value: unknown) => void) | undefined;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonOnce({ requests: [], eligibility: eligible }))
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolvePost = resolve as (value: unknown) => void;
          }),
      );
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<HomeownerRequestPage />);
    await screen.findByText("For Oakwood Heights");
    fillValidRequest();

    const button = screen.getByRole("button", { name: /Post request/ });
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);

    expect(fetchMock.mock.calls.filter((call) => call[1]?.method === "POST")).toHaveLength(
      1,
    );

    resolvePost!(jsonOnce({ request: created }, { status: 201 }));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Request posted"),
    );
  });
});
