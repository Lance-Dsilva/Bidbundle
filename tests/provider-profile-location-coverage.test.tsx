// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import ProviderProfilePage from "@/app/app/provider/profile/page";
import type { CommonProfile, ProviderProfile } from "@/lib/profile-types";
import type { CommonProfileUpdate, ProviderProfileUpdate } from "@/lib/validation/profile";

vi.mock("@clerk/nextjs", () => ({ SignOutButton: ({ children }: { children: ReactNode }) => children }));
vi.mock("@/hooks/useProviderRatings", () => ({ useProviderRatings: () => ({ reviews: [], summary: null }) }));
vi.mock("@/hooks/useProviderOverview", () => ({ useProviderOverview: () => ({ overview: null }) }));
vi.mock("@/hooks/useProviderEarnings", () => ({ useProviderEarnings: () => ({ earnings: null }) }));
vi.mock("@/hooks/useProviderMarketplace", () => ({ useProviderMarketplace: () => ({ workspace: null }) }));
// Exercise the actual page + profile hook + full-profile HTTP client + actual coverage panel.
// Address selection is independently covered against the real dialog in provider-business-address.
const edit = vi.hoisted(() => ({ common: {} as CommonProfileUpdate, business: {} as ProviderProfileUpdate }));
vi.mock("@/components/provider/ProviderBusinessDetailsDialog", () => ({
  ProviderBusinessDetailsDialog: ({ onSave, onClose }: { onSave: (common: CommonProfileUpdate, business: ProviderProfileUpdate) => Promise<boolean>; onClose: () => void }) =>
    <button onClick={async () => { if (await onSave(edit.common, edit.business)) onClose(); }}>Submit test draft</button>,
}));
vi.mock("@/components/provider/ProviderServiceAreaEditor", async (importOriginal) => ({
  ...await importOriginal<object>(), ProviderServiceAreaEditor: () => <div>Coverage editor</div>,
}));
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



const AREA = { id: "burnet", label: "Burnet working area", centerLatitude: 30.76, centerLongitude: -98.23,
  radiusMiles: 10, isPrimary: true, formattedAddress: "Burnet, TX", locality: "Burnet", region: "TX", postalCode: null, countryCode: "us", status: "active" };
let failSave = false;
let requests: { url: string; init?: RequestInit }[] = [];
function json(body: unknown, ok = true) { return { ok, status: ok ? 200 : 400, json: async () => body } as Response; }
beforeEach(() => {
  failSave = false; requests = [];
  edit.common = { fullName: PROFILE.fullName, phone: PROFILE.phone, address: "123 Sunset Blvd, Los Angeles, CA", neighborhood: "Echo Park", latitude: 34.08, longitude: -118.26 };
  edit.business = { companyName: PROVIDER.companyName, licenseNumber: PROVIDER.licenseNumber };
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input); requests.push({ url, init });
    if (url === "/api/profile/provider" && init?.method === "PUT") {
      if (failSave) return json({ error: "Save refused" }, false);
      const payload = JSON.parse(String(init.body));
      return json({ profile: { ...PROFILE, ...payload.common }, provider: { ...PROVIDER, ...payload.provider } });
    }
    if (url === "/api/profile") return json(PROFILE);
    if (url === "/api/profile/provider") return json(PROVIDER);
    if (url === "/api/provider/service-areas") return json({ areas: [AREA] });
    throw new Error(`Unexpected network request: ${url}`);
  }));
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function submit() {
  render(<ProviderProfilePage />);
  fireEvent.click(await screen.findByRole("button", { name: /edit business details/i }));
  fireEvent.click(screen.getByRole("button", { name: "Submit test draft" }));
  await waitFor(() => expect(requests.filter((r) => r.init?.method === "PUT")).toHaveLength(1));
}
function expectNoCoverageWrites() {
  expect(requests.filter(({ url, init }) => url.includes("service-areas") && ["POST", "PUT", "PATCH", "DELETE"].includes(init?.method ?? "GET"))).toEqual([]);
}
describe("provider business move and independent work coverage", () => {
  it("saves through the actual full-profile hook and offers explicit keep/review without moving Burnet coverage", async () => {
    await submit();
    expect(await screen.findByRole("button", { name: /review service areas/i })).toBeInTheDocument();
    const keep = screen.getByRole("button", { name: /keep existing service areas/i });
    expect(screen.getByText("Burnet working area")).toBeInTheDocument();
    const write = requests.find((r) => r.init?.method === "PUT")!;
    expect(write.url).toBe("/api/profile/provider");
    expect(write.init?.credentials).toBe("same-origin");
    expect(JSON.parse(String(write.init?.body))).toEqual({ common: edit.common, provider: edit.business });
    expectNoCoverageWrites();
    fireEvent.click(keep);
    expect(screen.queryByRole("button", { name: /review service areas/i })).not.toBeInTheDocument();
    expectNoCoverageWrites();
  });
  it("review reaches the actual coverage section with focus, without a coverage mutation", async () => {
    await submit();
    fireEvent.click(await screen.findByRole("button", { name: /review service areas/i }));
    const section = document.getElementById("service-areas")!;
    expect(section).toHaveFocus();
    expect(section.scrollIntoView).toHaveBeenCalled();
    expectNoCoverageWrites();
  });
  it("does not show a coverage choice when the business save fails", async () => {
    failSave = true;
    await submit();
    await screen.findByRole("button", { name: "Submit test draft" });
    expect(screen.queryByRole("button", { name: /review service areas/i })).not.toBeInTheDocument();
    expectNoCoverageWrites();
  });
  it("does not show a coverage choice for credential-only edits to an unchanged legacy location", async () => {
    edit.common = { fullName: PROFILE.fullName, address: PROFILE.address, neighborhood: PROFILE.neighborhood };
    edit.business = { licenseNumber: "LIC-2" };
    await submit();
    await waitFor(() => expect(screen.queryByRole("button", { name: "Submit test draft" })).not.toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /review service areas/i })).not.toBeInTheDocument();
    expectNoCoverageWrites();
  });
  it("offers coverage review when the same address resolves to a different selected point", async () => {
    edit.common = { address: PROFILE.address, neighborhood: PROFILE.neighborhood,
      latitude: 34.08, longitude: -118.26 };
    await submit();
    expect(await screen.findByRole("button", { name: /review service areas/i })).toBeInTheDocument();
    expectNoCoverageWrites();
  });
  it("offers coverage review after intentionally clearing a previous business location", async () => {
    edit.common = { address: null, neighborhood: null, latitude: null, longitude: null };
    await submit();
    expect(await screen.findByRole("button", { name: /review service areas/i })).toBeInTheDocument();
    expectNoCoverageWrites();
  });

  it("shows the saved business locality separately from unchanged Burnet service coverage", async () => {
    edit.common = { ...edit.common, neighborhood: "Downtown" };
    await submit();
    await screen.findByRole("button", { name: /review service areas/i });
    const localityField = screen.getByText("Business locality").parentElement!;
    expect(localityField).toHaveTextContent(/^Business localityDowntown$/);
    expect(localityField).not.toHaveTextContent(/mi|radius|service area/i);
    expect(screen.queryByText("Service area", { exact: true })).not.toBeInTheDocument();
    const coverage = document.getElementById("service-areas")!;
    expect(within(coverage).getByText("Burnet working area")).toBeInTheDocument();
    expect(coverage).toHaveTextContent(/10 mi/);
    expect(coverage).not.toHaveTextContent("Downtown");
    expectNoCoverageWrites();
    fireEvent.click(screen.getByRole("button", { name: /keep existing service areas/i }));
    expect(localityField).toHaveTextContent(/^Business localityDowntown$/);
    expect(within(coverage).getByText("Burnet working area")).toBeInTheDocument();
    expectNoCoverageWrites();
  });

});
