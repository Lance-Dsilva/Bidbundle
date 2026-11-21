// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { HoaRevenueSharePanel } from "@/components/hoa/HoaRevenueSharePanel";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const fetcher = vi.fn();
const view = { communityId: "c1", rateBps: 500, payoutStatus: "pending", payoutHoldReason: null, currentMonth: "2026-11", monthSavingsCents: 20000, monthEarnedCents: 1000, savingsCents: 40000, earnedCents: 2000, availableCents: -150, statements: [{ id: "s1", periodStart: "2026-10-01", periodEnd: "2026-11-01", totalCents: 500, availableCents: 500, distributedCents: 0, closingBalanceCents: 500, status: "accruing", reference: null, paidAt: null }] };
beforeEach(() => { vi.resetAllMocks(); vi.stubGlobal("fetch", fetcher); fetcher.mockImplementation(async () => Response.json(view)); });
it("shows monthly totals and negative carried balance without manager payment controls", async () => {
 render(<HoaRevenueSharePanel communityId="c1" />);
 await screen.findByText("-$1.50"); expect(screen.getByText("$200.00")).toBeTruthy();
 expect(screen.queryByText("Save share rate")).toBeNull(); expect(screen.queryByText("Record payment already made")).toBeNull();
 expect(screen.getByRole("link", { name: "Download CSV" }).getAttribute("href")).toBe("/api/hoa/communities/c1/revenue-share/statements/s1?format=csv");
});
it("posts integer basis points only, never a client amount or identity", async () => {
 render(<HoaRevenueSharePanel communityId="c1" admin />); await screen.findByLabelText("Association share (%)");
 fireEvent.change(screen.getByLabelText("Association share (%)"), { target: { value: "2.35" } }); fireEvent.click(screen.getByText("Save share rate"));
 await waitFor(() => expect(fetcher.mock.calls.some(([, options]) => options?.method === "POST")).toBe(true));
 const [url, options] = fetcher.mock.calls.find(([, options]) => options?.method === "POST")!;
 expect(url).toBe("/api/admin/communities/c1/revenue-share"); expect(JSON.parse(options.body)).toEqual({ action: "rate", rateBps: 235 });
});
it("prevents overlapping manual payment submissions and keeps failed reference visible", async () => {
 let finish!: (response: Response) => void;
 fetcher.mockImplementation((_url, options) => options?.method === "POST" ? new Promise(resolve => { finish = resolve; }) : Promise.resolve(Response.json(view)));
 render(<HoaRevenueSharePanel communityId="c1" admin />); await screen.findByLabelText("Manual payment reference");
 fireEvent.change(screen.getByLabelText("Manual payment reference"), { target: { value: "check-123" } });
 const button = screen.getByText("Record payment already made"); fireEvent.click(button); fireEvent.click(button);
 expect(fetcher.mock.calls.filter(([, options]) => options?.method === "POST")).toHaveLength(1);
 finish(Response.json({ error: "Transfer is being reconciled." }, { status: 409 })); await screen.findByRole("alert");
 expect((screen.getByLabelText("Manual payment reference") as HTMLInputElement).value).toBe("check-123");
});
it("shows a reconciliation hold and disables payout/manual controls", async () => {
 fetcher.mockResolvedValue(Response.json({ ...view, payoutHoldReason: "Financial reconciliation required" }));
 render(<HoaRevenueSharePanel communityId="c1" admin />); await screen.findByText(/Payouts are paused/);
 expect((screen.getByText("Send sandbox payout") as HTMLButtonElement).disabled).toBe(true);
 expect((screen.getByText("Record payment already made") as HTMLButtonElement).disabled).toBe(true);
});
it("rejects a non-Stripe onboarding redirect", async () => {
 fetcher.mockImplementation(async (_url, options) => Response.json(options?.method === "POST" ? { url: "https://evil.invalid/account" } : view));
 render(<HoaRevenueSharePanel communityId="c1" />); await screen.findByText("Set up association payouts"); fireEvent.click(screen.getByText("Set up association payouts"));
 expect((await screen.findByRole("alert")).textContent).toContain("not valid");
});

it("allows pending payout reconciliation while new payouts and manual payment remain held", async () => {
 fetcher.mockImplementation(async (_url, options) => options?.method === "POST" ? Response.json({ status: "pending" }) : Response.json({ ...view, payoutHoldReason: "Review required", statements: [{ ...view.statements[0], status: "pending", availableCents: 0 }] }));
 render(<HoaRevenueSharePanel communityId="c1" admin />); const reconcile = await screen.findByText("Reconcile pending sandbox payout");
 expect((reconcile as HTMLButtonElement).disabled).toBe(false); expect((screen.getByText("Record payment already made") as HTMLButtonElement).disabled).toBe(true);
 fireEvent.click(reconcile); await waitFor(() => expect(fetcher.mock.calls.some(([, options]) => options?.method === "POST" && JSON.parse(options.body).action === "payout")).toBe(true));
});
