// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ fetch: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: m.refresh }) }));
import { AdminPaymentRefund } from "@/components/billing/AdminPaymentRefund";
const ok = (body: unknown) => ({ ok: true, json: async () => body });
beforeEach(() => { vi.resetAllMocks(); vi.stubGlobal("fetch", m.fetch); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const show = (operations: Array<{id: string; state: string; amountCents: number}> = [], eligible = true) => render(<AdminPaymentRefund visitId="visit" amountCents={1000} refundedCents={200} operations={operations} eligible={eligible} />);
it("requires confirmation and rejects amounts exceeding the remaining balance", async () => {
  show(); const button = screen.getByRole("button", { name: "Request test refund" }); expect(button).toBeDisabled();
  fireEvent.click(screen.getByRole("checkbox")); fireEvent.change(screen.getByLabelText("Refund amount (USD)"), { target: { value: "8.01" } }); fireEvent.click(button);
  expect(await screen.findByRole("status")).toHaveTextContent("remaining paid balance"); expect(m.fetch).not.toHaveBeenCalled();
});
it("reuses the same request after network uncertainty and prevents changing its amount", async () => {
  m.fetch.mockRejectedValueOnce(new Error("Network interrupted")).mockResolvedValueOnce(ok({ state: "succeeded" })); show();
  fireEvent.click(screen.getByRole("checkbox")); const button = screen.getByRole("button", { name: "Request test refund" }); fireEvent.click(button);
  await screen.findByText("Network interrupted"); expect(screen.getByLabelText("Refund amount (USD)")).toBeDisabled(); fireEvent.click(button);
  await screen.findByText("Refund and required reversal completed.");
  expect(JSON.parse(m.fetch.mock.calls[0][1].body)).toEqual(JSON.parse(m.fetch.mock.calls[1][1].body));
  expect(JSON.parse(m.fetch.mock.calls[0][1].body)).toMatchObject({ amountCents: 800, confirmed: true }); expect(m.refresh).toHaveBeenCalledTimes(1);
});
it("retries the existing reservation without offering a second refund", async () => {
  m.fetch.mockResolvedValue(ok({ state: "reversal_pending" })); show([{ id: "existing", state: "reversal_pending", amountCents: 300 }]);
  expect(screen.queryByRole("checkbox")).toBeNull(); fireEvent.click(screen.getByRole("button", { name: "Retry saved refund" }));
  await waitFor(() => expect(m.refresh).toHaveBeenCalled()); expect(JSON.parse(m.fetch.mock.calls[0][1].body)).toEqual({ action: "retry", id: "existing" });
  expect(screen.getByRole("status")).toHaveTextContent("processing is pending");
});
it("does not offer refunds for unpaid visits", () => { show([], false); expect(screen.queryByRole("button")).toBeNull(); expect(screen.getByText(/only after a successful payment/)).toBeTruthy(); });
