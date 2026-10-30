// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { ProviderServiceAreasPanel } from "@/components/provider/ProviderServiceAreasPanel";

/**
 * Service-area management after the layout rework.
 *
 * The redesign was a hierarchy correction, not a behaviour change, so these
 * tests are about the behaviour staying put: selecting an area moves the
 * editor onto it, removal asks first, and what gets sent to
 * `/api/provider/service-areas` is the draft the provider actually adjusted —
 * radius included, and never an id the browser invented.
 *
 * `NEXT_PUBLIC_GEOAPIFY_API_KEY` is unset in tests, so the editor renders its
 * "map lookup is not configured" state and Leaflet is never imported. The
 * panel's own state, requests, and payloads are what is under test here.
 */

const originalFetch = global.fetch;

const AREAS = [
  {
    id: "area-1",
    label: "North Austin",
    centerLatitude: 30.4,
    centerLongitude: -97.7,
    radiusMiles: 15,
    isPrimary: true,
    formattedAddress: "North Austin, TX",
    locality: "Austin",
    region: "TX",
    postalCode: "78758",
    countryCode: "us",
    status: "active" as const,
  },
  {
    id: "area-2",
    label: "Round Rock",
    centerLatitude: 30.5,
    centerLongitude: -97.6,
    radiusMiles: 8,
    isPrimary: false,
    formattedAddress: "Round Rock, TX",
    locality: "Round Rock",
    region: "TX",
    postalCode: "78664",
    countryCode: "us",
    status: "active" as const,
  },
];

type Call = { url: string; method: string; body: unknown };

function stubFetch(handler?: (call: Call) => unknown) {
  const calls: Call[] = [];
  global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: Call = {
      url: String(input),
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(call);

    const override = handler?.(call);
    if (override !== undefined) return override as Response;

    return {
      ok: true,
      status: 200,
      json: async () => ({ areas: AREAS }),
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return calls;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  global.fetch = originalFetch;
});

describe("provider service areas panel", () => {
  it("lists saved areas compactly, switches the editor, and confirms before removing", async () => {
    const calls = stubFetch((call) =>
      call.method === "DELETE"
        ? ({ ok: true, status: 200, json: async () => ({ ok: true }) } as unknown as Response)
        : undefined,
    );
    render(<ProviderServiceAreasPanel />);

    // Both areas, with the primary badge and a location + radius line.
    expect(await screen.findByText("North Austin")).toBeInTheDocument();
    expect(screen.getByText("Round Rock")).toBeInTheDocument();
    expect(screen.getByText("Primary")).toBeInTheDocument();
    expect(screen.getByText("Austin, TX · 15 mi")).toBeInTheDocument();

    // The primary area is selected on load; picking the other moves the editor.
    const roundRock = screen.getByRole("button", { name: "Edit Round Rock" }).closest("li")!;
    expect(within(roundRock).getByRole("button", { name: "Edit" })).toBeInTheDocument();
    fireEvent.click(within(roundRock).getByRole("button", { name: "Edit" }));
    await waitFor(() =>
      expect(within(roundRock).getByRole("button", { name: "Editing" })).toBeInTheDocument(),
    );

    // Removal is a two-step: nothing is sent until the second confirmation.
    fireEvent.click(within(roundRock).getByRole("button", { name: "Remove" }));
    expect(within(roundRock).getByText(/Requests only inside this circle/)).toBeInTheDocument();
    expect(calls.filter((call) => call.method === "DELETE")).toHaveLength(0);

    fireEvent.click(
      within(roundRock.querySelector("div.bg-red-50")!).getByRole("button", { name: "Remove" }),
    );
    await waitFor(() =>
      expect(calls.filter((call) => call.method === "DELETE")).toEqual([
        { url: "/api/provider/service-areas/area-2", method: "DELETE", body: undefined },
      ]),
    );
  });

  it("saves an edit as a PUT carrying the whole circle, keyed by the server's id", async () => {
    const calls = stubFetch((call) =>
      call.method === "PUT"
        ? ({
            ok: true,
            status: 200,
            json: async () => ({ area: AREAS[0] }),
          } as unknown as Response)
        : undefined,
    );
    render(<ProviderServiceAreasPanel />);
    await screen.findByText("North Austin");

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(calls.some((call) => call.method === "PUT")).toBe(true));
    const put = calls.find((call) => call.method === "PUT")!;
    // The saved radius and centre are the stored ones, sent verbatim — the
    // browser never recomputes coverage, it only reports the circle.
    expect(put.url).toBe("/api/provider/service-areas/area-1");
    expect(put.body).toEqual({
      label: "North Austin",
      centerLatitude: 30.4,
      centerLongitude: -97.7,
      radiusMiles: 15,
      formattedAddress: "North Austin, TX",
      locality: "Austin",
      region: "TX",
      postalCode: "78758",
      countryCode: "us",
    });
    // No owner field: the session decides whose area this is.
    expect(JSON.stringify(put.body)).not.toMatch(/providerUserId|userId|isPrimary/);
  });

  it("adds a new area as a POST seeded from the primary circle", async () => {
    const calls = stubFetch((call) =>
      call.method === "POST"
        ? ({
            ok: true,
            status: 201,
            json: async () => ({ area: { ...AREAS[1], id: "area-3", label: "South" } }),
          } as unknown as Response)
        : undefined,
    );
    render(<ProviderServiceAreasPanel />);
    await screen.findByText("North Austin");

    fireEvent.click(screen.getByRole("button", { name: "Add area" }));
    expect(screen.getByText("New service area")).toBeInTheDocument();
    expect(screen.getByText("Unsaved")).toBeInTheDocument();

    // A new draft has no name yet, so saving is refused until it has one.
    expect(screen.getByRole("button", { name: "Save new area" })).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Area name"), { target: { value: "South" } });
    fireEvent.click(screen.getByRole("button", { name: "Save new area" }));

    await waitFor(() => expect(calls.some((call) => call.method === "POST")).toBe(true));
    const post = calls.find((call) => call.method === "POST")!;
    expect(post.url).toBe("/api/provider/service-areas");
    expect(post.body).toMatchObject({ label: "South", radiusMiles: 15 });
  });
  it("retains a rejected edit and retries the exact draft without claiming it was saved", async () => {
    let attempts = 0;
    const canonical = { ...AREAS[0], label: "Canonical saved area", radiusMiles: 23 };
    const calls = stubFetch((call) => {
      if (call.method === "GET" && attempts > 1) {
        return { ok: true, status: 200, json: async () => ({ areas: [canonical, AREAS[1]] }) } as Response;
      }
      if (call.method !== "PUT") return undefined;
      attempts += 1;
      return {
        ok: attempts > 1,
        status: attempts === 1 ? 503 : 200,
        json: async () => attempts === 1 ? { error: "Temporarily unavailable" } : { area: canonical },
      } as unknown as Response;
    });
    render(<ProviderServiceAreasPanel />);
    await screen.findByText("North Austin");
    fireEvent.change(screen.getByLabelText("Area name"), { target: { value: "KEEP MY UNSAVED NAME" } });
    fireEvent.change(screen.getByLabelText("Service radius"), { target: { value: "23" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Temporarily unavailable");
    expect(screen.getByLabelText("Area name")).toHaveValue("KEEP MY UNSAVED NAME");
    expect(screen.getByLabelText("Service radius")).toHaveValue(23);
    expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Edit North Austin" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit KEEP MY UNSAVED NAME" })).not.toBeInTheDocument();
    expect(screen.getByText(/Last saved:/)).toHaveTextContent("15 miles");
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(calls.filter((call) => call.method === "PUT")).toHaveLength(2));
    const puts = calls.filter((call) => call.method === "PUT");
    expect(puts[0].body).toMatchObject({ label: "KEEP MY UNSAVED NAME", radiusMiles: 23 });
    expect(puts[1].body).toEqual(puts[0].body);
    expect(await screen.findByRole("button", { name: "Edit Canonical saved area" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("Area name")).toHaveValue("Canonical saved area"));
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
  });

  it("locks draft transitions and duplicate writes while a save is pending", async () => {
    let resolveSave!: (response: Response) => void;
    const pendingSave = new Promise<Response>((resolve) => { resolveSave = resolve; });
    const calls = stubFetch((call) => call.method === "PUT" ? pendingSave : undefined);
    render(<ProviderServiceAreasPanel />);
    await screen.findByText("North Austin");
    fireEvent.click(screen.getByRole("button", { name: "Edit Round Rock" }));
    fireEvent.change(screen.getByLabelText("Area name"), { target: { value: "Changed Round Rock" } });
    const north = screen.getByRole("button", { name: "Edit North Austin" }).closest("li")!;
    fireEvent.click(within(north).getByRole("button", { name: "Remove" }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add area" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Make primary" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Edit North Austin" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Keep it" })).toBeDisabled();
    expect(screen.getByLabelText("Area name")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Saving…" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit North Austin" }));
    expect(screen.getByLabelText("Area name")).toHaveValue("Changed Round Rock");
    expect(calls.filter((call) => call.method !== "GET")).toHaveLength(1);
    await act(async () => { resolveSave({ ok: true, status: 200, json: async () => ({ area: AREAS[1] }) } as Response); await pendingSave; });
    await waitFor(() => expect(screen.getByRole("button", { name: "Save changes" })).toBeEnabled());
  });

});
