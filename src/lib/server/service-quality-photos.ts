import "server-only";
import { randomUUID } from "node:crypto";
import { put, get, del } from "@vercel/blob";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/server/db";
import { HoaWorkflowError } from "@/lib/server/hoa";
import { normalizeUpload } from "@/lib/server/media";
import { visitPhotoStorageAuth } from "@/lib/server/visit-photo-storage-auth";
import { MAX_VISIT_PHOTO_BYTES } from "@/lib/server/visit-photos";
import { withinQualityReportWindow } from "@/lib/validation/service-quality";

async function access(tx: Prisma.TransactionClient, userId: string, claimId: string) {
  if (process.env.SERVICE_QUALITY_INTAKE !== "1") throw new HoaWorkflowError("Report unavailable.", 404);
  const claim = await tx.serviceQualityClaim.findUnique({ where: { id: claimId }, include: { visit: { include: { occurrence: { include: { agreement: true } } } } } });
  const user = await tx.user.findUnique({ where: { id: userId }, include: { adminAccess: true, providerProfile: true } });
  if (!claim || !user) throw new HoaWorkflowError("Report unavailable.", 404);
  const membership = await tx.communityMembership.findUnique({ where: { communityId_userId: { userId, communityId: claim.visit.occurrence.agreement.communityId } } });
  const resident = user.role === "homeowner" && claim.requesterUserId === userId && membership?.status === "active" &&
    (claim.visit.unitId ? membership.unitId === claim.visit.unitId : claim.visit.homeownerUserId === userId);
  const provider = user.role === "provider" && claim.providerUserId === userId && user.providerProfile?.accountStatus === "active";
  const admin = user.role === "admin" && user.isVerified && user.adminAccess?.status === "active" &&
    !user.adminAccess.isStaffAccount && user.adminAccess.email === user.email.toLowerCase();
  if (!resident && !provider && !admin) throw new HoaWorkflowError("Report unavailable.", 404);
  return { claim, resident };
}
const ref = (row: { id: string; createdAt: Date }) => ({ id: row.id, src: `/api/quality-photos/${row.id}`, createdAt: row.createdAt.toISOString() });

export async function listQualityPhotos(userId: string, claimId: string) {
  await access(db, userId, claimId);
  const photos = await db.serviceQualityPhoto.findMany({ where: { claimId }, orderBy: { createdAt: "asc" }, take: 8 });
  return photos.map(ref);
}

export async function storeQualityPhoto(userId: string, claimId: string, file: unknown) {
  const initial = await access(db, userId, claimId);
  if (!initial.resident) throw new HoaWorkflowError("Only the reporting resident can add evidence.", 403);
  if (initial.claim.resolution !== "reported" || !withinQualityReportWindow(initial.claim.visit.completedAt, new Date())) throw new HoaWorkflowError("Evidence uploads are closed. Contact support.", 409);
  const auth = await visitPhotoStorageAuth();
  if (!auth) throw new HoaWorkflowError("Private evidence storage is not configured.", 503);
  if (!(file instanceof Blob) || file.size > MAX_VISIT_PHOTO_BYTES) throw new HoaWorkflowError("Choose an image no larger than 4 MiB.", 413);
  const normalized = await normalizeUpload(file);
  if (!normalized.ok) throw new HoaWorkflowError(normalized.rejection.message, 422);
  const image = normalized.image;
  if (image.bytes.length > MAX_VISIT_PHOTO_BYTES) throw new HoaWorkflowError("Choose a smaller image.", 413);
  const id = randomUUID(), path = `quality-photos/${claimId}/${id}.${image.extension}`;
  try {
    await put(path, image.bytes, { access: "private", ...auth, contentType: image.contentType, addRandomSuffix: false, allowOverwrite: false });
    const saved = await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "ServiceQualityClaim" WHERE "id" = ${claimId} FOR UPDATE`;
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR SHARE`;
      await tx.$queryRaw`SELECT "id" FROM "CommunityMembership" WHERE "userId" = ${userId} AND "communityId" = ${initial.claim.visit.occurrence.agreement.communityId} FOR SHARE`;
      const current = await access(tx, userId, claimId);
      const [{ now }] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
      if (!current.resident || current.claim.resolution !== "reported" || !withinQualityReportWindow(current.claim.visit.completedAt, now)) throw new HoaWorkflowError("This report or your access changed. Contact support.", 409);
      if (await tx.serviceQualityPhoto.count({ where: { claimId } }) >= 8) throw new HoaWorkflowError("This report already has eight evidence photos.", 409);
      const photo = await tx.serviceQualityPhoto.create({ data: { id, claimId, uploaderUserId: userId, storagePath: path, contentType: image.contentType, byteSize: image.bytes.length, checksum: image.checksum } });
      await tx.supportTicket.update({ where: { id: current.claim.ticketId }, data: { lastActivityAt: now } });
      await tx.supportTicketEvent.create({ data: { ticketId: current.claim.ticketId, actorUserId: userId, type: "customer_replied" } });
      return photo;
    });
    return ref(saved);
  } catch (error) {
    try { await del(path, auth); } catch { console.warn("[quality-photos] own failed-upload cleanup failed"); }
    throw error;
  }
}

export async function readQualityPhoto(userId: string, photoId: string) {
  const photo = await db.serviceQualityPhoto.findUnique({ where: { id: photoId } });
  if (!photo) return null;
  await access(db, userId, photo.claimId);
  if (!/^quality-photos\/[a-f0-9-]{36}\/[a-f0-9-]{36}\.(jpg|png|webp)$/.test(photo.storagePath) || !photo.storagePath.startsWith(`quality-photos/${photo.claimId}/`)) return null;
  const auth = await visitPhotoStorageAuth();
  if (!auth) throw new HoaWorkflowError("Private evidence storage is not configured.", 503);
  const result = await get(photo.storagePath, { access: "private", ...auth });
  // Recheck access after a slow transport read before returning any private bytes.
  await access(db, userId, photo.claimId);
  return result?.statusCode === 200 ? { stream: result.stream, contentType: photo.contentType } : null;
}
