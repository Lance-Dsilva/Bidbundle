// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

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
});
