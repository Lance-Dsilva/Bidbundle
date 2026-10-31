// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HomeAddressCompletion } from "@/components/homeowner/HomeAddressCompletion";
const state = vi.hoisted(() => ({ geocode: vi.fn(), autocomplete: vi.fn(), fetch: vi.fn(), complete: vi.fn(), cancel: vi.fn() }));
vi.mock("@/lib/geoapify", () => ({ geocodeAddress: state.geocode, autocompleteAddress: state.autocomplete }));
const place = { formatted: "1 Oak St, Austin", latitude: 30.4, longitude: -97.7, neighborhood: "Oakwood" };
function show() { return render(<HomeAddressCompletion onComplete={state.complete} onCancel={state.cancel} />); }
function fill(value = "1 Oak St") { fireEvent.change(screen.getByLabelText("Home address"), { target: { value } }); }
function submit() { fireEvent.submit(screen.getByRole("form", { name: "Add your home address to continue" })); }
beforeEach(() => {
  state.geocode.mockReset().mockResolvedValue(place); state.autocomplete.mockReset().mockResolvedValue([]);
  state.fetch.mockReset().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
  state.complete.mockReset().mockResolvedValue(undefined); state.cancel.mockReset(); vi.stubGlobal("fetch", state.fetch);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("home address completion", () => {
  it("ignores a stale autocomplete response after editing and saves the selected current suggestion", async () => {
    let resolveOld!: (places: typeof place[]) => void;
    const current = { ...place, formatted: "2 Pine St, Austin", latitude: 33, longitude: -98 };
    state.autocomplete.mockReturnValueOnce(new Promise((done) => { resolveOld = done; })).mockResolvedValueOnce([current]);
    show(); fill("1 Oak St");
    await waitFor(() => expect(state.autocomplete).toHaveBeenCalledOnce());
    fill("2 Pine St");
    await screen.findByRole("button", { name: current.formatted });
    await act(async () => { resolveOld([place]); });
    expect(screen.queryByRole("button", { name: place.formatted })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: current.formatted })); submit();
    await waitFor(() => expect(state.complete).toHaveBeenCalledOnce());
    expect(state.geocode).not.toHaveBeenCalled();
    expect(JSON.parse(state.fetch.mock.calls[0][1].body)).toEqual({ address: current.formatted, latitude: 33, longitude: -98 });
  });

  it("focuses the labeled field and lets cancellation leave the profile and join untouched", () => {
    show(); expect(screen.getByLabelText("Home address")).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(state.cancel).toHaveBeenCalledOnce(); expect(state.fetch).not.toHaveBeenCalled(); expect(state.complete).not.toHaveBeenCalled(); expect(state.geocode).not.toHaveBeenCalled();
  });

  it("geocodes then saves only self-profile address coordinates before continuing", async () => {
    show(); fill(); submit();
    await waitFor(() => expect(state.complete).toHaveBeenCalledOnce());
    expect(state.geocode).toHaveBeenCalledWith("1 Oak St");
    expect(state.fetch).toHaveBeenCalledOnce();
    expect(state.fetch.mock.calls[0][0]).toBe("/api/profile");
    expect(state.fetch.mock.calls[0][1]).toMatchObject({ method: "PATCH", credentials: "same-origin" });
    expect(JSON.parse(state.fetch.mock.calls[0][1].body)).toEqual({ address: place.formatted, latitude: place.latitude, longitude: place.longitude });
    expect(state.geocode.mock.invocationCallOrder[0]).toBeLessThan(state.fetch.mock.invocationCallOrder[0]);
    expect(state.fetch.mock.invocationCallOrder[0]).toBeLessThan(state.complete.mock.invocationCallOrder[0]);
  });

  it.each([null, { ...place, latitude: 91 }, { ...place, longitude: Infinity }, { ...place, formatted: " " }])("refuses unverified/unrouteable geocoding results: %j", async (result) => {
    state.geocode.mockResolvedValue(result); show(); fill(); submit();
    await screen.findByRole("alert"); expect(state.fetch).not.toHaveBeenCalled(); expect(state.complete).not.toHaveBeenCalled();
  });

  it("keeps a failed profile save local and allows retry without attempting the join", async () => {
    state.fetch.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ error: "Unavailable" }) });
    show(); fill(); submit(); await screen.findByRole("alert");
    expect(state.complete).not.toHaveBeenCalled(); expect(screen.getByRole("button", { name: "Save address & join" })).toBeEnabled();
    submit(); await waitFor(() => expect(state.complete).toHaveBeenCalledOnce()); expect(state.fetch).toHaveBeenCalledTimes(2);
  });

  it("shows server rejection after saving and retries the original action without saving twice", async () => {
    state.complete.mockRejectedValueOnce(new Error("Sign-ups are locked")); show(); fill(); submit();
    expect(await screen.findByRole("alert")).toHaveTextContent(/address was saved.*sign-ups are locked/i);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(state.complete).toHaveBeenCalledTimes(2)); expect(state.fetch).toHaveBeenCalledOnce();
  });

  it("invalidates saved coordinates when the address text changes", async () => {
    state.complete.mockRejectedValueOnce(new Error("Request expired")); show(); fill(); submit(); await screen.findByRole("alert");
    const second = { ...place, formatted: "2 Pine St", latitude: 33, longitude: -98 };
    state.geocode.mockResolvedValueOnce(second); fill("2 Pine St"); submit();
    await waitFor(() => expect(state.complete).toHaveBeenCalledTimes(2));
    expect(state.geocode).toHaveBeenLastCalledWith("2 Pine St");
    expect(JSON.parse(state.fetch.mock.calls[1][1].body)).toEqual({ address: second.formatted, latitude: 33, longitude: -98 });
  });

  it("prevents duplicate saves and joins while geocoding is pending", async () => {
    let resolve!: (value: typeof place) => void; state.geocode.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    show(); fill(); submit(); submit();
    expect(state.geocode).toHaveBeenCalledOnce(); expect(screen.getByRole("button", { name: "Saving and checking…" })).toBeDisabled();
    resolve(place); await waitFor(() => expect(state.complete).toHaveBeenCalledOnce()); expect(state.fetch).toHaveBeenCalledOnce();
  });
});
