import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ candidates: vi.fn(), claim: vi.fn(), update: vi.fn(), cold: vi.fn(), registered: vi.fn(), ordinary: vi.fn(), reconcile: vi.fn() }));
vi.mock("@/lib/server/db", () => ({ db: { outboxEvent: { findMany: state.candidates, updateMany: state.claim, update: state.update } } }));
vi.mock("@/lib/server/vendor-outreach", () => ({ dispatchVendorOutreach: state.cold, dispatchRegisteredVendorEmail: state.registered }));
vi.mock("@/lib/server/vendor-webhook", () => ({ reconcileVendorWebhookEvents: state.reconcile }));
vi.mock("@/lib/server/email", () => ({ getEmailProvider: () => ({ send: state.ordinary }) }));
vi.mock("next/server", () => ({ after: vi.fn() }));
import { deliverPendingOutbox } from "@/lib/server/notifications";

const event = (kind: string, payload: unknown, dedupeKey = "vendor-outreach:invitation-59:0") => ({ id: "outbox-59", kind, payload, dedupeKey, attempts: 0 });
beforeEach(() => { vi.resetAllMocks(); state.claim.mockResolvedValue({ count: 1 }); state.update.mockResolvedValue({}); state.cold.mockResolvedValue({ providerMessageId: "synthetic-resend-id" }); state.registered.mockResolvedValue({ providerMessageId: null, skipped: true }); state.ordinary.mockResolvedValue({ providerMessageId: "ordinary-id" }); });

describe("vendor outbox delivery wiring", () => {
  it("dispatches the stored opaque invitation and slot and persists provider delivery identity", async () => {
    state.candidates.mockResolvedValue([event("vendor_outreach", { invitationId: "invitation-59", slot: 0 })]);
    expect(await deliverPendingOutbox()).toEqual({ claimed: 1, delivered: 1, failed: 0 });
    expect(state.cold).toHaveBeenCalledExactlyOnceWith("invitation-59", 0);
    expect(state.ordinary).not.toHaveBeenCalled();
    expect(state.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "delivered", providerMessageId: "synthetic-resend-id", lastError: null }) }));
  });
  it.each([{}, { invitationId: "id", slot: -1 }, { invitationId: "id", slot: 3 }, { invitationId: "id", slot: 1.5 }, { invitationId: "id", slot: "0" }, { invitationId: 42, slot: 0 }])("rejects malformed or out-of-range payload %# before dispatch", async payload => {
    state.candidates.mockResolvedValue([event("vendor_outreach", payload)]);
    expect(await deliverPendingOutbox()).toEqual({ claimed: 1, delivered: 0, failed: 1 });
    expect(state.cold).not.toHaveBeenCalled(); expect(state.ordinary).not.toHaveBeenCalled();
    expect(state.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ lastError: "vendor outreach payload is incomplete" }) }));
  });
  it("does not dispatch an event that another worker already claimed", async () => {
    state.candidates.mockResolvedValue([event("vendor_outreach", { invitationId: "invitation-59", slot: 0 })]); state.claim.mockResolvedValue({ count: 0 });
    expect(await deliverPendingOutbox()).toEqual({ claimed: 0, delivered: 0, failed: 0 }); expect(state.cold).not.toHaveBeenCalled();
  });
  it("honors a suppression skip as terminal without falling back to ordinary mail", async () => {
    state.candidates.mockResolvedValue([event("vendor_outreach", { invitationId: "invitation-59", slot: 1 })]); state.cold.mockResolvedValue({ providerMessageId: null, skipped: true });
    expect(await deliverPendingOutbox()).toEqual({ claimed: 1, delivered: 1, failed: 0 }); expect(state.ordinary).not.toHaveBeenCalled();
    expect(state.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "delivered", providerMessageId: null }) }));
  });
  it.each([true, false])("routes registered invitation through suppression-aware dispatcher (explicit flag %s)", async flagged => {
    const payload = { to: "provider@example.invalid", subject: "Invitation", text: "Review the request", requestId: "request-59", providerUserId: "provider-59", ...(flagged ? { vendorOutreach: true } : {}) };
    state.candidates.mockResolvedValue([event("notification_email", payload, flagged ? "email:provider-request-open:request-59:provider-59" : "email:provider-bid-invite:request-59:provider-59")]);
    expect(await deliverPendingOutbox()).toEqual({ claimed: 1, delivered: 1, failed: 0 });
    expect(state.registered).toHaveBeenCalledOnce(); expect(state.ordinary).not.toHaveBeenCalled();
    expect(state.registered.mock.calls[0][0]).toMatchObject({ requestId: "request-59", providerUserId: "provider-59" });
  });
  it("preserves ordinary transactional email delivery outside vendor invitations", async () => {
    state.candidates.mockResolvedValue([event("notification_email", { to: "resident@example.invalid", subject: "Receipt", text: "Service complete" }, "email:visit-completed:visit-1")]);
    expect(await deliverPendingOutbox()).toEqual({ claimed: 1, delivered: 1, failed: 0 });
    expect(state.registered).not.toHaveBeenCalled(); expect(state.cold).not.toHaveBeenCalled(); expect(state.ordinary).toHaveBeenCalledOnce();
  });
  it("leaves registered delivery retryable when early-webhook reconciliation fails", async () => {
    state.candidates.mockResolvedValue([event("notification_email", { to: "provider@example.invalid", subject: "Invitation", text: "Review", vendorOutreach: true }, "email:provider-bid-invite:request-59:provider-59")]);
    state.registered.mockResolvedValue({ providerMessageId: "registered-synthetic-id" }); state.reconcile.mockRejectedValue(new Error("Reconciliation unavailable"));
    expect(await deliverPendingOutbox()).toEqual({ claimed: 1, delivered: 0, failed: 1 });
    expect(state.update).toHaveBeenCalledWith({ where: { id: "outbox-59" }, data: { providerMessageId: "registered-synthetic-id" } });
    expect(state.update.mock.calls.some(([input]) => input.data.status === "delivered")).toBe(false);
    expect(state.update).toHaveBeenCalledWith({ where: { id: "outbox-59" }, data: { lastError: "Reconciliation unavailable" } });
  });
  it("records dispatcher failure for retry without exposing a fallback send", async () => {
    state.candidates.mockResolvedValue([event("vendor_outreach", { invitationId: "invitation-59", slot: 0 })]); state.cold.mockRejectedValue(new Error("Delivery temporarily unavailable"));
    expect(await deliverPendingOutbox()).toEqual({ claimed: 1, delivered: 0, failed: 1 }); expect(state.ordinary).not.toHaveBeenCalled();
    expect(state.update.mock.calls[0][0].data).toEqual({ lastError: "Delivery temporarily unavailable" });
  });
});
