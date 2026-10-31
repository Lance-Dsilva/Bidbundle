// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HomeownerCoverageStep } from "@/components/onboarding/HomeownerCoverageStep";
const fetchMock = vi.fn();
function response(coverage: "available" | "unavailable") { return new Response(JSON.stringify({ coverage }), { status: 200 }); }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((yes) => { resolve = yes; }); return { promise, resolve }; }
const point = { address: "1 Oak St", latitude: 30.4, longitude: -97.7 };
beforeEach(() => { fetchMock.mockReset().mockResolvedValue(response("available")); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });
describe("coverage step request ownership", () => {
  it("never reuses an old point's successful decision while a changed point is loading", async () => {
    const pending = deferred<Response>(); const next = vi.fn(); fetchMock.mockResolvedValueOnce(response("available")).mockReturnValueOnce(pending.promise);
    const view = render(<HomeownerCoverageStep {...point} onBack={() => {}} onContinue={next} />); await screen.findByRole("heading", { name: "Your area has neighborhood access" });
    view.rerender(<HomeownerCoverageStep {...point} latitude={40} address="2 Pine St" onBack={() => {}} onContinue={next} />);
    expect(screen.getByRole("heading", { name: "Checking your neighborhood" })).toBeInTheDocument(); expect(screen.queryByRole("button", { name: "Continue to email verification" })).not.toBeInTheDocument();
    await act(async () => pending.resolve(response("unavailable"))); await screen.findByRole("heading", { name: "No neighborhood is available for this address yet" }); expect(next).not.toHaveBeenCalled();
  });
  it("allows one explicit continuation for the current decision even if its parent remains mounted", async () => {
    const next = vi.fn(); render(<HomeownerCoverageStep {...point} onBack={() => {}} onContinue={next} />); await screen.findByRole("heading", { name: "Your area has neighborhood access" });
    const button = screen.getByRole("button", { name: "Continue to email verification" }); fireEvent.click(button); fireEvent.click(button); expect(next).toHaveBeenCalledOnce();
  });
  it("latches retries and preserves a recoverable network failure without account continuation", async () => {
    const pending = deferred<Response>(); fetchMock.mockRejectedValueOnce(new Error("offline")).mockReturnValueOnce(pending.promise); const next = vi.fn(); render(<HomeownerCoverageStep {...point} onBack={() => {}} onContinue={next} />);
    await screen.findByRole("heading", { name: "We could not check neighborhood availability" }); const retry = screen.getByRole("button", { name: "Try again" }); fireEvent.click(retry); fireEvent.click(retry);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2)); expect(next).not.toHaveBeenCalled(); await act(async () => pending.resolve(response("available"))); await screen.findByRole("heading", { name: "Your area has neighborhood access" });
  });
  it("turns an aborted stalled fetch into a retryable error rather than indefinite loading", async () => {
    vi.useFakeTimers(); fetchMock.mockImplementationOnce((_path: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => { init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError"))); }));
    render(<HomeownerCoverageStep {...point} onBack={() => {}} onContinue={() => {}} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); }); expect(screen.getByRole("heading", { name: "We could not check neighborhood availability" })).toHaveFocus(); expect(screen.getByRole("button", { name: "Try again" })).toBeEnabled(); expect(screen.queryByRole("button", { name: "Continue to email verification" })).not.toBeInTheDocument();
  });
  it("aborts owned work on unmount and ignores a later result", async () => {
    const pending = deferred<Response>(); fetchMock.mockReturnValueOnce(pending.promise); const next = vi.fn(); const view = render(<HomeownerCoverageStep {...point} onBack={() => {}} onContinue={next} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce()); const signal = fetchMock.mock.calls[0][1].signal as AbortSignal; view.unmount(); expect(signal.aborted).toBe(true); await act(async () => pending.resolve(response("available"))); expect(next).not.toHaveBeenCalled();
  });
  it("keeps the pending retry's primary control in place so a repeated interaction cannot become Edit address", async () => {
    const pending = deferred<Response>(); const back = vi.fn(); const next = vi.fn();
    fetchMock.mockRejectedValueOnce(new Error("offline")).mockReturnValueOnce(pending.promise);
    render(<HomeownerCoverageStep {...point} onBack={back} onContinue={next} />);
    await screen.findByRole("heading", { name: "We could not check neighborhood availability" });
    const retry = screen.getByRole("button", { name: "Try again" }); retry.focus(); fireEvent.click(retry);
    // JSDOM cannot prove pointer geometry or card re-centering. Preserving the
    // same disabled primary control is the observable pending-state contract;
    // the real pointer double-click reproduction remains a browser review gate.
    expect(retry).toBeInTheDocument(); expect(retry).toBeDisabled();
    fireEvent.click(retry, { detail: 2 }); expect(back).not.toHaveBeenCalled(); expect(next).not.toHaveBeenCalled(); expect(fetchMock).toHaveBeenCalledTimes(2);
    await act(async () => pending.resolve(response("unavailable"))); await screen.findByRole("heading", { name: "No neighborhood is available for this address yet" }); expect(back).not.toHaveBeenCalled(); expect(next).not.toHaveBeenCalled();
  });

  it("does not reinterpret the second click of a fast retry as an account continuation", async () => {
    const next = vi.fn(); const back = vi.fn(); fetchMock.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(response("available"));
    render(<HomeownerCoverageStep {...point} onBack={back} onContinue={next} />); await screen.findByRole("heading", { name: "We could not check neighborhood availability" });
    fireEvent.click(screen.getByRole("button", { name: "Try again" }), { detail: 1 }); await screen.findByRole("heading", { name: "Your area has neighborhood access" });
    const continuation = screen.getByRole("button", { name: "Continue to email verification" });
    fireEvent.click(continuation, { detail: 2 }); expect(next).not.toHaveBeenCalled(); expect(back).not.toHaveBeenCalled(); expect(fetchMock).toHaveBeenCalledTimes(2);
    fireEvent.click(continuation, { detail: 0 }); expect(next).toHaveBeenCalledOnce();
  });

});
