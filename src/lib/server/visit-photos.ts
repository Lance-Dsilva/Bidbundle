import "server-only";

import { randomUUID } from "node:crypto";
import { del, get, put } from "@vercel/blob";
import { Prisma } from "@/generated/prisma/client";
import type { VisitPhotoRef } from "@/lib/hoa-types";
import { db } from "@/lib/server/db";
import { HoaWorkflowError } from "@/lib/server/hoa";
import { normalizeUpload } from "@/lib/server/media";

export const MAX_VISIT_PHOTO_BYTES = 4 * 1024 * 1024;
export const MAX_VISIT_PHOTOS_PER_PURPOSE = 8;
export type VisitPhotoPurpose = "visit_before" | "visit_after";

function privateToken() {
  const token = process.env.VISIT_PHOTO_BLOB_READ_WRITE_TOKEN;
  if (!token) throw new HoaWorkflowError("Private visit-photo storage is not configured yet.", 503);
  return token;
}

function photoConflict(error: unknown): never {
  const failure = error as { code?: string; meta?: { code?: string; driverAdapterError?: { cause?: { originalCode?: string } } }; cause?: { code?: string } } | null;
  const codes = [failure?.code, failure?.meta?.code, failure?.meta?.driverAdapterError?.cause?.originalCode, failure?.cause?.code];
  if (codes.some((code) => code && ["P1710", "P1711", "P1712", "P2025", "P2002", "40001", "40P01"].includes(code))) {
    throw new HoaWorkflowError("This visit, photo or access changed. Refresh before trying again.", 409);
  }
  throw error;
}

/** Resolve live ownership; a community membership alone never exposes another home's photos. */
export async function visitPhotoAccess(userId: string, visitId: string) {
  const [actor, visit] = await Promise.all([
    db.user.findUnique({ where: { id: userId }, select: {
      id: true, role: true, isVerified: true, email: true,
      adminAccess: { select: { status: true, email: true, isStaffAccount: true } },
      providerProfile: { select: { accountStatus: true } },
    } }),
    db.serviceVisit.findUnique({ where: { id: visitId }, include: {
      occurrence: { include: { agreement: { include: { community: { select: { status: true, type: true } } } } } },
    } }),
  ]);
  if (!actor || !visit || visit.occurrence.agreement.community.status !== "active") return null;
  const agreement = visit.occurrence.agreement;
  const [membership, staff] = await Promise.all([
    db.communityMembership.findFirst({ where: {
      userId, communityId: agreement.communityId, status: "active", ...(visit.unitId ? { unitId: visit.unitId } : {}),
    }, select: { id: true } }),
    db.communityStaffAssignment.findFirst({ where: {
      userId, communityId: agreement.communityId, status: "active", role: { in: ["hoa_manager", "hoa_team", "neighborhood_manager"] },
    }, select: { id: true } }),
  ]);
  const resident = actor.role === "homeowner" && !!membership && (!!visit.unitId || visit.homeownerUserId === userId);
  const provider = actor.role === "provider" && agreement.providerUserId === userId;
  const manager = (actor.role === "homeowner" || actor.role === "hoa_staff") && !!staff;
  const admin = actor.role === "admin" && actor.isVerified && actor.adminAccess?.status === "active" &&
    !actor.adminAccess.isStaffAccount && actor.adminAccess.email === actor.email.toLowerCase();
  return { visit, actor, resident, provider, manager, admin, canRead: resident || provider || manager || admin };
}

export function visitPhotoRef(asset: { id: string; purpose: string; createdAt: Date; marketingConsentedAt: Date | null }, canConsent = false): VisitPhotoRef {
  return {
    id: asset.id, purpose: asset.purpose as VisitPhotoPurpose, src: `/api/visit-photos/${encodeURIComponent(asset.id)}`,
    createdAt: asset.createdAt.toISOString(), marketingConsented: !!asset.marketingConsentedAt, canConsent,
  };
}

export async function listVisitPhotos(userId: string, visitId: string) {
  const access = await visitPhotoAccess(userId, visitId);
  if (!access?.canRead) throw new HoaWorkflowError("Visit not found.", 404);
  const rows = await db.mediaAsset.findMany({ where: { visitId, status: "active", purpose: { in: ["visit_before", "visit_after"] } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 16 });
  return { photos: rows.map((asset) => visitPhotoRef(asset, access.resident)), requiresAfterPhoto: access.visit.requiresAfterPhoto };
}

async function requirePhotoProvider(userId: string, visitId: string) {
  const access = await visitPhotoAccess(userId, visitId);
  if (!access?.provider) throw new HoaWorkflowError("Visit not found.", 404);
  if (access.actor.providerProfile?.accountStatus !== "active") throw new HoaWorkflowError("An active provider account is required.", 403);
  if (access.visit.occurrence.agreement.status !== "active" || !["scheduled", "en_route", "in_progress"].includes(access.visit.status)) {
    throw new HoaWorkflowError("Photos can be changed only while this service visit is active.", 409);
  }
  return access;
}

export async function storeVisitPhoto(userId: string, visitId: string, purpose: VisitPhotoPurpose, file: unknown): Promise<VisitPhotoRef> {
  if (purpose !== "visit_before" && purpose !== "visit_after") throw new HoaWorkflowError("Choose before or after.", 400);
  const access = await requirePhotoProvider(userId, visitId);
  const token = privateToken();
  if (!(file instanceof Blob) || !file.size) throw new HoaWorkflowError("Choose an image.", 400);
  if (file.size > MAX_VISIT_PHOTO_BYTES) throw new HoaWorkflowError("Visit photos must be 4 MiB or smaller.", 413);
  if (await db.mediaAsset.count({ where: { visitId, purpose, status: "active" } }) >= MAX_VISIT_PHOTOS_PER_PURPOSE) throw new HoaWorkflowError("This visit already has eight photos of that kind.", 409);
  const normalized = await normalizeUpload(file);
  if (!normalized.ok) throw new HoaWorkflowError(normalized.rejection.message, 422);
  const image = normalized.image;
  if (image.bytes.length > MAX_VISIT_PHOTO_BYTES) throw new HoaWorkflowError("The normalized photo is too large. Choose a smaller image.", 413);
  const id = randomUUID();
  const path = `visit-photos/${visitId}/${purpose}/${id}.${image.extension}`;
  await put(path, image.bytes, { access: "private", token, contentType: image.contentType, addRandomSuffix: false, allowOverwrite: false });
  try {
    const asset = await db.$transaction(async (tx) => {
      // A slow upload cannot be attached to a reassigned home, occurrence or
      // provider. Claim the exact reviewed visit before the insert guard locks
      // and rechecks the current provider and agreement.
      await tx.serviceVisit.update({ where: {
        id: visitId, updatedAt: access.visit.updatedAt, occurrenceId: access.visit.occurrenceId,
        unitId: access.visit.unitId, homeownerUserId: access.visit.homeownerUserId,
        occurrence: { agreement: { providerUserId: userId, status: "active" } },
      }, data: { updatedAt: new Date(Math.max(Date.now(), access.visit.updatedAt.getTime() + 1)) } });
      return tx.mediaAsset.create({ data: {
        id, visitId, communityId: access.visit.occurrence.agreement.communityId, purpose, uploaderUserId: userId,
        storagePath: path, storageUrl: "", contentType: image.contentType, byteSize: image.bytes.length,
        width: image.width, height: image.height, checksum: image.checksum,
      } });
    });
    // The database locks/rechecks live visit/provider authority and photo bounds.
    return visitPhotoRef(asset);
  } catch (error) {
    try { await del(path, { token }); } catch { console.warn("[visit-photos] own failed-upload cleanup failed"); }
    photoConflict(error);
  }
}

export async function removeVisitPhoto(userId: string, visitId: string, mediaId: string): Promise<void> {
  await requirePhotoProvider(userId, visitId);
  const asset = await db.mediaAsset.findFirst({ where: { id: mediaId, visitId, uploaderUserId: userId, status: "active", purpose: { in: ["visit_before", "visit_after"] } } });
  if (!asset) throw new HoaWorkflowError("Photo not found.", 404);
  try {
    await db.$transaction([
      db.$queryRaw(Prisma.sql`SELECT id FROM "ServiceVisit" WHERE id = ${visitId} FOR UPDATE`),
      db.mediaAsset.update({ where: { id: mediaId, status: "active", visitId }, data: { status: "removed", deletedAt: new Date() } }),
    ]);
  } catch (error) { photoConflict(error); }
  if (asset.storagePath.startsWith(`visit-photos/${visitId}/${asset.purpose}/`)) {
    try { await del(asset.storagePath, { token: privateToken() }); }
    catch { console.warn("[visit-photos] removed private object cleanup failed"); }
  }
}

export async function setVisitPhotoMarketingConsent(userId: string, visitId: string, mediaId: string, consent: boolean): Promise<VisitPhotoRef> {
  const asset = await db.mediaAsset.findFirst({ where: { id: mediaId, visitId, status: "active", purpose: { in: ["visit_before", "visit_after"] } } });
  if (!asset) throw new HoaWorkflowError("Photo not found.", 404);
  const access = await visitPhotoAccess(userId, visitId);
  const revokingOwnConsent = !consent && asset.marketingConsentUserId === userId;
  if (!access?.resident && !revokingOwnConsent) throw new HoaWorkflowError("Only this home's resident can change photo permission.", 403);
  try {
    const saved = await db.mediaAsset.update({ where: { id: mediaId, visitId, status: "active", checksum: asset.checksum, updatedAt: asset.updatedAt }, data: {
      marketingConsentChangedByUserId: userId,
      marketingConsentUserId: consent ? userId : null,
      marketingConsentedAt: consent ? new Date() : null,
      marketingConsentVersion: consent ? asset.checksum : null,
    } });
    return visitPhotoRef(saved, !!access?.resident);
  } catch (error) { photoConflict(error); }
}

export async function loadVisitPhotoForAccess(userId: string, mediaId: string) {
  const asset = await db.mediaAsset.findFirst({ where: { id: mediaId, status: "active", purpose: { in: ["visit_before", "visit_after"] } } });
  if (!asset?.visitId || asset.storageUrl !== "" || !asset.storagePath.startsWith(`visit-photos/${asset.visitId}/${asset.purpose}/`)) return null;
  const access = await visitPhotoAccess(userId, asset.visitId);
  return access?.canRead ? asset : null;
}

export async function readVisitPhotoBytes(asset: { storagePath: string; contentType: string }) {
  if (!/^visit-photos\/[A-Za-z0-9_-]+\/visit_(before|after)\/[a-f0-9-]{36}\.(jpg|png|webp)$/.test(asset.storagePath) || !["image/jpeg", "image/png", "image/webp"].includes(asset.contentType)) return null;
  const result = await get(asset.storagePath, { access: "private", token: privateToken() });
  return result?.statusCode === 200 ? result.stream : null;
}

export async function readVisitPhotoForm(request: Request): Promise<FormData> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.startsWith("multipart/form-data;") || !request.body) throw new HoaWorkflowError("Upload a photo using multipart form data.", 415);
  const reader = request.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > MAX_VISIT_PHOTO_BYTES + 65536) { await reader.cancel(); throw new HoaWorkflowError("The photo upload is too large.", 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  try { return await new Response(Buffer.concat(chunks), { headers: { "Content-Type": contentType } }).formData(); }
  catch { throw new HoaWorkflowError("That photo upload could not be read.", 400); }
}
