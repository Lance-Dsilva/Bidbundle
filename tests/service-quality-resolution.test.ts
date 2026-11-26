import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
 claim: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn() }, payment: vi.fn(), refund: vi.fn(), visit: vi.fn(), createVisit: vi.fn(),
 raw: vi.fn(), owner: vi.fn(), reserve: vi.fn(), process: vi.fn(), ticket: vi.fn(), message: vi.fn(), event: vi.fn(), notify: vi.fn(), occurrence: vi.fn(), max: vi.fn(),
}));
vi.mock("@/lib/server/db", () => { const tx = { $queryRaw: m.raw, serviceQualityClaim: m.claim, stripeTestPayment: { findUnique: m.payment }, stripeTestRefund: { findUnique: m.refund }, serviceVisit: { findUnique: m.visit, findUniqueOrThrow: m.visit, create: m.createVisit }, supportTicket: { update: m.ticket }, supportTicketMessage: { create: m.message }, supportTicketEvent: { create: m.event }, notification: { createMany: m.notify }, serviceOccurrence: { aggregate: m.max, create: m.occurrence } }; return { db: { ...tx, $transaction: (fn: (tx: unknown) => unknown) => fn(tx) } }; });
vi.mock("@/lib/server/stripe-test-refunds", () => ({ requireStripeRefundOwner: m.owner, reserveStripeTestRefund: m.reserve, processStripeTestRefund: m.process }));
import { executeQualityRefund, reconcileQualityResolution, scheduleQualityRedo } from "@/lib/server/service-quality-resolution";
const claim = { id: "claim", visitId: "visit", ticketId: "ticket", requesterUserId: "reporter", providerUserId: "provider", financialPayerUserId: "original", resolution: "refund_pending", refundOperationId: null, redoVisitId: null, resolvedAt: null };
const input = { operationId: "op", amountCents: 400, note: "Agreed partial compensation" };
beforeEach(() => { vi.resetAllMocks(); m.claim.findUnique.mockResolvedValue({ visitId: "visit" }); m.claim.findUniqueOrThrow.mockResolvedValue({ ...claim }); m.payment.mockResolvedValue({ residentUserId: "original", currency: "usd" }); m.reserve.mockResolvedValue({ id: "op" }); });
it("reserves the explicit amount and immutable original payer linkage atomically", async () => {
 await executeQualityRefund("owner", "claim", input);
 expect(m.owner).toHaveBeenCalled(); expect(m.reserve).toHaveBeenCalledWith(expect.anything(), "owner", "visit", { id: "op", amountCents: 400, reason: "service_quality" });
 expect(m.claim.update).toHaveBeenCalledWith({ where: { id: "claim" }, data: { refundOperationId: "op" } });
 expect(m.claim.update.mock.invocationCallOrder[0]).toBeLessThan(m.process.mock.invocationCallOrder[0]);
 expect(m.message.mock.calls[0][0].data.body).toContain("4.00 USD");
});
it("rejects changed financial payer and never targets the replacement reporter", async () => {
 m.payment.mockResolvedValue({ residentUserId: "reporter" });
 await expect(executeQualityRefund("owner", "claim", input)).rejects.toMatchObject({ status: 409 }); expect(m.reserve).not.toHaveBeenCalled();
});
it("refuses a second operation identity", async () => { m.claim.findUniqueOrThrow.mockResolvedValue({ ...claim, refundOperationId: "prior" }); await expect(executeQualityRefund("owner", "claim", input)).rejects.toMatchObject({ status: 409 }); expect(m.process).not.toHaveBeenCalled(); });
it("requires current owner authorization before reserving money", async () => { m.owner.mockRejectedValue(Object.assign(new Error(), { status: 403 })); await expect(executeQualityRefund("staff", "claim", input)).rejects.toMatchObject({ status: 403 }); expect(m.reserve).not.toHaveBeenCalled(); });
it.each(["pending", "refund_pending", "reversal_pending", "failed", "manual_review"])("does not close a claim while ledger is %s", async state => {
 m.claim.findUniqueOrThrow.mockResolvedValue({ ...claim, refundOperationId: "op" }); m.refund.mockResolvedValue({ visitId: "visit", state });
 await expect(reconcileQualityResolution("claim")).resolves.toEqual({ resolution: "refund_pending", executed: false }); expect(m.ticket).not.toHaveBeenCalled();
});
it("atomically closes support and dedupes notices only after ledger completion", async () => {
 m.claim.findUniqueOrThrow.mockResolvedValue({ ...claim, refundOperationId: "op" }); m.refund.mockResolvedValue({ visitId: "visit", state: "succeeded" });
 await expect(reconcileQualityResolution("claim")).resolves.toEqual({ resolution: "refund_complete", executed: true }); expect(m.ticket).toHaveBeenCalledWith({ where: { id: "ticket" }, data: { lastActivityAt: expect.any(Date), status: "resolved", resolvedAt: expect.any(Date) } }); expect(m.notify.mock.calls[0][0].skipDuplicates).toBe(true);
});
it("does not accept an unrelated succeeded refund", async () => { m.claim.findUniqueOrThrow.mockResolvedValue({ ...claim, refundOperationId: "op" }); m.refund.mockResolvedValue({ visitId: "other", state: "succeeded" }); await expect(reconcileQualityResolution("claim")).resolves.toMatchObject({ executed: false }); });
it("does not claim refund success when processor fails after durable reservation", async () => { m.process.mockRejectedValue(new Error("network")); await expect(executeQualityRefund("owner", "claim", input)).rejects.toThrow("network"); expect(m.claim.update).toHaveBeenCalledTimes(1); expect(m.ticket.mock.calls[0][0].data.status).toBeUndefined(); });
it("creates a distinct zero-price redo retaining original target and payer", async () => {
 m.claim.findUniqueOrThrow.mockResolvedValue({ ...claim, resolution: "redo_pending" });
 m.visit.mockResolvedValue({ id: "visit", status: "completed", occurrence: { agreementId: "agreement", agreement: { status: "active" } }, unitId: "unit", billingPayerUserId: "original", requiresAfterPhoto: true }); m.max.mockResolvedValue({ _max: { sequence: 2 } }); m.occurrence.mockResolvedValue({ id: "redo-occurrence" }); m.createVisit.mockResolvedValue({ id: "redo" });
 await scheduleQualityRedo("owner", "claim", new Date(Date.now()+86400000), "Redo approved by support");
 expect(m.createVisit).toHaveBeenCalledWith({ data: expect.objectContaining({ occurrenceId: "redo-occurrence", redoOfVisitId: "visit", allocatedVisitCents: 0, billingPayerUserId: "original", unitId: "unit", requiresAfterPhoto: true }) }); expect(m.reserve).not.toHaveBeenCalled();
});
it.each(["scheduled", "blocked", "cancelled"])("does not resolve an unfinished redo %s", async status => { m.claim.findUniqueOrThrow.mockResolvedValue({ ...claim, resolution: "redo_pending", redoVisitId: "redo" }); m.visit.mockResolvedValue({ redoOfVisitId: "visit", status }); await expect(reconcileQualityResolution("claim")).resolves.toMatchObject({ executed: false }); });
it("resolves only the actually completed linked redo", async () => { m.claim.findUniqueOrThrow.mockResolvedValue({ ...claim, resolution: "redo_pending", redoVisitId: "redo" }); m.visit.mockResolvedValue({ redoOfVisitId: "visit", status: "completed", completedAt: new Date() }); await expect(reconcileQualityResolution("claim")).resolves.toEqual({ resolution: "redo_complete", executed: true }); });
