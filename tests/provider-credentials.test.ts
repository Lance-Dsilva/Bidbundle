import { createHash } from "node:crypto";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as media from "@/lib/server/media";

type Write = { model: string; action: string; args: Record<string, unknown> };
const state = vi.hoisted(() => ({
  profile: null as Record<string, unknown> | null,
  asset: null as Record<string, unknown> | null,
  transactionError: null as unknown,
  transactions: [] as Write[][],
  put: vi.fn(), get: vi.fn(), del: vi.fn(), findProfile: vi.fn(), findAsset: vi.fn(),
}));
function write(model: string, action: string) {
  return (args: Record<string, unknown>): Write => ({ model, action, args });
}
vi.mock("@vercel/blob", () => ({ put: state.put, get: state.get, del: state.del }));
vi.mock("@/lib/server/db", () => ({ db: {
  providerProfile: {
    findUnique: (args: unknown) => { state.findProfile(args); return state.profile; },
    update: write("profile", "update"),
  },
  mediaAsset: {
    findFirst: (args: unknown) => { state.findAsset(args); return state.asset; },
    create: write("media", "create"), update: write("media", "update"),
  },
  adminAuditLog: { create: write("audit", "create") },
  $transaction: async (operations: Write[]) => {
    if (state.transactionError) throw state.transactionError;
    state.transactions.push(operations);
    return operations;
  },
} }));

const {
  MAX_CREDENTIAL_BYTES, normalizeCredentialUpload, listProviderCredentials,
  storeProviderCredential, loadProviderCredentialForAccess, readPrivateCredentialBytes,
} = await import("@/lib/server/provider-credentials");

const PDF = new Blob(["%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n"], { type: "text/html" });
const OWNER = { userId: "provider-1", canReviewProviders: false };

function profile() {
  return {
    id: "profile-1", userId: "provider-1", licenseNumber: "LIC-1", licenseState: "TX",
    insuranceProvider: "Example Mutual", insurancePolicyNumber: "POL-1",
    licenseDocumentId: "license-1", insuranceDocumentId: "insurance-1",
    licenseDocument: { storagePath: "provider-credentials/profile-1/provider_license/11111111-1111-4111-8111-111111111111.pdf" },
    insuranceDocument: { storagePath: "provider-credentials/profile-1/provider_insurance/22222222-2222-4222-8222-222222222222.pdf" },
    licenseVerifiedDocumentChecksum: "approved-license", insuranceVerifiedDocumentChecksum: "approved-insurance",
    licenseVerifiedAt: new Date("2026-10-01"), licenseVerifiedByUserId: "reviewer-1",
    insuranceVerifiedAt: new Date("2026-10-01"), insuranceVerifiedByUserId: "reviewer-1",
    licenseExpiresAt: new Date("2027-10-01"), insuranceExpiresAt: new Date("2027-10-01"),
    insuranceCoverageCents: 100_000_000, insuranceAdditionalInsured: true,
    updatedAt: new Date("2026-11-08T12:00:00Z"),
  };
}

function asset() {
  return {
    id: "license-1", purpose: "provider_license", providerProfileId: "profile-1",
    communityId: null, status: "active", storageUrl: "",
    storagePath: "provider-credentials/profile-1/provider_license/11111111-1111-4111-8111-111111111111.pdf",
    contentType: "application/pdf", checksum: "approved-license",
    credentialReviewStatus: "approved", credentialReviewReason: null,
    createdAt: new Date("2026-10-01"),
    providerProfile: { userId: "provider-1", licenseDocumentId: "license-1", insuranceDocumentId: "insurance-1" },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("PROVIDER_DOCUMENT_BLOB_READ_WRITE_TOKEN", "private-test-token");
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "public-test-token");
  state.profile = profile(); state.asset = asset(); state.transactions = []; state.transactionError = null;
  state.put.mockResolvedValue({ url: "https://private-storage.invalid/never-return-this" });
  state.del.mockResolvedValue(undefined);
  state.get.mockResolvedValue({ statusCode: 200, stream: new ReadableStream() });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("credential upload bytes", () => {
  it.each([undefined, new Blob([]), new Blob([new Uint8Array(4 * 1024 * 1024 + 1)])])("rejects a missing, empty or oversized file", async (file) => {
    await expect(normalizeCredentialUpload(file)).rejects.toMatchObject({ status: 422 });
  });

  it.each([
    new Blob(["<svg onload='alert(1)'></svg>"], { type: "image/png" }),
    new Blob(["<html>not a document</html>"], { type: "application/pdf" }),
    new Blob(["%PDF-1.7\nincomplete"], { type: "application/pdf" }),
    new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0x00])], { type: "image/jpeg" }),
  ])("rejects spoofed or incomplete document contents", async (file) => {
    await expect(normalizeCredentialUpload(file)).rejects.toMatchObject({ status: 422 });
    expect(state.put).not.toHaveBeenCalled();
  });

  it("identifies a PDF from bytes rather than the attacker-supplied MIME type", async () => {
    const normalized = await normalizeCredentialUpload(PDF);
    expect(normalized).toMatchObject({ contentType: "application/pdf", extension: "pdf", width: null, height: null });
    expect(normalized.checksum).toBe(createHash("sha256").update(Buffer.from(await PDF.arrayBuffer())).digest("hex"));
    expect(MAX_CREDENTIAL_BYTES).toBe(4 * 1024 * 1024);
  });

  it("rewrites images and strips embedded metadata before storing or checksumming them", async () => {
    const original = await sharp({ create: { width: 12, height: 8, channels: 3, background: "white" } })
      .withExif({ IFD0: { Artist: "Private credential holder" } }).jpeg().toBuffer();
    expect((await sharp(original).metadata()).exif).toBeDefined();
    const normalized = await normalizeCredentialUpload(new Blob([new Uint8Array(original)], { type: "application/pdf" }));
    expect(normalized.contentType).toBe("image/jpeg");
    expect((await sharp(normalized.bytes).metadata()).exif).toBeUndefined();
    expect(normalized.checksum).toBe(createHash("sha256").update(normalized.bytes).digest("hex"));
  });
});

describe("private credential storage and replacement", () => {
  it.each(["", "public-test-token"])("fails closed without a distinct private token", async (token) => {
    vi.stubEnv("PROVIDER_DOCUMENT_BLOB_READ_WRITE_TOKEN", token);
    await expect(storeProviderCredential("provider-1", "license", PDF)).rejects.toMatchObject({ status: 503 });
    await expect(readPrivateCredentialBytes(asset())).rejects.toMatchObject({ status: 503 });
    expect(state.findProfile).not.toHaveBeenCalled();
    expect(state.put).not.toHaveBeenCalled(); expect(state.get).not.toHaveBeenCalled();
    expect(state.transactions).toEqual([]);
  });

  it.each(["license", "insurance"] as const)("replacing %s uses immutable private bytes and atomically clears only its approval", async (kind) => {
    const id = await storeProviderCredential("provider-1", kind, PDF);
    expect(id).not.toBe("license-1"); expect(id).not.toBe("insurance-1");
    const path = `provider-credentials/profile-1/provider_${kind}/${id}.pdf`;
    expect(state.put).toHaveBeenCalledWith(path, expect.any(Buffer), expect.objectContaining({
      access: "private", token: "private-test-token", addRandomSuffix: false, allowOverwrite: false,
    }));
    expect(state.transactions).toHaveLength(1);
    const operations = state.transactions[0];
    const created = operations.find((op) => op.model === "media" && op.action === "create")!;
    expect(created.args.data).toMatchObject({ id, storagePath: path, storageUrl: "", providerProfileId: "profile-1", uploaderUserId: "provider-1" });
    const changed = operations.find((op) => op.model === "profile")!;
    expect(changed.args.where).toMatchObject({ userId: "provider-1", id: "profile-1", updatedAt: profile().updatedAt,
      AND: [{ licenseDocumentId: { equals: "license-1" } }, { insuranceDocumentId: { equals: "insurance-1" } }],
      licenseVerifiedDocumentChecksum: "approved-license" });
    expect(changed.args.data).toMatchObject({ [`${kind}DocumentId`]: id, [`${kind}VerifiedAt`]: null,
      [`${kind}VerifiedByUserId`]: null, [`${kind}VerifiedDocumentChecksum`]: null, [`${kind}ExpiresAt`]: null });
    expect(changed.args.data).not.toHaveProperty(kind === "license" ? "insuranceVerifiedAt" : "licenseVerifiedAt");
    expect(operations.find((op) => op.model === "media" && op.action === "update")!.args).toMatchObject({
      where: { id: `${kind}-1`, providerProfileId: "profile-1" }, data: { status: "removed" },
    });
    expect(operations.find((op) => op.model === "audit")!.args.data).toMatchObject({ providerUserId: "provider-1" });
    expect(JSON.stringify(operations)).not.toContain("private-test-token");
    expect(JSON.stringify(operations)).not.toContain("never-return-this");
    expect(state.del).toHaveBeenCalledWith(kind === "license" ? profile().licenseDocument.storagePath : profile().insuranceDocument.storagePath,
      { token: "private-test-token" });
  });

  it("deletes newly uploaded bytes when a stale snapshot loses its database write", async () => {
    state.transactionError = { code: "P2025" };
    await expect(storeProviderCredential("provider-1", "license", PDF)).rejects.toMatchObject({ status: 409 });
    expect(state.transactions).toEqual([]);
    expect(state.del).toHaveBeenCalledWith(state.put.mock.calls[0][0], { token: "private-test-token" });
  });

  it("does not upload bytes before a credential claim exists", async () => {
    state.profile!.licenseNumber = null;
    await expect(storeProviderCredential("provider-1", "license", PDF)).rejects.toMatchObject({ status: 409 });
    expect(state.put).not.toHaveBeenCalled(); expect(state.transactions).toEqual([]);
  });

  it("rejects a small input whose normalized image exceeds the hosted upload limit before Blob storage", async () => {
    const input = await sharp({ create: { width: 2, height: 2, channels: 3, background: "white" } }).png().toBuffer();
    expect(input.length).toBeLessThan(MAX_CREDENTIAL_BYTES);
    vi.spyOn(media, "normalizeUpload").mockResolvedValueOnce({ ok: true, image: {
      bytes: Buffer.alloc(MAX_CREDENTIAL_BYTES + 1), contentType: "image/png", extension: "png",
      width: 2400, height: 2400, checksum: "normalized-large-image",
    } });
    await expect(storeProviderCredential("provider-1", "license", new Blob([new Uint8Array(input)], { type: "image/png" })))
      .rejects.toMatchObject({ status: 422 });
    expect(state.put).not.toHaveBeenCalled(); expect(state.transactions).toEqual([]);
  });
});

describe("credential disclosure boundaries", () => {
  it("lists proxy paths and review metadata without storage paths, URLs, or tokens", async () => {
    state.profile = { ...profile(), licenseDocument: { ...asset(), storageUrl: "https://secret-storage.invalid/credential" }, insuranceDocument: null };
    const listed = await listProviderCredentials("provider-1");
    expect(listed.license).toMatchObject({ id: "license-1", url: "/api/provider/credentials/license-1", reviewStatus: "approved" });
    expect(listed.insurance).toBeNull();
    const serialized = JSON.stringify(listed);
    expect(serialized).not.toMatch(/storageUrl|storagePath|secret-storage|provider-credentials\/|private-test-token/);
  });

  it("permits the current document's owner and an explicitly authorized reviewer", async () => {
    await expect(loadProviderCredentialForAccess("license-1", OWNER)).resolves.toMatchObject({ id: "license-1" });
    await expect(loadProviderCredentialForAccess("license-1", { userId: "reviewer-1", canReviewProviders: true })).resolves.toMatchObject({ id: "license-1" });
    expect(state.findAsset).toHaveBeenCalledWith(expect.objectContaining({ where: {
      id: "license-1", status: "active", purpose: { in: ["provider_license", "provider_insurance"] },
    } }));
  });

  it("returns no document to another provider even when the identifier is known", async () => {
    await expect(loadProviderCredentialForAccess("license-1", { userId: "other-provider", canReviewProviders: false })).resolves.toBeNull();
    expect(state.get).not.toHaveBeenCalled();
  });

  it.each([
    { providerProfile: null },
    { providerProfile: { userId: "provider-1", licenseDocumentId: "replacement-2" } },
    { communityId: "community-1" },
    { storageUrl: "https://public-storage.invalid/leaked" },
    { storagePath: "provider-credentials/other-profile/provider_license/license-1.pdf" },
  ])("rejects stale, unrelated or publicly stored media even for a reviewer: %j", async (change) => {
    state.asset = { ...asset(), ...change };
    await expect(loadProviderCredentialForAccess("license-1", { userId: "reviewer-1", canReviewProviders: true })).resolves.toBeNull();
  });

  it("reads bytes with the private token and never returns the Blob URL", async () => {
    const result = await readPrivateCredentialBytes(asset());
    expect(state.get).toHaveBeenCalledWith(asset().storagePath, { access: "private", token: "private-test-token" });
    expect(result).toMatchObject({ contentType: "application/pdf", stream: expect.any(ReadableStream) });
    state.get.mockResolvedValueOnce({ statusCode: 404 });
    await expect(readPrivateCredentialBytes(asset())).resolves.toBeNull();
  });

  it.each([
    { storagePath: "https://attacker.invalid/private-document", contentType: "application/pdf" },
    { storagePath: "provider-credentials/profile-1/provider_license/../../other.pdf", contentType: "application/pdf" },
    { storagePath: asset().storagePath, contentType: "text/html" },
  ])("does not fetch an untrusted namespace or executable content type: %j", async (document) => {
    await expect(readPrivateCredentialBytes(document)).resolves.toBeNull();
    expect(state.get).not.toHaveBeenCalled();
  });
});
