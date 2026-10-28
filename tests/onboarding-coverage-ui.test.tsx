// @vitest-environment jsdom
import type { ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NamedSignUp } from "@/components/auth/NamedSignUp";
import { getOnboardingDraft, saveOnboardingDraft } from "@/lib/onboarding-draft";
const state = vi.hoisted(() => ({ router: { prefetch: vi.fn(), replace: vi.fn() }, signOut: vi.fn(), fetch: vi.fn(), secondAddress: false }));
vi.mock("next/navigation", () => ({ useRouter: () => state.router }));
vi.mock("@/components/auth/AuthShowcase", () => ({ AuthShowcase: () => <aside>Signup introduction</aside> }));
vi.mock("@clerk/nextjs", () => ({ useClerk: () => ({ signOut: state.signOut }), useUser: () => ({ user: null }), SignUp: () => <div aria-label="Clerk account form">Clerk account</div>, ClerkLoaded: ({ children }: { children: ReactNode }) => <>{children}</>, ClerkLoading: () => null }));
vi.mock("@/components/onboarding/VerifyAreaStep", () => ({ VerifyAreaStep: ({ onBack, onConfirm, confirmLabel }: { onBack: () => void; onConfirm: (point: { address: string; neighborhood: string; latitude: number; longitude: number }) => void; confirmLabel?: string }) => <section><h1>Verified address boundary</h1><button onClick={onBack}>Back</button><button onClick={() => onConfirm(state.secondAddress ? { address: "2 Pine St", neighborhood: "Pine", latitude: 40, longitude: -100 } : { address: "1 Oak St", neighborhood: "Oakwood", latitude: 30.4, longitude: -97.7 })}>{confirmLabel}</button></section> }));
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((yes) => { resolve = yes; }); return { promise, resolve }; }
function response(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }); }
function draft(role: "homeowner" | "provider" = "homeowner") { saveOnboardingDraft({ name: { firstName: "Jane", lastName: "Smith" }, role, address: "1 Oak St", neighborhood: "Oakwood", latitude: 30.4, longitude: -97.7, providerBusiness: { companyName: "Company", bio: "", services: ["cleaning"], serviceArea: "Oakwood", licenseNumber: "", insuranceProvider: "" }, providerCoverage: role === "provider" ? { label: "Oakwood", centerLatitude: 30.4, centerLongitude: -97.7, radiusMiles: 5, formattedAddress: "1 Oak St", locality: "Oakwood", region: null, postalCode: null, countryCode: null } : null, completionAuthorized: true }); }
function location() { render(<NamedSignUp />); fireEvent.change(screen.getByLabelText("First name"), { target: { value: "Jane" } }); fireEvent.change(screen.getByLabelText("Surname"), { target: { value: "Smith" } }); fireEvent.click(screen.getByRole("button", { name: "Continue to role" })); fireEvent.click(screen.getByRole("button", { name: /^Continue$/ })); }
beforeEach(() => { sessionStorage.clear(); vi.clearAllMocks(); state.secondAddress = false; state.fetch.mockReset().mockResolvedValue(response({ coverage: "available" })); vi.stubGlobal("fetch", state.fetch); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("homeowner coverage decision before the account handoff", () => {
  it("does not mount Clerk while the first confirmed address check is pending", async () => {
    const pending = deferred<Response>(); state.fetch.mockReturnValueOnce(pending.promise); location();
    fireEvent.click(screen.getByRole("button", { name: /Check neighborhood availability|Continue to email verification/ }));
    expect(screen.queryByLabelText("Clerk account form")).not.toBeInTheDocument();
    await waitFor(() => expect(state.fetch).toHaveBeenCalledOnce());
    expect(state.fetch.mock.calls[0][0]).toBe("/api/onboarding/coverage");
    expect(state.fetch.mock.calls[0][1]).toMatchObject({ method: "POST", cache: "no-store" });
    expect(JSON.parse(state.fetch.mock.calls[0][1].body)).toEqual({ latitude: 30.4, longitude: -97.7 });
    await act(async () => pending.resolve(response({ coverage: "available" })));
    await screen.findByRole("heading", { name: "Your area has neighborhood access" }); expect(screen.queryByLabelText("Clerk account form")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Continue to email verification" })); expect(screen.getByLabelText("Clerk account form")).toBeInTheDocument(); expect(screen.getByLabelText("Step 4 of 4")).toBeInTheDocument();
  });
  it("makes an uncovered homeowner explicitly acknowledge restricted access or edit the address", async () => {
    state.fetch.mockResolvedValueOnce(response({ coverage: "unavailable" })); location(); fireEvent.click(screen.getByRole("button", { name: "Check neighborhood availability" }));
    await screen.findByRole("heading", { name: "No neighborhood is available for this address yet" }); expect(screen.queryByLabelText("Clerk account form")).not.toBeInTheDocument(); expect(screen.queryByRole("button", { name: "Continue to email verification" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit address" })).toBeEnabled(); expect(document.body.textContent).not.toMatch(/we(?:'ll| will) email/i);
    fireEvent.click(screen.getByRole("button", { name: "Continue without neighborhood access" })); expect(screen.getByLabelText("Clerk account form")).toBeInTheDocument();
  });
  it("rechecks saved homeowner drafts rather than flashing the account step", async () => {
    const pending = deferred<Response>(); state.fetch.mockReturnValueOnce(pending.promise); draft(); render(<NamedSignUp />);
    expect(screen.queryByLabelText("Clerk account form")).not.toBeInTheDocument(); await waitFor(() => expect(state.fetch).toHaveBeenCalledOnce()); expect(screen.getByLabelText("Step 3 of 4")).toBeInTheDocument();
    await act(async () => pending.resolve(response({ coverage: "unavailable" }))); await screen.findByRole("heading", { name: "No neighborhood is available for this address yet" }); expect(state.router.replace).not.toHaveBeenCalled();
  });
  it("preserves existing-session consent, checks coverage after acceptance, and only then authorizes profile handoff", async () => {
    const pending = deferred<Response>(); state.fetch.mockReturnValueOnce(pending.promise); draft(); render(<NamedSignUp alreadyVerified />);
    expect(screen.getByRole("heading", { name: "You’re already signed in" })).toBeInTheDocument(); expect(state.fetch).not.toHaveBeenCalled(); expect(state.router.replace).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Continue with this account" })); await waitFor(() => expect(state.fetch).toHaveBeenCalledOnce()); expect(state.router.replace).not.toHaveBeenCalled(); expect(screen.queryByLabelText("Clerk account form")).not.toBeInTheDocument();
    await act(async () => pending.resolve(response({ coverage: "unavailable" }))); await screen.findByRole("heading", { name: "No neighborhood is available for this address yet" }); expect(state.router.replace).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Continue without neighborhood access" })); expect(state.router.replace).toHaveBeenCalledWith("/get-started/profile"); expect(getOnboardingDraft()?.completionAuthorized).toBe(true);
  });
  it("leaves resumed provider account and six-step progress unchanged without a homeowner coverage request", () => {
    draft("provider"); render(<NamedSignUp />); expect(screen.getByLabelText("Clerk account form")).toBeInTheDocument(); expect(screen.getByLabelText("Step 6 of 6")).toBeInTheDocument(); expect(state.fetch).not.toHaveBeenCalled();
  });
  it.each([{ body: {}, status: 200 }, { body: { coverage: "maybe" }, status: 200 }, { body: { coverage: "available", communityId: "private" }, status: 200 }, { body: { error: "Slow down" }, status: 429 }, { body: { error: "Unavailable" }, status: 503 }])("keeps account creation gated after malformed or failed check: %j", async ({ body, status }) => {
    state.fetch.mockResolvedValueOnce(response(body, status)); draft(); render(<NamedSignUp />);
    await screen.findByRole("heading", { name: "We could not check neighborhood availability" }); expect(screen.queryByLabelText("Clerk account form")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Continue without neighborhood access" })).not.toBeInTheDocument();
    state.fetch.mockResolvedValueOnce(response({ coverage: "available" })); fireEvent.click(screen.getByRole("button", { name: "Try again" })); await screen.findByRole("heading", { name: "Your area has neighborhood access" }); expect(screen.queryByLabelText("Clerk account form")).not.toBeInTheDocument();
  });
  it("ignores a stale response after editing and confirming a different address", async () => {
    const first = deferred<Response>(); const second = deferred<Response>(); state.fetch.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise); draft(); render(<NamedSignUp />); await waitFor(() => expect(state.fetch).toHaveBeenCalledOnce());
    const oldSignal = state.fetch.mock.calls[0][1].signal as AbortSignal; fireEvent.click(screen.getByRole("button", { name: "Edit address" })); expect(oldSignal.aborted).toBe(true); state.secondAddress = true;
    fireEvent.click(screen.getByRole("button", { name: "Check neighborhood availability" })); await waitFor(() => expect(state.fetch).toHaveBeenCalledTimes(2)); expect(JSON.parse(state.fetch.mock.calls[1][1].body)).toEqual({ latitude: 40, longitude: -100 });
    await act(async () => second.resolve(response({ coverage: "unavailable" }))); await screen.findByRole("heading", { name: "No neighborhood is available for this address yet" });
    await act(async () => first.resolve(response({ coverage: "available" }))); expect(screen.queryByRole("heading", { name: "Your area has neighborhood access" })).not.toBeInTheDocument(); expect(screen.queryByLabelText("Clerk account form")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Continue without neighborhood access" })); expect(getOnboardingDraft()).toMatchObject({ address: "2 Pine St", latitude: 40, longitude: -100 });
  });
});
