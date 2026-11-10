import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const oidc = vi.hoisted(() => vi.fn());
vi.mock("@vercel/oidc", () => ({ getVercelOidcToken: oidc }));
import { visitPhotoStorageAuth } from "@/lib/server/visit-photo-storage-auth";

beforeEach(() => { oidc.mockReset(); vi.stubEnv("VISIT_PHOTO_BLOB_READ_WRITE_TOKEN", ""); vi.stubEnv("VISIT_PHOTO_BLOB_STORE_ID", ""); });
afterEach(() => vi.unstubAllEnvs());
describe("explicit private visit store credentials", () => {
  it("uses the explicit visit token without accessing another credential", async () => {
    vi.stubEnv("VISIT_PHOTO_BLOB_READ_WRITE_TOKEN", "synthetic-visit-only");
    expect(await visitPhotoStorageAuth()).toEqual({ token: "synthetic-visit-only" });
    expect(oidc).not.toHaveBeenCalled();
  });
  it("obtains a short-lived OIDC token for the explicitly configured store", async () => {
    vi.stubEnv("VISIT_PHOTO_BLOB_STORE_ID", "store_syntheticPrivate"); oidc.mockResolvedValue("synthetic-short-lived");
    expect(await visitPhotoStorageAuth()).toEqual({ storeId: "store_syntheticPrivate", oidcToken: "synthetic-short-lived" });
  });
  it("fails closed when OIDC is unavailable, even if public credentials exist", async () => {
    vi.stubEnv("VISIT_PHOTO_BLOB_STORE_ID", "store_syntheticPrivate"); vi.stubEnv("BLOB_READ_WRITE_TOKEN", "synthetic-public"); oidc.mockRejectedValue(new Error("Unavailable"));
    expect(await visitPhotoStorageAuth()).toBeNull();
  });
  it("does not borrow generic or provider-document credentials", async () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "synthetic-public"); vi.stubEnv("BLOB_STORE_ID", "store_other"); vi.stubEnv("PROVIDER_DOCUMENT_BLOB_READ_WRITE_TOKEN", "synthetic-docs");
    expect(await visitPhotoStorageAuth()).toBeNull(); expect(oidc).not.toHaveBeenCalled();
  });
  it("rejects malformed store configuration before authentication", async () => {
    vi.stubEnv("VISIT_PHOTO_BLOB_STORE_ID", "https://example.invalid");
    expect(await visitPhotoStorageAuth()).toBeNull(); expect(oidc).not.toHaveBeenCalled();
  });
});
