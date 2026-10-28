// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import HomeownerRequestPage from "@/app/app/homeowner/request/page";
import { CATEGORY_LABELS, SERVICE_CATEGORIES } from "@/lib/service-categories";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const originalFetch = global.fetch;
const eligible = { canCreate: true, communityId: "community-1", communityName: "Oakwood Heights" };
const created = {
  id: "request-1", title: "Clean the gutters", categoryLabel: "Gutters",
  communityName: "Oakwood Heights", budgetMinCents: 10000, budgetMaxCents: 30000,
};
const response = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });
const posts = (fetchMock: ReturnType<typeof vi.fn>) => fetchMock.mock.calls.filter((call) => call[1]?.method === "POST");

async function showPage(postResult?: () => Promise<unknown>) {
  const fetchMock = vi.fn().mockResolvedValueOnce(response({ eligibility: eligible }));
  if (postResult) fetchMock.mockImplementation(postResult);
  global.fetch = fetchMock as unknown as typeof fetch;
  render(<HomeownerRequestPage />);
  await screen.findByText("For Oakwood Heights");
  return fetchMock;
}

function fillOtherFields() {
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: " Clean the gutters " } });
  fireEvent.change(screen.getByLabelText("Description"), { target: { value: " Clear leaves from the gutters. " } });
  fireEvent.change(screen.getByLabelText("Min ($)"), { target: { value: "100" } });
  fireEvent.change(screen.getByLabelText("Max ($)"), { target: { value: "300" } });
}

beforeEach(() => vi.restoreAllMocks());
afterEach(() => { cleanup(); global.fetch = originalFetch; });

describe("required homeowner service category", () => {
  it("starts with a required native radio group before Title and offers every canonical service except Other", async () => {
    await showPage();
    const group = screen.getByRole("group", { name: /^Category/ });
    const radios = within(group).getAllByRole("radio");
    const expected = SERVICE_CATEGORIES.filter((category) => category !== "other");
    expect(radios).toHaveLength(expected.length);
    expect(group.compareDocumentPosition(screen.getByLabelText("Title")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    for (const category of expected) {
      const radio = within(group).getByRole("radio", { name: CATEGORY_LABELS[category] });
      expect(radio).toHaveAttribute("type", "radio");
      expect(radio).toHaveAttribute("value", category);
      expect(radio).toBeRequired();
      expect(radio).not.toBeChecked();
    }
    expect(within(group).queryByRole("radio", { name: "Other" })).not.toBeInTheDocument();
    expect(new Set(radios.map((radio) => radio.getAttribute("name"))).size).toBe(1);
    expect(radios[0]).toHaveAttribute("name");
  });

  it("blocks an otherwise valid request locally and associates a readable category error", async () => {
    const fetchMock = await showPage();
    fillOtherFields();
    fireEvent.click(screen.getByRole("button", { name: /Post request/ }));
    const group = screen.getByRole("group", { name: /^Category/ });
    expect(group).toHaveAttribute("aria-invalid", "true");
    const errorId = group.getAttribute("aria-describedby");
    expect(errorId).toBeTruthy();
    expect(document.getElementById(errorId!)).toHaveTextContent(/choose|select/i);
    expect(posts(fetchMock)).toHaveLength(0);
    expect(screen.getByRole("radio", { name: "Cleaning" })).toHaveFocus();
    fireEvent.click(screen.getByRole("radio", { name: "Gutters" }));
    expect(group).not.toHaveAttribute("aria-invalid", "true");
  });

  it.each([
    ["Lawn care", "lawn"], ["Gutters", "gutter"], ["Pool care", "pool_care"],
    ["Seasonal maintenance", "seasonal_maintenance"],
  ])("posts canonical %s selection at the real page fetch boundary", async (label, slug) => {
    const fetchMock = await showPage(async () => response({ request: created }, 201));
    fillOtherFields();
    fireEvent.click(screen.getByRole("radio", { name: label }));
    fireEvent.click(screen.getByRole("button", { name: /Post request/ }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Request posted"));
    expect(posts(fetchMock)).toHaveLength(1);
    const [url, init] = posts(fetchMock)[0]!;
    expect(url).toBe("/api/homeowner/requests");
    expect(init.credentials).toBe("same-origin");
    expect(JSON.parse(init.body)).toEqual({
      title: "Clean the gutters", category: slug, description: "Clear leaves from the gutters.",
      budgetMinCents: 10000, budgetMaxCents: 30000,
    });
  });

  it("locks category changes and duplicate submissions while pending, then resets selection for another request", async () => {
    let resolvePost!: (value: unknown) => void;
    const fetchMock = await showPage(() => new Promise((resolve) => { resolvePost = resolve; }));
    fillOtherFields();
    const gutters = screen.getByRole("radio", { name: "Gutters" });
    fireEvent.click(gutters);
    const submit = screen.getByRole("button", { name: /Post request/ });
    act(() => { fireEvent.click(submit); fireEvent.click(submit); });
    expect(submit).toBeDisabled();
    for (const radio of screen.getAllByRole("radio")) expect(radio).toBeDisabled();
    expect(gutters).toBeChecked();
    expect(posts(fetchMock)).toHaveLength(1);
    await act(async () => resolvePost(response({ request: created }, 201)));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Request posted"));
    fireEvent.click(screen.getByRole("button", { name: "Post another request" }));
    for (const radio of screen.getAllByRole("radio")) { expect(radio).not.toBeChecked(); expect(radio).not.toBeDisabled(); }
    fillOtherFields();
    fireEvent.click(screen.getByRole("button", { name: /Post request/ }));
    expect(posts(fetchMock)).toHaveLength(1);
    expect(screen.getByRole("group", { name: /^Category/ })).toHaveAttribute("aria-invalid", "true");
  });

  it.each(["server", "network", "invalid-json"])("retains the selected service and values after %s failure and allows retry", async (failure) => {
    const fail = async () => {
      if (failure === "network") throw new Error("offline");
      if (failure === "invalid-json") return { ok: false, status: 502, json: async () => { throw new Error("invalid JSON"); } };
      return response({ error: "Please try again." }, 500);
    };
    const fetchMock = await showPage(fail);
    fillOtherFields();
    fireEvent.click(screen.getByRole("radio", { name: "Gutters" }));
    fireEvent.click(screen.getByRole("button", { name: /Post request/ }));
    await screen.findByRole("alert");
    expect(screen.getByRole("radio", { name: "Gutters" })).toBeChecked();
    expect(screen.getByLabelText("Title")).toHaveValue(" Clean the gutters ");
    expect(screen.getByLabelText("Description")).toHaveValue(" Clear leaves from the gutters. ");
    expect(screen.getByLabelText("Min ($)")).toHaveValue(100);
    expect(screen.getByLabelText("Max ($)")).toHaveValue(300);
    expect(screen.getByRole("radio", { name: "Cleaning" })).not.toBeDisabled();
    fetchMock.mockResolvedValueOnce(response({ request: created }, 201));
    fireEvent.click(screen.getByRole("button", { name: /Post request/ }));
    await waitFor(() => expect(posts(fetchMock)).toHaveLength(2));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Request posted"));
  });
});
