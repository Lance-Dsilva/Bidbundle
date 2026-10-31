// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Only the renderer is stubbed: real Panel, Editor, and Geoapify URL/result
// handling run together. No tiles, credentials, or external requests are used.
const renderer = vi.hoisted(() => ({ lifecycle: [] as string[], dragHandlers: [] as ((event: { target: { getLatLng: () => { lat: number; lng: number } } }) => void)[] }));
vi.mock("leaflet", () => {
  const layer = () => ({ addTo() { return this; }, on(event: string, handler: typeof renderer.dragHandlers[number]) { if (event === "dragend") renderer.dragHandlers.push(handler); return this; }, remove() {}, setLatLng() {}, setRadius() {}, dragging: { enable() {}, disable() {} } });
  return { map: () => ({ stop() { renderer.lifecycle.push("stop"); return this; }, remove() { renderer.lifecycle.push("remove"); }, setView() {}, addLayer() { return this; } }), tileLayer: layer, marker: layer, circle: layer, divIcon: () => ({}) };
});

import { ProviderServiceAreaEditor, type ServiceAreaDraft } from "@/components/provider/ProviderServiceAreaEditor";
import { ProviderServiceAreasPanel } from "@/components/provider/ProviderServiceAreasPanel";
import { geoapifyConfig } from "@/lib/geoapify";

const originalKey = geoapifyConfig.apiKey;
const originalFetch = global.fetch;
const areas = [
  { id: "area-a", label: "Austin coverage", centerLatitude: 30.4, centerLongitude: -97.7, radiusMiles: 15, isPrimary: true, formattedAddress: "Austin, TX", locality: "Austin", region: "TX", postalCode: "78758", countryCode: "us", status: "active" },
  { id: "area-b", label: "Burnet coverage", centerLatitude: 30.75, centerLongitude: -98.23, radiusMiles: 8, isPrimary: false, formattedAddress: "Burnet, TX", locality: "Burnet", region: "TX", postalCode: "78611", countryCode: "us", status: "active" },
];
const response = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response;

beforeEach(() => { geoapifyConfig.apiKey = "synthetic-test-only"; renderer.dragHandlers.length = 0; renderer.lifecycle.length = 0; });
afterEach(async () => { cleanup(); await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); geoapifyConfig.apiKey = originalKey; global.fetch = originalFetch; vi.restoreAllMocks(); });

async function pendingExactSearch(kind: "search" | "reverse" | "autocomplete" = "search") {
  let resolveSearch!: (response: Response) => void;
  const search = new Promise<Response>((resolve) => { resolveSearch = resolve; });
  const calls: { url: string; method: string; body: unknown }[] = [];
  global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url.includes(`/v1/geocode/${kind}`)) return search;
    if (url.includes("/v1/geocode/autocomplete")) return response({ results: [] });
    if (init?.method === "PUT") return response({ area: areas.find((area) => url.endsWith(area.id)) });
    if (url === "/api/provider/service-areas") return response({ areas });
    throw new Error(`Unexpected transport: ${url}`);
  });
  render(<ProviderServiceAreasPanel />);
  await screen.findByRole("button", { name: "Edit Austin coverage" });
  await waitFor(() => expect(screen.queryByText("Loading the coverage map…")).not.toBeInTheDocument());
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  if (kind === "search" || kind === "autocomplete") {
    fireEvent.change(screen.getByRole("combobox", { name: "Service area centre" }), { target: { value: "Delayed Dallas address" } });
    if (kind === "search") fireEvent.click(screen.getByRole("button", { name: "Search" }));
  } else {
    await waitFor(() => expect(renderer.dragHandlers.length).toBeGreaterThan(0));
    act(() => renderer.dragHandlers.at(-1)!({ target: { getLatLng: () => ({ lat: 32.78, lng: -96.8 }) } }));
  }
  await waitFor(() => expect(calls.some((call) => call.url.includes(`/v1/geocode/${kind}`))).toBe(true));
  return {
    calls,
    resolve: async () => { await act(async () => { resolveSearch(response({ results: [{ formatted: "Dallas, TX", city: "Dallas", lat: 32.78, lon: -96.8 }] })); await search; }); },
  };
}

describe("coverage editor asynchronous draft ownership", () => {
  it("ignores an exact address response started before selecting a different saved area", async () => {
    const pending = await pendingExactSearch();
    fireEvent.click(screen.getByRole("button", { name: "Edit Burnet coverage" }));
    await waitFor(() => expect(screen.getByLabelText("Area name")).toHaveValue("Burnet coverage"));
    await pending.resolve();
    expect(screen.getByRole("combobox", { name: "Service area centre" })).toHaveAttribute("placeholder", "Burnet, TX");
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(pending.calls.some((call) => call.method === "PUT")).toBe(true));
    expect(pending.calls.find((call) => call.method === "PUT")).toMatchObject({ url: "/api/provider/service-areas/area-b", body: { centerLatitude: 30.75, centerLongitude: -98.23, formattedAddress: "Burnet, TX" } });
  });

  it("ignores an exact address response after cancelling the draft that requested it", async () => {
    const pending = await pendingExactSearch();
    fireEvent.change(screen.getByLabelText("Area name"), { target: { value: "Unsaved name" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await pending.resolve();
    expect(screen.getByLabelText("Area name")).toHaveValue("Austin coverage");
    expect(screen.getByRole("combobox", { name: "Service area centre" })).toHaveAttribute("placeholder", "Austin, TX");
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
    expect(pending.calls.filter((call) => call.method !== "GET")).toEqual([]);
  });
  it("does not attach a reverse-lookup address to a different saved area after selection", async () => {
    const pending = await pendingExactSearch("reverse");
    fireEvent.click(screen.getByRole("button", { name: "Edit Burnet coverage" }));
    await pending.resolve();
    expect(screen.getByRole("combobox", { name: "Service area centre" })).toHaveAttribute("placeholder", "Burnet, TX");
    expect(screen.getByLabelText("Area name")).toHaveValue("Burnet coverage");
    expect(pending.calls.filter((call) => call.method !== "GET")).toEqual([]);
  });

  it("does not show stale address suggestions in a newly selected area's editor", async () => {
    const pending = await pendingExactSearch("autocomplete");
    fireEvent.click(screen.getByRole("button", { name: "Edit Burnet coverage" }));
    await pending.resolve();
    expect(screen.queryByRole("list", { name: "Address suggestions" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Searching…" })).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Service area centre" })).toHaveValue("");
    expect(pending.calls.filter((call) => call.method !== "GET")).toEqual([]);
  });

});


describe("standalone coverage editor lookup lifetime", () => {
  function editorRequests() {
    const requests: { resolve: (value: Response) => void; url: string }[] = [];
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/autocomplete")) return Promise.resolve(response({ results: [] }));
      return new Promise<Response>((resolve) => requests.push({ resolve, url }));
    });
    const onChange = vi.fn();
    const draft: ServiceAreaDraft = { ...areas[0] };
    const view = render(<ProviderServiceAreaEditor value={draft} onChange={onChange} />);
    const search = async (text: string) => {
      fireEvent.change(screen.getByRole("combobox", { name: "Service area centre" }), { target: { value: text } });
      fireEvent.keyDown(screen.getByRole("combobox", { name: "Service area centre" }), { key: "Enter" });
      await waitFor(() => expect(requests.some((request) => new URL(request.url).searchParams.get("text") === text)).toBe(true));
    };
    const resolve = async (index: number, city: string, lat: number) => {
      await act(async () => { requests[index]!.resolve(response({ results: [{ formatted: city, city, lat, lon: -97 }] })); });
    };
    return { requests, onChange, draft, view, search, resolve };
  }

  it("keeps the latest explicit search when an older lookup resolves last", async () => {
    const test = editorRequests();
    await test.search("First address");
    await test.search("Second address");
    await test.resolve(1, "Second city", 31);
    await test.resolve(0, "First city", 32);
    expect(test.onChange).toHaveBeenCalledTimes(1);
    expect(test.onChange).toHaveBeenLastCalledWith(expect.objectContaining({ formattedAddress: "Second city", centerLatitude: 31 }));
  });

  it("does not emit a late lookup after its editor unmounts", async () => {
    const test = editorRequests();
    await test.search("Pending address");
    test.view.unmount();
    await test.resolve(0, "Late city", 31);
    expect(test.onChange).not.toHaveBeenCalled();
  });

  it("does not apply a pending lookup after the editor becomes disabled for persistence", async () => {
    const test = editorRequests();
    await test.search("Pending address");
    test.view.rerender(<ProviderServiceAreaEditor value={test.draft} onChange={test.onChange} disabled />);
    await test.resolve(0, "Late city", 31);
    expect(test.onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("combobox", { name: "Service area centre" })).toBeDisabled();
  });
  it("stops an initialized map before releasing its renderer on unmount", async () => {
    const test = editorRequests();
    await waitFor(() => expect(screen.queryByText("Loading the coverage map…")).not.toBeInTheDocument());
    test.view.unmount();
    // Renderer lifecycle evidence only. Actual Leaflet zoom-timer cancellation
    // needs the independent browser reproduction with the real map engine.
    expect(renderer.lifecycle).toEqual(["stop", "remove"]);
  });

});
