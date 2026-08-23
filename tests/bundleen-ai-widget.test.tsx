// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BundleenAiWidget } from "@/components/ai/BundleenAiWidget";
import { installMatchMediaStub } from "./stubs/match-media";

function mockFetchOk() {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/ai/history")) {
      return new Response(JSON.stringify({ messages: [] }), { status: 200 });
    }
    return new Response(JSON.stringify({}), { status: 200 });
  });
}

describe("BundleenAiWidget", () => {
  beforeEach(() => {
    installMatchMediaStub(false); // desktop by default
    vi.stubGlobal("fetch", mockFetchOk());
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders exactly one launcher and no panel until opened", () => {
    render(<BundleenAiWidget />);

    expect(screen.getAllByRole("button", { name: "Open Bundleen AI" })).toHaveLength(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    // Nothing should be fetched for a closed widget.
    expect(fetch).not.toHaveBeenCalled();
  });

  it("opens the panel on click, loads history, and closes on Escape returning focus to the launcher", async () => {
    render(<BundleenAiWidget />);
    const launcher = screen.getByRole("button", { name: "Open Bundleen AI" });

    fireEvent.click(launcher);

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toBeInTheDocument();
    await waitFor(() => expect(fetch).toHaveBeenCalled());

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(document.activeElement).toBe(launcher);
  });

  it("closes via the in-panel close control", async () => {
    render(<BundleenAiWidget />);
    fireEvent.click(screen.getByRole("button", { name: "Open Bundleen AI" }));
    await screen.findByRole("dialog");

    const closeButton = await screen.findByRole("button", { name: "Close Bundleen AI chat" });
    fireEvent.click(closeButton);

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("presents a non-modal popover on desktop and a modal sheet on mobile", async () => {
    const mediaStub = installMatchMediaStub(false);
    const { unmount } = render(<BundleenAiWidget />);
    fireEvent.click(screen.getByRole("button", { name: "Open Bundleen AI" }));
    let dialog = await screen.findByRole("dialog");
    expect(dialog).not.toHaveAttribute("aria-modal", "true");
    unmount();

    mediaStub.setMatches(true);
    render(<BundleenAiWidget />);
    fireEvent.click(screen.getByRole("button", { name: "Open Bundleen AI" }));
    dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
  });
});
