// @vitest-environment jsdom
import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NamedSignUp } from "@/components/auth/NamedSignUp";
import { saveOnboardingDraft } from "@/lib/onboarding-draft";
const state = vi.hoisted(() => ({ router: { prefetch: vi.fn(), replace: vi.fn() }, signOut: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => state.router }));
vi.mock("@clerk/nextjs", () => ({
  useClerk: () => ({ signOut: state.signOut }), useUser: () => ({ user: null }),
  SignUp: () => <div aria-label="Clerk account form">Clerk account</div>,
  ClerkLoaded: ({ children }: { children: ReactNode }) => <>{children}</>, ClerkLoading: () => null,
}));
// Progress is the parent's responsibility. The network/map/business boundaries
// below expose their real parent-supplied counters through the real indicator.
vi.mock("@/components/onboarding/VerifyAreaStep", async () => {
  const { StepProgress } = await import("@/components/onboarding/StepProgress");
  return { VerifyAreaStep: ({ stepNumber = 3, stepCount = 4, onBack, onConfirm, confirmLabel }: { stepNumber?: number; stepCount?: number; onBack: () => void; onConfirm: (location: { address: string; neighborhood: string; latitude: number; longitude: number }) => void; confirmLabel?: string }) => <section><h1>Verified location boundary</h1><StepProgress current={stepNumber} total={stepCount} /><p>Step {stepNumber} of {stepCount}</p><button onClick={onBack}>Back</button><button onClick={() => onConfirm({ address: "1 Oak St", neighborhood: "Oakwood", latitude: 30.4, longitude: -97.7 })}>{confirmLabel}</button></section> };
});
vi.mock("@/components/onboarding/ProviderBusinessStep", async () => {
  const { StepProgress } = await import("@/components/onboarding/StepProgress");
  return { ProviderBusinessStep: ({ stepNumber = 3, stepCount = 5, onBack, onContinue }: { stepNumber?: number; stepCount?: number; onBack: () => void; onContinue: () => void }) => <section><h1>Business boundary</h1><StepProgress current={stepNumber} total={stepCount} /><p>Step {stepNumber} of {stepCount}</p><button onClick={onBack}>Back</button><button onClick={onContinue}>Continue to your service area</button></section> };
});
vi.mock("@/components/onboarding/ProviderCoverageStep", async () => {
  const { StepProgress } = await import("@/components/onboarding/StepProgress");
  return { ProviderCoverageStep: ({ stepNumber = 5, stepCount = 6, onBack, onContinue }: { stepNumber?: number; stepCount?: number; onBack: () => void; onContinue: () => void }) => <section><h1>Coverage boundary</h1><StepProgress current={stepNumber} total={stepCount} /><p>Step {stepNumber} of {stepCount}</p><button onClick={onBack}>Back</button><button onClick={onContinue}>Continue to email verification</button></section> };
});
function progress(current: number, total: number) {
  const indicator = screen.getByLabelText(`Step ${current} of ${total}`);
  expect(indicator).toBeInTheDocument();
  expect(indicator.children).toHaveLength(total);
  expect(screen.getByText(`Step ${current} of ${total}`)).toBeInTheDocument();
}
function nameToRole() {
  fireEvent.change(screen.getByLabelText("First name"), { target: { value: "Jane" } });
  fireEvent.change(screen.getByLabelText("Surname"), { target: { value: "Smith" } });
  fireEvent.click(screen.getByRole("button", { name: "Continue to role" }));
}
function selectRole(role: "Homeowner" | "Service Provider") { fireEvent.click(screen.getByRole("button", { name: new RegExp(role) })); }
function nextRole() { fireEvent.click(screen.getByRole("button", { name: /^Continue$/ })); }
beforeEach(() => { sessionStorage.clear(); vi.clearAllMocks(); });
afterEach(cleanup);

describe("signup progress across each role's complete journey", () => {
  it("starts with the four-step homeowner journey before a role is chosen", () => { render(<NamedSignUp />); progress(1, 4); expect(screen.queryByLabelText("Clerk account form")).not.toBeInTheDocument(); });

  it("keeps homeowner name, role, location and account numbered 1–4 out of 4", () => {
    render(<NamedSignUp />); progress(1, 4); nameToRole(); progress(2, 4);
    nextRole(); progress(3, 4); fireEvent.click(screen.getByRole("button", { name: "Continue to email verification" }));
    progress(4, 4); expect(screen.getByLabelText("Clerk account form")).toBeInTheDocument();
  });

  it("keeps provider role, location, business, coverage and account numbered 2–6 out of 6", () => {
    render(<NamedSignUp />); nameToRole(); selectRole("Service Provider"); progress(2, 6);
    nextRole(); progress(3, 6); fireEvent.click(screen.getByRole("button", { name: "Continue to business details" }));
    progress(4, 6); fireEvent.click(screen.getByRole("button", { name: "Continue to your service area" }));
    progress(5, 6); fireEvent.click(screen.getByRole("button", { name: "Back" })); progress(4, 6);
    fireEvent.click(screen.getByRole("button", { name: "Back" })); progress(3, 6);
    fireEvent.click(screen.getByRole("button", { name: "Continue to business details" })); progress(4, 6);
    fireEvent.click(screen.getByRole("button", { name: "Continue to your service area" })); progress(5, 6);
    fireEvent.click(screen.getByRole("button", { name: "Continue to email verification" }));
    progress(6, 6); expect(screen.getByLabelText("Clerk account form")).toBeInTheDocument();
  });

  it("recalculates totals when switching roles and preserves provider progress when going back", () => {
    render(<NamedSignUp />); nameToRole(); selectRole("Service Provider"); progress(2, 6);
    fireEvent.click(screen.getByRole("button", { name: "Back" })); progress(1, 6);
    fireEvent.click(screen.getByRole("button", { name: "Continue to role" })); progress(2, 6);
    selectRole("Homeowner"); progress(2, 4); nextRole(); progress(3, 4);
    fireEvent.click(screen.getByRole("button", { name: "Back" })); progress(2, 4);
    selectRole("Service Provider"); progress(2, 6);
  });

  it("restores a saved provider account at 6 of 6 and Edit details returns to role 2 of 6", () => {
    saveOnboardingDraft({ name: { firstName: "Jane", lastName: "Smith" }, role: "provider", address: "1 Oak St", neighborhood: "Oakwood", latitude: 30.4, longitude: -97.7, providerBusiness: { companyName: "Company", bio: "", services: ["cleaning"], serviceArea: "Oakwood", licenseNumber: "", insuranceProvider: "" }, providerCoverage: { label: "Oakwood", centerLatitude: 30.4, centerLongitude: -97.7, radiusMiles: 5, formattedAddress: "1 Oak St", locality: "Oakwood", region: null, postalCode: null, countryCode: null }, completionAuthorized: true });
    render(<NamedSignUp />); progress(6, 6); expect(screen.getByLabelText("Clerk account form")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit details" })); progress(2, 6);
  });

  it("does not treat existing-session confirmation as an extra signup stage or bypass it", () => {
    render(<NamedSignUp alreadyVerified />);
    expect(screen.getByRole("heading", { name: "You’re already signed in" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Step 1 of 4")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Clerk account form")).not.toBeInTheDocument();
    expect(state.router.replace).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Continue with this account" }));
    progress(1, 4); expect(state.signOut).not.toHaveBeenCalled();
  });
});
