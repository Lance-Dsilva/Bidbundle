import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  claim: vi.fn(), user: vi.fn(), membership: vi.fn(), count: vi.fn(), create: vi.fn(), find: vi.fn(), list: vi.fn(), raw: vi.fn(), update: vi.fn(), event: vi.fn(),
  put: vi.fn(), get: vi.fn(), del: vi.fn(), auth: vi.fn(), normalize: vi.fn(),
}));
vi.mock("@/lib/server/db", () => {
  const tx = { serviceQualityClaim: { findUnique: mocks.claim }, user: { findUnique: mocks.user }, communityMembership: { findUnique: mocks.membership },
    serviceQualityPhoto: { count: mocks.count, create: mocks.create, findUnique: mocks.find, findMany: mocks.list }, $queryRaw: mocks.raw,
    supportTicket: { update: mocks.update }, supportTicketEvent: { create: mocks.event } };
  return { db: { ...tx, $transaction: (fn: (tx: unknown) => unknown) => fn(tx) } };
});
vi.mock("@vercel/blob", () => ({ put: mocks.put, get: mocks.get, del: mocks.del }));
vi.mock("@/lib/server/visit-photo-storage-auth", () => ({ visitPhotoStorageAuth: mocks.auth }));
vi.mock("@/lib/server/media", () => ({ normalizeUpload: mocks.normalize }));
import { listQualityPhotos, readQualityPhoto, storeQualityPhoto } from "@/lib/server/service-quality-photos";
const claimId = "00000000-0000-4000-a000-000000000001", photoId = "00000000-0000-4000-a000-000000000002";
const claim = { id: claimId, requesterUserId: "resident", providerUserId: "provider", resolution: "reported", ticketId: "ticket", visit: { completedAt: new Date(), unitId: "unit", homeownerUserId: null, occurrence: { agreement: { communityId: "community" } } } };
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("SERVICE_QUALITY_INTAKE", "1");
  mocks.claim.mockResolvedValue(claim); mocks.user.mockResolvedValue({ role: "homeowner" }); mocks.membership.mockResolvedValue({ status: "active", unitId: "unit" });
  mocks.auth.mockResolvedValue({ token: "synthetic" }); mocks.count.mockResolvedValue(0); mocks.raw.mockResolvedValue([{ now: new Date() }]);
  mocks.normalize.mockResolvedValue({ ok: true, image: { bytes: new Uint8Array([1,2,3]), extension: "jpg", contentType: "image/jpeg", checksum: "checksum" } });
  mocks.create.mockImplementation(async ({ data }: { data: object }) => ({ ...data, createdAt: new Date() }));
});
afterEach(() => vi.unstubAllEnvs());
describe("private quality evidence", () => {
  it("normalizes resident evidence into the private store and returns only an authenticated reference", async () => {
    const result = await storeQualityPhoto("resident", claimId, new Blob(["fixture"]));
    expect(mocks.put).toHaveBeenCalledWith(expect.stringMatching(/^quality-photos\//), expect.any(Uint8Array), expect.objectContaining({ access: "private", allowOverwrite: false }));
    expect(result.src).toMatch(/^\/api\/quality-photos\//); expect(result).not.toHaveProperty("storagePath");
    expect(mocks.event).toHaveBeenCalled();
  });
  it("does not fall back to public storage if private configuration is missing", async () => {
    mocks.auth.mockResolvedValue(null);
    await expect(storeQualityPhoto("resident", claimId, new Blob(["fixture"]))).rejects.toMatchObject({ status: 503 });
    expect(mocks.put).not.toHaveBeenCalled();
  });
  it("removes its own uploaded object if access is revoked during upload", async () => {
    mocks.membership.mockResolvedValueOnce({ status: "active", unitId: "unit" }).mockResolvedValueOnce({ status: "removed", unitId: "unit" });
    await expect(storeQualityPhoto("resident", claimId, new Blob(["fixture"]))).rejects.toMatchObject({ status: 404 });
    expect(mocks.del).toHaveBeenCalledWith(mocks.put.mock.calls[0][0], { token: "synthetic" });
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("attempts cleanup of its own UUID object when the upload response is lost", async () => {
    mocks.put.mockRejectedValue(new Error("Transport response lost"));
    await expect(storeQualityPhoto("resident", claimId, new Blob(["fixture"]))).rejects.toThrow("Transport response lost");
    expect(mocks.del).toHaveBeenCalledWith(mocks.put.mock.calls[0][0], { token: "synthetic" });
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("enforces eight photos under the claim lock and cleans up overflow", async () => {
    mocks.count.mockResolvedValue(8);
    await expect(storeQualityPhoto("resident", claimId, new Blob(["fixture"]))).rejects.toMatchObject({ status: 409 });
    expect(mocks.del).toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled();
  });
  it("denies other residents and managers, while an assigned active provider can view but cannot upload", async () => {
    await expect(listQualityPhotos("stranger", claimId)).rejects.toMatchObject({ status: 404 });
    mocks.user.mockResolvedValue({ role: "hoa_staff" });
    await expect(listQualityPhotos("manager", claimId)).rejects.toMatchObject({ status: 404 });
    mocks.user.mockResolvedValue({ role: "provider", providerProfile: { accountStatus: "active" } }); mocks.list.mockResolvedValue([]);
    await expect(listQualityPhotos("provider", claimId)).resolves.toEqual([]);
    await expect(storeQualityPhoto("provider", claimId, new Blob(["fixture"]))).rejects.toMatchObject({ status: 403 });
  });
  it("rechecks read authority after Blob transport and rejects path substitution", async () => {
    mocks.find.mockResolvedValue({ id: photoId, claimId, storagePath: `quality-photos/${claimId}/${photoId}.jpg`, contentType: "image/jpeg" });
    mocks.get.mockResolvedValue({ statusCode: 200, stream: new ReadableStream() });
    mocks.membership.mockResolvedValueOnce({ status: "active", unitId: "unit" }).mockResolvedValueOnce({ status: "removed", unitId: "unit" });
    await expect(readQualityPhoto("resident", photoId)).rejects.toMatchObject({ status: 404 });
    mocks.membership.mockResolvedValue({ status: "active", unitId: "unit" });
    mocks.find.mockResolvedValue({ claimId, storagePath: "provider-documents/secret.pdf" }); mocks.get.mockClear();
    await expect(readQualityPhoto("resident", photoId)).resolves.toBeNull(); expect(mocks.get).not.toHaveBeenCalled();
  });
});
