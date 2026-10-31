// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ProviderBusinessDetailsDialog } from "@/components/provider/ProviderBusinessDetailsDialog";
import type { CommonProfileUpdate, ProviderProfileUpdate } from "@/lib/validation/profile";
import { geoapifyConfig } from "@/lib/geoapify";
import type { CommonProfile, ProviderProfile } from "@/lib/profile-types";

const initialGeocoderKey = geoapifyConfig.apiKey;

const PROFILE: CommonProfile = {
  id: "user-1",
  email: "pat@example.com",
  fullName: "Pat Rivera",
  phone: "+1 512 555 0100",
  role: "provider",
  isVerified: true,
  address: "1 Oak St",
  neighborhood: "North Austin",
  latitude: 30.4,
  longitude: -97.7,
  avatarUrl: null,
  avatarUpdatedAt: null,
  createdAt: "2026-01-02T03:04:05.000Z",
  communityRadiusMi: 4,
};

const PROVIDER: ProviderProfile = {
  companyName: "ProFix Plumbing",
  bio: "Two decades of drains.",
  trades: ["Plumbing"],
  serviceRadiusMi: 4,
  workingDays: ["mon"],
  workingHoursStart: "08:00",
  workingHoursEnd: "17:00",
  licenseNumber: "LIC-1",
  licenseState: "TX",
  insuranceProvider: "Acme Mutual",
  insurancePolicyNumber: "POL-1",
  isLicenseVerified: true,
  isInsuranceVerified: true,
  licenseVerifiedAt: "2026-02-01T00:00:00.000Z",
  insuranceVerifiedAt: "2026-02-01T00:00:00.000Z",
  payoutStatus: "active",
  payoutLast4: "4242",
  payoutProvider: "stripe",
  payoutUpdatedAt: "2026-02-01T00:00:00.000Z",
  notifyNewJobs: true,
  notifyMessages: true,
  notifyPayouts: true,
};


function renderEditor(saveImpl: () => Promise<boolean> = async () => true) {
  const onSave = vi.fn<(common: CommonProfileUpdate, business: ProviderProfileUpdate) => Promise<boolean>>(saveImpl);
  const onClose = vi.fn();
  render(<ProviderBusinessDetailsDialog profile={PROFILE} provider={PROVIDER} saving={false}
    saveError={null} fieldErrors={{}} uploadProgress={null} onChangeAvatar={() => {}}
    onClearAvatar={() => {}} onSave={onSave} onClose={onClose} />);
  return { onSave, onClose };
}
beforeEach(() => { geoapifyConfig.apiKey = "synthetic-test-key"; });
afterEach(() => { geoapifyConfig.apiKey = initialGeocoderKey; cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("provider business address contract", () => {
  it("offers an accessible address combobox", () => {
    vi.stubGlobal("fetch", vi.fn());
    renderEditor();
    expect(screen.getByRole("combobox", { name: "Business address" })).toHaveAttribute("aria-autocomplete", "list");
  });
  it("refuses changed nonempty text without an explicit location choice", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const { onSave } = renderEditor();
    fireEvent.change(screen.getByLabelText("Business address"), { target: { value: "Los Angeles address" } });
    fireEvent.click(screen.getByRole("button", { name: "Save business details" }));
    await act(async () => {});
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/select|choose|confirm/i);
  });
});

const LA = { formatted: "123 Sunset Blvd, Los Angeles, CA 90026, United States", neighbourhood: "Echo Park", lat: 34.08, lon: -118.26 };
function response(results: unknown) { return { ok: true, json: async () => ({ results }) } as Response; }
async function selectLA() {
  fireEvent.change(screen.getByLabelText("Business address"), { target: { value: "123 Sunset" } });
  fireEvent.click(await screen.findByRole("option", { name: LA.formatted }));
}
function addressOptions() {
  const listbox = screen.queryByRole("listbox", { name: "Address suggestions" });
  return listbox ? within(listbox).queryAllByRole("option") : [];
}

describe("provider selected location safety", () => {
  it("debounces requests, bounds results and saves only the explicitly selected normalized location", async () => {
    const fetcher = vi.fn(async () => response([LA, { ...LA, formatted: "Another Sunset address" }]));
    vi.stubGlobal("fetch", fetcher);
    const { onSave } = renderEditor();
    const input = screen.getByLabelText("Business address");
    fireEvent.change(input, { target: { value: "123" } });
    fireEvent.change(input, { target: { value: "123 Sunset" } });
    expect(fetcher).not.toHaveBeenCalled();
    const option = await screen.findByRole("option", { name: LA.formatted });
    expect(onSave).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0]! as unknown as [string, RequestInit];
    expect(new URL(url).searchParams.get("limit")).toBe("5");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    fireEvent.click(option);
    fireEvent.click(screen.getByRole("button", { name: "Save business details" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0]![0]).toEqual({ fullName: PROFILE.fullName, phone: PROFILE.phone,
      address: LA.formatted, neighborhood: "Echo Park", latitude: 34.08, longitude: -118.26 });
  });
  it("invalidates the selected point immediately when the text changes", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response([LA])));
    const { onSave } = renderEditor();
    await selectLA();
    fireEvent.change(screen.getByLabelText("Business address"), { target: { value: "Different address" } });
    fireEvent.click(screen.getByRole("button", { name: "Save business details" }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/select|choose|confirm/i);
  });
  it("permits an unchanged legacy address when editing credentials without geocoding", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    const { onSave } = renderEditor();
    fireEvent.change(screen.getByLabelText("Licence number"), { target: { value: "LIC-2" } });
    fireEvent.click(screen.getByRole("button", { name: "Save business details" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(fetcher).not.toHaveBeenCalled();
    expect(onSave.mock.calls[0]![0]).toMatchObject({ address: PROFILE.address });
  });
  it("clears locality and both coordinates when intentionally clearing the business address", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const { onSave } = renderEditor();
    fireEvent.change(screen.getByLabelText("Business address"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save business details" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0]![0]).toMatchObject({ address: null, neighborhood: null, latitude: null, longitude: null });
  });
  it.each([[], [{ ...LA, lat: NaN }], [{ ...LA, lon: 190 }], [{ formatted: "Missing point" }]].map((results) => ({ results })))(
    "never offers unusable address results (%j)", async ({ results }) => {
      vi.stubGlobal("fetch", vi.fn(async () => response(results)));
      const { onSave } = renderEditor();
      fireEvent.change(screen.getByLabelText("Business address"), { target: { value: "123 Sunset" } });
      await waitFor(() => expect(screen.getByText(/no .*results|no .*addresses|no .*matches|couldn.t|unavailable/i)).toBeInTheDocument());
      expect(addressOptions()).toHaveLength(0);
      fireEvent.click(screen.getByRole("button", { name: "Save business details" }));
      expect(onSave).not.toHaveBeenCalled();
    });
  it("keeps drafts and permits reverting to the original address when geocoding is unavailable", async () => {
    geoapifyConfig.apiKey = "";
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    const { onSave } = renderEditor();
    fireEvent.change(screen.getByLabelText("Company name"), { target: { value: "Draft company" } });
    fireEvent.change(screen.getByLabelText("Business address"), { target: { value: "123 Sunset" } });
    await waitFor(() => expect(screen.getByText(/unavailable|couldn.t|not available/i)).toBeInTheDocument());
    expect(fetcher).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Company name")).toHaveValue("Draft company");
    fireEvent.change(screen.getByLabelText("Business address"), { target: { value: PROFILE.address } });
    fireEvent.click(screen.getByRole("button", { name: "Save business details" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  });
  it("ignores a late older response even when transport does not honor cancellation", async () => {
    let oldResolve!: (result: Response) => void;
    const fetcher = vi.fn().mockImplementationOnce(() => new Promise<Response>((resolve) => { oldResolve = resolve; }))
      .mockResolvedValue(response([LA]));
    vi.stubGlobal("fetch", fetcher);
    renderEditor();
    fireEvent.change(screen.getByLabelText("Business address"), { target: { value: "Old address" } });
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    const oldSignal = fetcher.mock.calls[0]![1].signal as AbortSignal;
    fireEvent.change(screen.getByLabelText("Business address"), { target: { value: "123 Sunset" } });
    expect(oldSignal.aborted).toBe(true);
    expect(await screen.findByRole("option", { name: LA.formatted })).toBeInTheDocument();
    await act(async () => { oldResolve(response([{ ...LA, formatted: "Stale old address" }])); });
    expect(screen.queryByRole("option", { name: "Stale old address" })).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: LA.formatted })).toBeInTheDocument();
  });
  it("handles suggestion Escape before the dialog's discard shortcut", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response([LA])));
    const { onClose } = renderEditor();
    const input = screen.getByLabelText("Business address");
    fireEvent.change(input, { target: { value: "123 Sunset" } });
    await screen.findByRole("option", { name: LA.formatted });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("provider address recovery and pending save", () => {
  it("retains all drafts after lookup failure and permits an explicit retry", async () => {
    const fetcher = vi.fn().mockRejectedValueOnce(new Error("Synthetic outage"))
      .mockResolvedValue(response([LA]));
    vi.stubGlobal("fetch", fetcher);
    renderEditor();
    fireEvent.change(screen.getByLabelText("Company name"), { target: { value: "Preserved draft" } });
    fireEvent.change(screen.getByLabelText("Licence number"), { target: { value: "LIC-DRAFT" } });
    fireEvent.change(screen.getByLabelText("Business address"), { target: { value: "123 Sunset" } });
    await screen.findByText(/couldn.t search for that address/i);
    fireEvent.click(screen.getByRole("button", { name: /retry address search/i }));
    expect(await screen.findByRole("option", { name: LA.formatted })).toBeInTheDocument();
    expect(screen.getByLabelText("Company name")).toHaveValue("Preserved draft");
    expect(screen.getByLabelText("Licence number")).toHaveValue("LIC-DRAFT");
  });
  it("times out and aborts a stalled lookup with a recoverable local message", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(() => new Promise<Response>(() => {}));
    vi.stubGlobal("fetch", fetcher);
    renderEditor();
    fireEvent.change(screen.getByLabelText("Business address"), { target: { value: "123 Sunset" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const signal = (fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].signal!;
    await act(async () => { await vi.advanceTimersByTimeAsync(8_100); });
    expect(signal.aborted).toBe(true);
    expect(screen.getByRole("button", { name: /retry address search/i })).toBeInTheDocument();
    expect(addressOptions()).toHaveLength(0);
  });
  it("freezes address lookups and selection during an actual pending business save", async () => {
    let finish!: (value: boolean) => void;
    const pending = new Promise<boolean>((resolve) => { finish = resolve; });
    const fetcher = vi.fn(async () => response([LA]));
    vi.stubGlobal("fetch", fetcher);
    const { onSave, onClose } = renderEditor(() => pending);
    await selectLA();
    fireEvent.click(screen.getByRole("button", { name: "Save business details" }));
    const address = screen.getByLabelText("Business address");
    expect(address).toBeDisabled();
    fireEvent.change(address, { target: { value: "Do not accept" } });
    expect(address).toHaveValue(LA.formatted);
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => { finish(false); await pending; });
    expect(address).not.toBeDisabled();
    expect(address).toHaveValue(LA.formatted);
  });
  it("selects with arrow and Enter without implicitly accepting the first ambiguous result", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response([LA, { ...LA, formatted: "Another Sunset address" }])));
    const { onSave } = renderEditor();
    const input = screen.getByLabelText("Business address");
    fireEvent.change(input, { target: { value: "123 Sunset" } });
    await screen.findByRole("option", { name: LA.formatted });
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input).toHaveAttribute("aria-activedescendant");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(input).toHaveValue(LA.formatted);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
});

describe("provider address response boundaries", () => {
  it("bounds visible suggestions even when the upstream returns too many", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response(Array.from({ length: 9 }, (_, index) => ({ ...LA, formatted: `Candidate ${index}` })))));
    renderEditor();
    fireEvent.change(screen.getByLabelText("Business address"), { target: { value: "123 Sunset" } });
    await screen.findByRole("option", { name: "Candidate 0" });
    expect(within(screen.getByRole("listbox", { name: "Address suggestions" })).getAllByRole("option")).toHaveLength(5);
  });
  it("does not fabricate the previous locality when a selected result has none", async () => {
    const withoutLocality = { ...LA, neighbourhood: undefined };
    vi.stubGlobal("fetch", vi.fn(async () => response([withoutLocality])));
    const { onSave } = renderEditor();
    await selectLA();
    expect(screen.getByLabelText("Neighborhood")).toHaveValue("");
    fireEvent.click(screen.getByRole("button", { name: "Save business details" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0]![0]).toMatchObject({ address: LA.formatted, neighborhood: null, latitude: LA.lat, longitude: LA.lon });
  });
});

it("does not offer raw coordinate controls while selected point metadata may be saved", () => {
  vi.stubGlobal("fetch", vi.fn());
  renderEditor();
  expect(screen.queryByRole("textbox", { name: /latitude|longitude|coordinates/i })).not.toBeInTheDocument();
  expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
  expect(screen.queryByLabelText(/latitude|longitude|coordinates/i)).not.toBeInTheDocument();
});

it("treats a newly selected point at the same address as an unsaved location change", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => response([{ ...LA, formatted: PROFILE.address }])));
  const { onClose, onSave } = renderEditor();
  fireEvent.change(screen.getByLabelText("Business address"), { target: { value: "1 Oak" } });
  fireEvent.click(await screen.findByRole("option", { name: PROFILE.address! }));
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  expect(onClose).not.toHaveBeenCalled();
  expect(onSave).not.toHaveBeenCalled();
});
