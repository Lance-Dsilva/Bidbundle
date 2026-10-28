// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { HomeownerShell } from "@/components/layout/HomeownerShell";

const { path } = vi.hoisted(() => ({ path: { value: "/app/homeowner/requests" } }));
vi.mock("next/navigation", () => ({ usePathname: () => path.value }));
vi.mock("@/hooks/useViewerContext", () => ({ useViewerContext: () => ({ context: null }) }));
vi.mock("@/hooks/useNotifications", () => ({ useNotifications: () => ({ notifications: [], loading: false, markRead: vi.fn(), dismiss: vi.fn() }) }));
vi.mock("@/components/ui/NotificationBell", () => ({ NotificationBell: () => null }));
vi.mock("@/components/ai/BundleenAiWidget", () => ({ BundleenAiWidget: () => null }));
afterEach(cleanup);

describe("homeowner requests navigation", () => {
  it.each(["/app/homeowner/requests", "/app/homeowner/request"])("points both navigation entries to My Requests with active state at %s and separate create actions", (pathname) => {
    path.value = pathname;
    render(<HomeownerShell userName="Test Homeowner" unreadMessages={2}><p>Request content</p></HomeownerShell>);
    const desktop = screen.getByRole("complementary", { name: "Homeowner navigation" });
    const mobile = screen.getByRole("navigation", { name: "Mobile navigation" });
    const desktopRequests = within(desktop).getByRole("link", { name: "My Requests" });
    const mobileRequests = within(mobile).getByRole("link", { name: "Requests" });
    for (const link of [desktopRequests, mobileRequests]) {
      expect(link).toHaveAttribute("href", "/app/homeowner/requests");
      expect(link).toHaveClass("is-active");
    }
    expect(screen.getByRole("link", { name: "Create a new request" })).toHaveAttribute("href", "/app/homeowner/request");
    expect(within(mobile).getByRole("link", { name: "New request" })).toHaveAttribute("href", "/app/homeowner/request");
    expect(within(desktop).getByRole("link", { name: /Messages/ })).toHaveTextContent("2");
  });
});
