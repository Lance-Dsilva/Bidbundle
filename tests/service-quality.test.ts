import { beforeEach, describe, expect, it, vi } from "vitest";
import { withinQualityReportWindow, serviceQualityReportSchema, serviceQualityResolutionSchema } from "@/lib/validation/service-quality";

const mocks = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
  serviceVisit: { findUnique: vi.fn() },
  communityMembership: { findUnique: vi.fn() },
  serviceQualityClaim: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), findFirst: vi.fn() },
  supportTicket: { create: vi.fn(), update: vi.fn() }, supportTicketEvent: { create: vi.fn() }, adminAccessGrant: { findUnique: vi.fn() }, supportTicketMessage: { create: vi.fn() }, notification: { createMany: vi.fn() },
  user: { findUnique: vi.fn() },
}));
vi.mock("@/lib/server/db", () => ({ db: { ...mocks, $transaction: (fn: (tx: typeof mocks) => unknown) => fn(mocks) } }));
import { reportServiceQuality, requestQualityResolution, respondToQualityClaim } from "@/lib/server/service-quality";
const now = new Date("2026-11-16T12:00:00Z");
const input = { reason: "incomplete" as const, description: "The agreed cleaning was not completed." };
const visit = () => ({ id: "visit", status: "completed", completedAt: new Date(now.getTime()-3600000), unitId: "unit", homeownerUserId: null, occurrence: { agreement: { communityId: "community", providerUserId: "provider", requestId: "request", community: { type: "hoa" } } } });
beforeEach(() => {
  vi.resetAllMocks(); process.env.SERVICE_QUALITY_INTAKE = "1";
  mocks.$queryRaw.mockResolvedValue([{ now }]); mocks.serviceVisit.findUnique.mockResolvedValue(visit());
  mocks.communityMembership.findUnique.mockResolvedValue({ status: "active", unitId: "unit", joinedAt: new Date("2026-01-01"), createdAt: new Date("2026-01-01"), updatedAt: new Date("2026-01-01") });
  mocks.serviceQualityClaim.findUnique.mockResolvedValue(null);
});
describe("service quality eligibility", () => {
  it("accepts the exact 72-hour boundary but excludes future and expired completion", () => {
    expect(withinQualityReportWindow(new Date(now.getTime()-72*3600000), now)).toBe(true);
    expect(withinQualityReportWindow(new Date(now.getTime()-72*3600000-1), now)).toBe(false);
    expect(withinQualityReportWindow(new Date(now.getTime()+1), now)).toBe(false);
    expect(withinQualityReportWindow(null, now)).toBe(false);
    expect(withinQualityReportWindow(new Date("invalid"), now)).toBe(false);
  });
  it("rejects caller-controlled identity, execution status, and blank descriptions", () => {
    expect(serviceQualityReportSchema.safeParse({ ...input, requesterUserId: "other" }).success).toBe(false);
    expect(serviceQualityReportSchema.safeParse({ ...input, description: "    " }).success).toBe(false);
    expect(serviceQualityResolutionSchema.safeParse({ action: "refunded", note: "The refund completed" }).success).toBe(false);
  });
  it("fails closed while disabled without touching the database", async () => {
    delete process.env.SERVICE_QUALITY_INTAKE;
    await expect(reportServiceQuality("resident", "visit", input)).rejects.toMatchObject({ status: 404 });
    expect(mocks.$queryRaw).not.toHaveBeenCalled();
  });
  it("creates ticket, claim and private notification under a visit lock", async () => {
    const result = await reportServiceQuality("resident", "visit", input);
    expect(result.resolution).toBe("reported");
    expect(mocks.supportTicket.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ requesterUserId: "resident", relatedVisitId: "visit", category: "service_quality" }) }));
    expect(mocks.serviceQualityClaim.create).toHaveBeenCalledWith({ data: expect.objectContaining({ visitId: "visit", providerUserId: "provider", ticketId: result.ticketId }) });
    expect(mocks.notification.createMany).toHaveBeenCalledTimes(1);
  });
  it("blocks a different unit, revoked membership, or replacement occupant", async () => {
    for (const membership of [{ status: "active", unitId: "different" }, { status: "removed", unitId: "unit" }, { status: "active", unitId: "unit", joinedAt: now }]) {
      mocks.communityMembership.findUnique.mockResolvedValue({ createdAt: new Date("2026-01-01"), updatedAt: new Date("2026-01-01"), ...membership });
      await expect(reportServiceQuality("resident", "visit", input)).rejects.toMatchObject({ status: 404 });
    }
    expect(mocks.supportTicket.create).not.toHaveBeenCalled();
  });
  it("blocks late claims and noncompleted visits", async () => {
    mocks.serviceVisit.findUnique.mockResolvedValueOnce({ ...visit(), completedAt: new Date(now.getTime()-73*3600000) }).mockResolvedValueOnce({ ...visit(), status: "scheduled" });
    await expect(reportServiceQuality("resident", "visit", input)).rejects.toMatchObject({ status: 409 });
    await expect(reportServiceQuality("resident", "visit", input)).rejects.toMatchObject({ status: 409 });
    expect(mocks.supportTicket.create).not.toHaveBeenCalled();
  });
  it("blocks a reactivated membership even when its original joinedAt was preserved", async () => {
    mocks.communityMembership.findUnique.mockResolvedValue({ status: "active", unitId: "unit", joinedAt: new Date("2026-01-01"), createdAt: new Date("2026-01-01"), updatedAt: now });
    await expect(reportServiceQuality("resident", "visit", input)).rejects.toMatchObject({ status: 404 });
    expect(mocks.supportTicket.create).not.toHaveBeenCalled();
  });
  it("returns the original owned claim on a retry without duplicate writes", async () => {
    mocks.serviceQualityClaim.findUnique.mockResolvedValue({ id: "claim", ticketId: "ticket", requesterUserId: "resident", resolution: "reported" });
    await expect(reportServiceQuality("resident", "visit", input)).resolves.toEqual({ id: "claim", ticketId: "ticket", resolution: "reported" });
    expect(mocks.supportTicket.create).not.toHaveBeenCalled();
  });
});
describe("quality resolution and provider boundary", () => {
  it("records refund intent without resolving the ticket or claiming money moved", async () => {
    mocks.user.findUnique.mockResolvedValue({ role: "admin" });
    mocks.adminAccessGrant.findUnique.mockResolvedValue({ status: "active" });
    mocks.serviceQualityClaim.findUnique.mockResolvedValue({ id: "claim", ticketId: "ticket", resolution: "reported" });
    await expect(requestQualityResolution("admin", "claim", { action: "request_refund", note: "The service failed inspection." })).resolves.toEqual({ resolution: "refund_pending", executed: false });
    expect(mocks.serviceQualityClaim.update).toHaveBeenCalledWith({ where: { id: "claim" }, data: expect.objectContaining({ resolution: "refund_pending", resolutionRequestedBy: "admin" }) });
    expect(mocks.supportTicket.update).toHaveBeenCalled();
    expect(mocks.supportTicketEvent.create).toHaveBeenCalled();
  });
  it("rejects a revoked administrator grant", async () => {
    mocks.user.findUnique.mockResolvedValue({ role: "admin" });
    mocks.adminAccessGrant.findUnique.mockResolvedValue({ status: "revoked" });
    await expect(requestQualityResolution("admin", "claim", { action: "request_refund", note: "Please refund this service." })).rejects.toMatchObject({ status: 403 });
    expect(mocks.serviceQualityClaim.update).not.toHaveBeenCalled();
  });
  it("rejects a nonadmin resolution and a provider's access to another claim", async () => {
    mocks.user.findUnique.mockResolvedValue({ role: "provider" });
    await expect(requestQualityResolution("provider", "claim", { action: "request_refund", note: "Please refund this service." })).rejects.toMatchObject({ status: 403 });
    mocks.serviceQualityClaim.findFirst.mockResolvedValue(null);
    await expect(respondToQualityClaim("other", "claim", { response: "We completed the agreed work." })).rejects.toMatchObject({ status: 404 });
    expect(mocks.serviceQualityClaim.update).not.toHaveBeenCalled();
  });
  it("keeps provider responses immutable and retries idempotent", async () => {
    mocks.serviceQualityClaim.findFirst.mockResolvedValue({ id: "claim", ticketId: "ticket", providerResponse: "We completed the agreed work." });
    await expect(respondToQualityClaim("provider", "claim", { response: "We completed the agreed work." })).resolves.toEqual({ ok: true });
    await expect(respondToQualityClaim("provider", "claim", { response: "Change the saved explanation." })).rejects.toMatchObject({ status: 409 });
    expect(mocks.serviceQualityClaim.update).not.toHaveBeenCalled();
  });
});
