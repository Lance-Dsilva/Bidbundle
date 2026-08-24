// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BundleenAuthLoader } from "@/components/auth/BundleenAuthLoader";

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  Object.defineProperty(window.navigator, "onLine", { value: true, configurable: true });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("BundleenAuthLoader", () => {
  it("is a single polite live region rather than one per animation frame", () => {
    render(<BundleenAuthLoader context="sign-in" />);
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveAttribute("aria-busy", "true");
    // Only the status sentence is announced; the house is decorative.
    expect(status.querySelectorAll('[aria-live]')).toHaveLength(0);
  });

  it("hides the house animation from assistive technology", () => {
    const { container } = render(<BundleenAuthLoader />);
    const svgHost = container.querySelector("svg")?.closest("[aria-hidden]");
    expect(svgHost).not.toBeNull();
  });

  it.each([
    ["sign-in" as const, /secure sign-in/i],
    ["sign-up" as const, /secure sign-up/i],
    ["invitation" as const, /invitation/i],
    ["profile" as const, /profile/i],
    ["redirect" as const, /dashboard/i],
  ])("uses copy specific to the %s context", (context, pattern) => {
    render(<BundleenAuthLoader context={context} />);
    expect(screen.getByRole("status")).toHaveTextContent(pattern);
  });

  it("prefers explicit copy over the context default", () => {
    render(<BundleenAuthLoader context="sign-in" title="Custom headline" detail="Custom detail" />);
    expect(screen.getByText("Custom headline")).toBeInTheDocument();
    expect(screen.getByText("Custom detail")).toBeInTheDocument();
  });

  it("offers a retry once Clerk has not initialized within the timeout", async () => {
    const onRetry = vi.fn();
    render(<BundleenAuthLoader timeoutMs={1_000} onRetry={onRetry} />);

    expect(screen.queryByRole("button", { name: /try again/i })).toBeNull();
    vi.advanceTimersByTime(1_000);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument(),
    );
    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "false");
    screen.getByRole("button", { name: /try again/i }).click();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("names the offline case specifically instead of blaming Clerk", async () => {
    Object.defineProperty(window.navigator, "onLine", { value: false, configurable: true });
    render(<BundleenAuthLoader timeoutMs={500} />);
    vi.advanceTimersByTime(500);
    await waitFor(() => expect(screen.getByText(/appear to be offline/i)).toBeInTheDocument());
  });

  it("never surfaces a raw provider error string", async () => {
    render(<BundleenAuthLoader timeoutMs={100} />);
    vi.advanceTimersByTime(100);
    await waitFor(() => expect(screen.getByRole("status")).toBeInTheDocument());
    const text = screen.getByRole("status").textContent ?? "";
    expect(text).not.toMatch(/clerk/i);
    expect(text).not.toMatch(/error:/i);
  });

  it("waits forever when the timeout is disabled", () => {
    render(<BundleenAuthLoader timeoutMs={0} />);
    vi.advanceTimersByTime(60_000);
    expect(screen.queryByRole("button", { name: /try again/i })).toBeNull();
  });

  it("guards every animation behind prefers-reduced-motion", () => {
    const { container } = render(<BundleenAuthLoader />);
    const styles = Array.from(container.querySelectorAll("style")).map((node) => node.textContent ?? "");
    const combined = styles.join("\n");
    expect(combined).toContain("prefers-reduced-motion");
    // Each `animation:` declaration must sit inside a motion-safe block.
    for (const block of combined.split("@media").slice(1)) {
      if (!block.includes("animation:")) continue;
      expect(block).toMatch(/prefers-reduced-motion/);
    }
  });
});
