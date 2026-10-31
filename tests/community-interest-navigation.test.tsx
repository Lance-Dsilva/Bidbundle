// @vitest-environment jsdom
import type { ReactNode } from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ auth: vi.fn(), profile: vi.fn(), manager: vi.fn(), redirect: vi.fn(), pathname: "/app/admin/community-interest" }));
vi.mock("@clerk/nextjs/server", () => ({ auth: state.auth }));
vi.mock("@/lib/server/db", () => ({ db: { user: { findUnique: state.profile } } }));
vi.mock("@/lib/server/hoa", () => ({ isHoaManager: state.manager }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { state.redirect(path); throw new Error(`REDIRECT:${path}`); }, usePathname: () => state.pathname, useSearchParams: () => new URLSearchParams() }));
vi.mock("next/link", () => ({ default: ({ children, href, ...props }: { children: ReactNode; href: string }) => <a href={href} {...props}>{children}</a> }));
// eslint-disable-next-line @next/next/no-img-element -- Semantic image test double; Next image optimization is outside this routing test.
vi.mock("next/image", () => ({ default: ({ alt, src }: { alt: string; src: string }) => <img alt={alt} src={src} /> }));
vi.mock("@/components/auth/AuthShowcase", () => ({ AuthShowcase: () => null }));
vi.mock("@/components/auth/NamedSignUp", () => ({ NamedSignUp: ({ initialRole, alreadyVerified }: { initialRole: string; alreadyVerified: boolean }) => <div data-testid="signup" data-role={initialRole} data-verified={alreadyVerified}>Normal signup</div> }));
vi.mock("@/components/marketing/LandingInteractions", () => ({ LandingInteractions: () => null }));
vi.mock("@/components/ai/BundleenAiWidget", () => ({ BundleenAiWidget: () => null }));
vi.mock("@clerk/nextjs", () => ({ UserButton: () => null }));
import SignUpPage from "@/app/get-started/[[...sign-up]]/page";
import HomePage from "@/app/page";
import { AdminCrmShell } from "@/components/admin/AdminCrmShell";
beforeEach(() => { vi.clearAllMocks(); state.auth.mockResolvedValue({ userId: null }); state.profile.mockResolvedValue(null); state.manager.mockResolvedValue(false); });
afterEach(cleanup);
describe("staff-led community interest routing", () => {
  it("redirects the exact legacy manager intent before session or profile lookup", async () => {
    await expect(SignUpPage({ searchParams: Promise.resolve({ role: undefined, intent: "community-manager" }) })).rejects.toThrow("REDIRECT:/community-onboarding");
    expect(state.redirect).toHaveBeenCalledWith("/community-onboarding"); expect(state.auth).not.toHaveBeenCalled(); expect(state.profile).not.toHaveBeenCalled(); expect(state.manager).not.toHaveBeenCalled();
  });
  it("routes legacy manager intent before a completed provider session too", async () => {
    state.auth.mockResolvedValue({ userId: "verified-provider" }); state.profile.mockResolvedValue({ id: "provider", role: "provider" });
    await expect(SignUpPage({ searchParams: Promise.resolve({ role: "provider", intent: "community-manager" }) })).rejects.toThrow("REDIRECT:/community-onboarding"); expect(state.auth).not.toHaveBeenCalled();
  });
  it.each([undefined, "", "Community-manager", " community-manager ", "https://attacker.test", ["community-manager", "other"]])("does not treat another intent as a manager redirect: %j", async (intent) => {
    render(await SignUpPage({ searchParams: Promise.resolve({ role: "provider", intent }) })); expect(screen.getByTestId("signup")).toHaveAttribute("data-role", "provider"); expect(state.redirect).not.toHaveBeenCalled();
  });
  it("preserves normal existing-account dashboard authority ahead of a role hint", async () => {
    state.auth.mockResolvedValue({ userId: "verified-provider" }); state.profile.mockResolvedValue({ id: "provider", role: "provider" });
    await expect(SignUpPage({ searchParams: Promise.resolve({ role: "homeowner", intent: "other" }) })).rejects.toThrow("REDIRECT:/app/provider/dashboard");
  });
  it("points every manager homepage CTA to interest while retaining provider signup", () => {
    render(<HomePage />); const links = screen.getAllByRole("link", { name: /^(Get started|Set up your community)$/, hidden: true }); expect(links).toHaveLength(4); for (const link of links) expect(link).toHaveAttribute("href", "/community-onboarding"); for (const link of screen.getAllByRole("link", { name: /Join as a provider/i })) expect(link).toHaveAttribute("href", "/get-started?role=provider");
  });
  it("makes the staff queue discoverable in the customer navigation", () => {
    render(<AdminCrmShell userName="Ops" userEmail="ops@example.invalid" accessLevel="admin" isStaffAccount={false} permissions={[]}>Queue</AdminCrmShell>);
    expect(screen.getByRole("link", { name: /Community interest/ })).toHaveAttribute("href", "/app/admin/community-interest");
  });
  it("identifies the queue in the actual workspace banner and retains authorized account creation", () => {
    render(<AdminCrmShell userName="Ops" userEmail="ops@example.invalid" accessLevel="admin" isStaffAccount={false} permissions={[]}>Queue</AdminCrmShell>);
    const banner = within(screen.getByRole("banner"));
    expect(banner.getByText("Customers", { exact: true })).toBeInTheDocument();
    expect(banner.getByText("Community interest", { exact: true })).toBeInTheDocument();
    expect(banner.queryByText("Workspace", { exact: true })).not.toBeInTheDocument();
    expect(banner.queryByText("Operations overview", { exact: true })).not.toBeInTheDocument();
    expect(banner.getByRole("link", { name: "New HOA account" })).toHaveAttribute("href", "/app/admin/communities#new-account");
    expect(screen.getByRole("link", { name: /Community interest/ })).toHaveAttribute("href", "/app/admin/community-interest");
  });
});
