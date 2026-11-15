// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AiChatMessage, AiChatStatus } from "@/hooks/useBundleenAi";
const state = vi.hoisted(() => ({ messages: [] as AiChatMessage[], status: "idle" as AiChatStatus, error: null as string | null, send: vi.fn(), retry: vi.fn(), clear: vi.fn() }));
vi.mock("@/hooks/useBundleenAi", () => ({ useBundleenAi: () => ({ ...state, sources: [] }) }));
import { BundleenAiPanel } from "@/components/ai/BundleenAiPanel";
import { BundleenAiWidget } from "@/components/ai/BundleenAiWidget";
import { installMatchMediaStub } from "./stubs/match-media";

beforeEach(() => { state.messages = []; state.status = "idle"; state.error = null; vi.clearAllMocks(); installMatchMediaStub(true); document.body.style.overflow = ""; });
afterEach(() => { cleanup(); document.body.style.overflow = ""; });

describe("mobile AI message composer", () => {
  it("keeps a labelled 44-pixel square send target from shrinking beside a flexible input", () => {
    render(<BundleenAiPanel />);
    const send = screen.getByRole("button", { name: "Send message" });
    expect(send).toHaveStyle({ width: "44px", height: "44px", minWidth: "44px", minHeight: "44px", flexShrink: "0" });
    const input = screen.getByPlaceholderText("Ask Bundleen AI anything…");
    expect(Number.parseFloat(getComputedStyle(input).minWidth)).toBe(0);
    expect(input.closest("form")).not.toBeNull(); expect(send).toHaveAttribute("type", "submit"); expect(send).toBeDisabled();
  });
  it("submits a trimmed typed message once through the form and clears the composer", () => {
    render(<BundleenAiPanel />);
    const input = screen.getByPlaceholderText("Ask Bundleen AI anything…"), send = screen.getByRole("button", { name: "Send message" });
    fireEvent.change(input, { target: { value: "  What is open for bids?  " } }); fireEvent.click(send);
    expect(state.send).toHaveBeenCalledExactlyOnceWith("What is open for bids?"); expect(input).toHaveValue(""); expect(send).toBeDisabled();
    fireEvent.submit(input.closest("form")!); expect(state.send).toHaveBeenCalledOnce();
  });
  it("uses the keyboard’s native form submit without issuing a duplicate message", () => {
    render(<BundleenAiPanel />); const input = screen.getByPlaceholderText("Ask Bundleen AI anything…");
    fireEvent.change(input, { target: { value: "Keyboard question" } });
    // JSDOM has no implicit Enter-to-submit action; perform that browser default
    // only if the component did not handle and cancel the key itself.
    act(() => { const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }); if (input.dispatchEvent(event)) fireEvent.submit(input.closest("form")!); });
    expect(state.send).toHaveBeenCalledExactlyOnceWith("Keyboard question");
  });
  it("does not submit Enter while an IME is still composing a message", () => {
    render(<BundleenAiPanel />); const input = screen.getByPlaceholderText("Ask Bundleen AI anything…");
    fireEvent.change(input, { target: { value: "Composing message" } });
    const event = new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true, cancelable: true });
    act(() => { input.dispatchEvent(event); });
    expect(event.defaultPrevented).toBe(true); expect(state.send).not.toHaveBeenCalled(); expect(input).toHaveValue("Composing message");
  });
  it.each(["loading", "streaming"] as const)("does not submit or expose an enabled control while %s", status => {
    const { rerender } = render(<BundleenAiPanel />); const input = screen.getByPlaceholderText("Ask Bundleen AI anything…");
    fireEvent.change(input, { target: { value: "Pending question" } }); state.status = status; rerender(<BundleenAiPanel />);
    expect(input).toBeDisabled(); expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
    fireEvent.submit(input.closest("form")!); expect(state.send).not.toHaveBeenCalled();
  });
  it("focuses a suggested prompt in the composer before the user sends it", () => {
    render(<BundleenAiPanel suggestions={["What is open for bids?"]} />);
    fireEvent.click(screen.getAllByRole("button", { name: "What is open for bids?" })[0]);
    const input = screen.getByPlaceholderText("Ask Bundleen AI anything…");
    expect(input).toHaveValue("What is open for bids?"); expect(input).toHaveFocus(); expect(state.send).not.toHaveBeenCalled();
  });
});

describe("launcher cannot overlap an open AI sheet", () => {
  it.each([true, false])("hides the launcher while open and restores focus after Escape on mobile=%s", async mobile => {
    installMatchMediaStub(mobile); render(<BundleenAiWidget />); const launcher = screen.getByRole("button", { name: "Open Bundleen AI" });
    fireEvent.click(launcher); const dialog = await screen.findByRole("dialog");
    expect(launcher).not.toBeVisible(); expect(screen.queryByRole("button", { name: "Open Bundleen AI" })).not.toBeInTheDocument();
    if (mobile) expect(dialog).toHaveAttribute("aria-modal", "true");
    else expect(dialog).not.toHaveAttribute("aria-modal", "true");
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument()); await waitFor(() => expect(screen.getByRole("button", { name: "Open Bundleen AI" })).toHaveFocus());
    expect(launcher).toBeVisible(); expect(document.body.style.overflow).toBe("");
  });
  it("closes through the in-panel control without leaving focus on a hidden launcher", async () => {
    render(<BundleenAiWidget />); fireEvent.click(screen.getByRole("button", { name: "Open Bundleen AI" }));
    fireEvent.click(await screen.findByRole("button", { name: "Close Bundleen AI chat" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument()); await waitFor(() => expect(screen.getByRole("button", { name: "Open Bundleen AI" })).toHaveFocus());
  });
});
