import "server-only";

import type { CredentialReviewStatus } from "@/generated/prisma/enums";
import type { ProviderCredentialRef, ProviderCredentials } from "@/lib/provider-credential-types";

import { createHash, randomUUID } from "node:crypto";
import { del, get, put } from "@vercel/blob";

import { credentialClaimSnapshot } from "@/lib/provider-verification";
import { db } from "./db";
import { HoaWorkflowError } from "./hoa";
import { normalizeUpload } from "./media";
import { nextProviderUpdatedAt, providerWriteSnapshotSelect, providerWriteSnapshotWhere } from "./profile";
import { buildAuditEntry } from "./audit";

export type CredentialKind = "license" | "insurance";
export const MAX_CREDENTIAL_BYTES = 4 * 1024 * 1024;

function privateToken(): string {
  const token = process.env.PROVIDER_DOCUMENT_BLOB_READ_WRITE_TOKEN?.trim();
  if (!token || token === process.env.BLOB_READ_WRITE_TOKEN) {
    throw new HoaWorkflowError("Private document uploads are not configured. Contact Bundleen support.", 503);
  }
  return token;
}

export async function normalizeCredentialUpload(file: unknown) {
  if (!(file instanceof Blob) || file.size <= 0 || file.size > MAX_CREDENTIAL_BYTES) {
    throw new HoaWorkflowError("Choose a PDF, JPEG, PNG or WebP file up to 4MiB.", 422);
  }
  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.length > MAX_CREDENTIAL_BYTES) throw new HoaWorkflowError("Documents must be 4MiB or smaller.", 422);
  if (/^%PDF-\d\.\d/.test(bytes.subarray(0, 8).toString("ascii"))) {
    if (!bytes.subarray(-1024).includes(Buffer.from("%%EOF"))) throw new HoaWorkflowError("That PDF is incomplete.", 422);
    return { bytes, contentType: "application/pdf", extension: "pdf", width: null, height: null,
      checksum: createHash("sha256").update(bytes).digest("hex") };
  }
  const normalized = await normalizeUpload(file);
  if (!normalized.ok) throw new HoaWorkflowError(normalized.rejection.message, 422);
  if (normalized.image.bytes.length > MAX_CREDENTIAL_BYTES) throw new HoaWorkflowError("The normalized document exceeds 4MiB.", 422);
  return normalized.image;
}

const documentSummarySelect = {
  id: true, checksum: true, purpose: true, status: true, createdAt: true,
  credentialReviewStatus: true, credentialReviewReason: true,
} as const;

function summary(asset: {
  id: string; checksum: string; status: string; createdAt: Date;
  credentialReviewStatus: CredentialReviewStatus; credentialReviewReason: string | null;
} | null): ProviderCredentialRef | null {
  return asset?.status === "active" ? {
    id: asset.id, checksum: asset.checksum, reviewStatus: asset.credentialReviewStatus,
    reviewReason: asset.credentialReviewReason, uploadedAt: asset.createdAt.toISOString(),
    url: `/api/provider/credentials/${encodeURIComponent(asset.id)}`,
  } : null;
}

/** Owner/reviewer DTO: no Blob URL, pathname, token or document contents. */
export async function listProviderCredentials(userId: string): Promise<ProviderCredentials> {
  const profile = await db.providerProfile.findUnique({
    where: { userId },
    select: {
      licenseDocument: { select: documentSummarySelect }, insuranceDocument: { select: documentSummarySelect },
      licenseExpiresAt: true, insuranceExpiresAt: true, insuranceCoverageCents: true,
      insuranceAdditionalInsured: true, updatedAt: true,
    },
  });
  if (!profile) throw new HoaWorkflowError("Provider profile not found.", 404);
  return {
    license: summary(profile.licenseDocument), insurance: summary(profile.insuranceDocument),
    licenseExpiresOn: profile.licenseExpiresAt?.toISOString().slice(0, 10) ?? null,
    insuranceExpiresOn: profile.insuranceExpiresAt?.toISOString().slice(0, 10) ?? null,
    insuranceCoverageCents: profile.insuranceCoverageCents,
    insuranceAdditionalInsured: profile.insuranceAdditionalInsured,
    updatedAt: profile.updatedAt.toISOString(),
  };
}

/** New bytes are immutable; attaching them advances the SAME credential CAS. */
export async function storeProviderCredential(userId: string, kind: CredentialKind, file: unknown): Promise<string> {
  const token = privateToken();
  const profile = await db.providerProfile.findUnique({ where: { userId }, select: {
    ...providerWriteSnapshotSelect, licenseDocument: { select: { storagePath: true } }, insuranceDocument: { select: { storagePath: true } },
  } });
  if (!profile) throw new HoaWorkflowError("Provider profile not found.", 404);
  if (kind === "license" ? !profile.licenseNumber : !profile.insuranceProvider) {
    throw new HoaWorkflowError("Save the matching license or insurance claim before uploading its document.", 409);
  }
  const image = await normalizeCredentialUpload(file);
  const id = randomUUID();
  const path = `provider-credentials/${profile.id}/provider_${kind}/${id}.${image.extension}`;
  await put(path, image.bytes, { access: "private", token, contentType: image.contentType,
    addRandomSuffix: false, allowOverwrite: false });
  const previousId = kind === "license" ? profile.licenseDocumentId : profile.insuranceDocumentId;
  const pointer = kind === "license" ? { licenseDocumentId: id } : { insuranceDocumentId: id };
  const cleared = kind === "license"
    ? { licenseVerifiedAt: null, licenseVerifiedByUserId: null, licenseVerifiedDocumentChecksum: null, licenseExpiresAt: null }
    : { insuranceVerifiedAt: null, insuranceVerifiedByUserId: null, insuranceVerifiedDocumentChecksum: null,
      insuranceExpiresAt: null, insuranceCoverageCents: null, insuranceAdditionalInsured: false };
  try {
    await db.$transaction([
      db.mediaAsset.create({ data: {
        id, purpose: `provider_${kind}`, providerProfileId: profile.id, uploaderUserId: userId,
        storagePath: path, storageUrl: "", contentType: image.contentType, byteSize: image.bytes.length,
        checksum: image.checksum, width: image.width, height: image.height,
        credentialSnapshot: credentialClaimSnapshot(profile, kind),
      } }),
      db.providerProfile.update({ where: { userId, ...providerWriteSnapshotWhere(profile) },
        data: { ...pointer, ...cleared, updatedAt: nextProviderUpdatedAt(profile) } }),
      ...(previousId ? [db.mediaAsset.update({ where: { id: previousId, providerProfileId: profile.id },
        data: { status: "removed", deletedAt: new Date() } })] : []),
      db.adminAuditLog.create({ data: buildAuditEntry({ actorUserId: userId,
        action: kind === "license" ? "provider_license_revoked" : "provider_insurance_revoked",
        targetType: "provider", targetId: userId, providerUserId: userId,
        metadata: { reason: "document_replaced", documentId: id, checksum: image.checksum, previousDocumentId: previousId } }) }),
    ]);
  } catch (error) {
    try { await del(path, { token }); } catch { console.warn("[provider-credentials] orphan cleanup failed"); }
    if ((error as { code?: string })?.code === "P2025") throw new HoaWorkflowError("Your credentials changed during upload. Reload and try again.", 409);
    throw error;
  }
  const previousPath = kind === "license" ? profile.licenseDocument?.storagePath : profile.insuranceDocument?.storagePath;
  if (previousPath && previousPath.startsWith(`provider-credentials/${profile.id}/provider_${kind}/`)) {
    try { await del(previousPath, { token }); } catch { console.warn("[provider-credentials] superseded private object cleanup failed"); }
  }
  return id;
}

export async function loadProviderCredentialForAccess(mediaId: string, viewer: { userId: string; canReviewProviders: boolean }) {
  const asset = await db.mediaAsset.findFirst({ where: { id: mediaId, status: "active",
    purpose: { in: ["provider_license", "provider_insurance"] } },
  include: { providerProfile: { select: { userId: true, licenseDocumentId: true, insuranceDocumentId: true } } } });
  if (!asset?.providerProfile || (!viewer.canReviewProviders && asset.providerProfile.userId !== viewer.userId)) return null;
  const currentId = asset.purpose === "provider_license" ? asset.providerProfile.licenseDocumentId : asset.providerProfile.insuranceDocumentId;
  if (currentId !== asset.id || asset.communityId !== null || asset.storageUrl !== "" ||
    !asset.storagePath.startsWith(`provider-credentials/${asset.providerProfileId}/${asset.purpose}/`)) return null;
  return asset;
}

export async function readPrivateCredentialBytes(asset: { storagePath: string; contentType: string }) {
  const token = privateToken();
  if (!/^provider-credentials\/[A-Za-z0-9_-]+\/provider_(license|insurance)\/[a-f0-9-]{36}\.(pdf|jpg|png|webp)$/.test(asset.storagePath) ||
    !["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(asset.contentType)) return null;
  const result = await get(asset.storagePath, { access: "private", token });
  return result?.statusCode === 200 ? { stream: result.stream, contentType: asset.contentType } : null;
}

/** Bound the actual stream, not an optional/untrusted Content-Length header. */
export async function readCredentialForm(request: Request): Promise<FormData> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.startsWith("multipart/form-data;") || !request.body) throw new HoaWorkflowError("Upload a document using multipart form data.", 415);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_CREDENTIAL_BYTES + 65536) { await reader.cancel(); throw new HoaWorkflowError("The upload is too large.", 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  try { return await new Response(Buffer.concat(chunks), { headers: { "Content-Type": contentType } }).formData(); }
  catch { throw new HoaWorkflowError("That upload could not be read.", 400); }
}
