import "server-only";
import { getVercelOidcToken } from "@vercel/oidc";

export type VisitPhotoStorageAuth = { token: string } | { storeId: string; oidcToken: string };

/** Explicit visit-store configuration only; never fall through to a public store. */
export async function visitPhotoStorageAuth(): Promise<VisitPhotoStorageAuth | null> {
  const token = process.env.VISIT_PHOTO_BLOB_READ_WRITE_TOKEN?.trim();
  if (token) return { token };
  const storeId = process.env.VISIT_PHOTO_BLOB_STORE_ID?.trim();
  if (!storeId || !/^store_[A-Za-z0-9]+$/.test(storeId)) return null;
  try {
    const oidcToken = await getVercelOidcToken();
    return oidcToken ? { storeId, oidcToken } : null;
  } catch {
    return null;
  }
}
