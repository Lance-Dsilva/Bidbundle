// @vitest-environment jsdom
import type { AnchorHTMLAttributes } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const session = vi.hoisted(() => ({ isLoaded: true, isSignedIn: false, user: { id: "provider-one" } }));
vi.mock("@clerk/nextjs", () => ({ useUser: () => session }));
vi.mock("next/link", () => ({ default: (props: AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props} /> }));
import { VendorSourcingPanel } from "@/components/admin/VendorSourcingPanel";
import { VendorLeadDirectory } from "@/components/admin/VendorLeadDirectory";
import { VendorBidProposal } from "@/components/vendors/VendorBidProposal";
import { VendorUnsubscribe } from "@/components/vendors/VendorUnsubscribe";
import type { PublicVendorBidSummary, VendorSourcingView } from "@/lib/vendor-sourcing-types";

const fetchMock = vi.fn();
const summary: PublicVendorBidSummary = {
  request: { id: "request-59", category: "pool_care", areaLabel: "Synthetic City, CA", homeCount: 2,
    biddingClosesAt: "2099-02-01T00:00:00Z", poolTemplate: null, tierCounts: {}, requiresAfterPhoto: true },
  invitation: { expiresAt: "2099-02-01T00:00:00Z", claimed: false, submitted: false },
  prefill: { businessName: "Synthetic Pool Co", licenseNumber: "990001", licenseState: "CA", categories: ["pool_care"] },
};
const view: VendorSourcingView = {
  request: summary.request,
  registered: [{ providerUserId: "provider-59", name: "Verified Pool Company", verified: true, approved: true, distanceMi: null, invited: false }],
  leads: [], funnel: { invited: 0, opened: 0, proposalStarted: 0, submitted: 0 },
  outreach: { ready: false, missing: ["VENDOR_OUTREACH_ENABLED"] },
};
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); session.isLoaded = true; session.isSignedIn = false; session.user = { id: "provider-one" }; });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("vendor public proposal account boundary", () => {
  it("discards an in-flight claim when the signed-in account changes", async () => {
    session.isSignedIn = true;
    let complete!: (response: Response) => void;
    fetchMock.mockImplementation(() => new Promise<Response>(resolve => { complete = resolve; }));
    const page = render(<VendorBidProposal token="signed-token-at-least-twenty-characters" summary={summary} />);
    fireEvent.click(screen.getByRole("button", { name: "Continue with verified email" }));
    session.user = { id: "provider-two" };
    page.rerender(<VendorBidProposal token="signed-token-at-least-twenty-characters" summary={summary} />);
    await act(async () => { complete(Response.json({ verificationPending: true })); });
    expect(screen.getByRole("button", { name: "Continue with verified email" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Submit proposal" })).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledOnce();
  });
  it("keeps signed-out visitors on explicit signup/sign-in links and carries the invitation return path", () => {
    render(<VendorBidProposal token="signed-token-at-least-twenty-characters" summary={summary} />);
    for (const name of ["Sign up to propose", "Sign in with invited email"]) {
      const href = screen.getByRole("link", { name }).getAttribute("href")!;
      expect(decodeURIComponent(href)).toContain("/bid/signed-token-at-least-twenty-characters");
    }
    expect(screen.queryByRole("button", { name: "Submit proposal" })).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("requires a successful server claim before displaying the proposal form", async () => {
    session.isSignedIn = true;
    fetchMock.mockResolvedValue(Response.json({ error: "Use the invited verified email." }, { status: 403 }));
    render(<VendorBidProposal token="signed-token-at-least-twenty-characters" summary={summary} />);
    fireEvent.click(screen.getByRole("button", { name: "Continue with verified email" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("invited verified email");
    expect(screen.queryByRole("button", { name: "Submit proposal" })).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledOnce();
  });
  it("shows verification-pending terms and submits exact cents only after claim", async () => {
    session.isSignedIn = true;
    fetchMock.mockImplementation(async (path: string) => Response.json(path.endsWith("/claim") ? { verificationPending: true } : { id: "bid-59" }));
    render(<VendorBidProposal token="signed-token-at-least-twenty-characters" summary={summary} />);
    fireEvent.click(screen.getByRole("button", { name: "Continue with verified email" }));
    const total = await screen.findByLabelText("Whole-job total for all homes and visits ($)");
    expect(screen.getByText(/Verification pending:/)).toBeInTheDocument();
    fireEvent.change(total, { target: { value: "123.45" } });
    fireEvent.change(screen.getByLabelText("Work included"), { target: { value: "Synthetic full pool service" } });
    fireEvent.submit(total.closest("form")!);
    expect(await screen.findByText("Your proposal has been received")).toBeInTheDocument();
    const calls = fetchMock.mock.calls.filter(([path]) => path.endsWith("/proposal"));
    expect(calls).toHaveLength(1);
    expect(calls[0][1].method).toBe("PUT");
    expect(JSON.parse(calls[0][1].body)).toMatchObject({ amountCents: 12345, pricingBasis: "total", perHomeCents: null });
  });
});

describe("CSLB preview applies only the reviewed input", () => {
  it("invalidates a preview when county filters change", async () => {
    fetchMock.mockImplementation(async (path: string, options?: RequestInit) => Response.json(options?.method === "POST"
      ? { dryRun: true, importedCount: 1, updatedCount: 0, duplicateCount: 0, excluded: [], rowsConsidered: 1 } : { leads: [] }));
    render(<VendorLeadDirectory />);
    fireEvent.change(screen.getByLabelText("CSV contents"), { target: { value: "LicenseNo,BusinessName\n990001,Synthetic" } });
    fireEvent.change(screen.getByLabelText("Target counties, separated by commas"), { target: { value: "Los Angeles" } });
    fireEvent.click(screen.getByRole("button", { name: "Preview import" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Apply import" })).toBeEnabled());
    fireEvent.change(screen.getByLabelText("Target counties, separated by commas"), { target: { value: "Orange" } });
    expect(screen.getByRole("button", { name: "Apply import" })).toBeDisabled();
    expect(fetchMock.mock.calls.filter(([, options]) => options?.method === "POST")).toHaveLength(1);
  });
  it("ignores an old preview response after CSV contents changed", async () => {
    let complete!: (response: Response) => void;
    fetchMock.mockImplementation(async (_path: string, options?: RequestInit) => options?.method === "POST"
      ? new Promise<Response>(resolve => { complete = resolve; }) : Response.json({ leads: [] }));
    render(<VendorLeadDirectory />);
    fireEvent.change(screen.getByLabelText("CSV contents"), { target: { value: "LicenseNo,BusinessName\n990001,Synthetic" } });
    fireEvent.change(screen.getByLabelText("Target counties, separated by commas"), { target: { value: "Los Angeles" } });
    fireEvent.click(screen.getByRole("button", { name: "Preview import" }));
    fireEvent.change(screen.getByLabelText("CSV contents"), { target: { value: "LicenseNo,BusinessName\n990002,Changed" } });
    await act(async () => { complete(Response.json({ dryRun: true, importedCount: 1, updatedCount: 0, duplicateCount: 0, excluded: [], rowsConsidered: 1 })); });
    expect(screen.getByRole("button", { name: "Apply import" })).toBeDisabled();
    expect(screen.queryByText(/Preview: 1 rows considered/)).not.toBeInTheDocument();
  });
});

describe("global vendor email opt-out", () => {
  it("does not unsubscribe on render, then uses one-click POST without identity fields", async () => {
    fetchMock.mockResolvedValue(Response.json({ unsubscribed: true }));
    render(<VendorUnsubscribe token="signed.optout" />);
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Stop all vendor invitation emails" }));
    expect(await screen.findByRole("status")).toHaveTextContent("across all community requests");
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith("/api/vendor-unsubscribe/signed.optout", expect.objectContaining({ method: "POST", body: "List-Unsubscribe=One-Click" }));
  });
  it("retains retry control when opt-out fails rather than claiming success", async () => {
    fetchMock.mockResolvedValue(Response.json({ error: "This link is unavailable." }, { status: 404 }));
    render(<VendorUnsubscribe token="wrong-token" />);
    fireEvent.click(screen.getByRole("button", { name: "Stop all vendor invitation emails" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("unavailable");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stop all vendor invitation emails" })).toBeEnabled();
  });
});

describe("reviewed sourcing stays usable without cold-email configuration", () => {
  it("allows existing registered providers while cold lead outreach is disabled", async () => {
    fetchMock.mockImplementation(async (path: string, options?: RequestInit) => {
      if (options?.method === "POST") return Response.json({ queuedCount: 0, registeredCount: 1 });
      if (path.includes("/communities/")) return Response.json({ requests: [{ id: "request-59", title: "Synthetic request", category: "pool_care" }] });
      return Response.json(view);
    });
    render(<VendorSourcingPanel communityId="community-59" />);
    await screen.findByRole("option", { name: "Synthetic request" });
    fireEvent.change(screen.getByLabelText("Open request"), { target: { value: "request-59" } });
    const checkbox = await screen.findByRole("checkbox", { name: /Verified Pool Company/ });
    expect(checkbox).toBeEnabled();
    fireEvent.click(checkbox); fireEvent.click(screen.getByRole("button", { name: "Invite selected providers" }));
    await waitFor(() => expect(fetchMock.mock.calls.filter(([, options]) => options?.method === "POST")).toHaveLength(1));
    const [, options] = fetchMock.mock.calls.find(([, options]) => options?.method === "POST")!;
    expect(JSON.parse(options.body)).toEqual({ leadIds: [], providerUserIds: ["provider-59"] });
  });
});
