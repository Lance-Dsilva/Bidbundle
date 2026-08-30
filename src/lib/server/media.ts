import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { del, put } from "@vercel/blob";
import sharp from "sharp";

import type { MediaRef } from "@/lib/amenity-types";
import { db } from "@/lib/server/db";
import { HoaWorkflowError } from "@/lib/server/hoa";
import {
  ALLOWED_MEDIA_TYPES,
  MAX_GALLERY_IMAGES,
  MAX_ISSUE_IMAGES,
  MAX_MEDIA_BYTES,
  MAX_REVIEW_IMAGES,
} from "@/lib/validation/amenities";

/**
 * The shared, server-authorized media service for HOA amenity content.
 *
 * Deliberately not a copy of the avatar handler. An avatar is a photo of a
 * person who chose to publish it; the files here include the inside of a
 * resident's clubhouse and photographs attached to a private complaint. Three
 * rules follow from that and are enforced below rather than by convention:
 *
 *  1. **No public URL is ever handed out.** `MediaAsset.storageUrl` is stored
 *     for server-side fetching and never serialized. Browsers receive
 *     `/api/hoa/amenities/media/{id}`, which re-runs authorization on every
 *     single request, so revoking a membership revokes the photos with it.
 *
 *  2. **The bytes decide the type, and then get rewritten.** A declared MIME
 *     type and a filename are both attacker-chosen. Every accepted image is
 *     re-encoded through sharp, which drops EXIF — including the GPS tags that
 *     would otherwise publish a resident's home coordinates inside a photo of
 *     a broken gate — and turns a decompression bomb into a failed decode
 *     rather than a stored payload.
 *
 *  3. **A failed database write takes its blob with it.** Storage is written
 *     first because the row needs its path; if the row then fails, the object
 *     is deleted rather than left billing for storage nothing points at.
 *
 * ── Residual risk, stated plainly ────────────────────────────────────────
 *
 * Vercel Blob on this project's plan issues public-if-known URLs. The stored
 * URL is unguessable and never leaves the server, so the practical exposure is
 * "an attacker who can already read the database". If Blob private buckets or
 * signed URLs become available, {@link readMediaBytes} is the single function
 * to change.
 */

export type MediaOwner =
  | { kind: "amenity_gallery"; amenityId: string }
  | { kind: "amenity_review"; reviewId: string }
  | { kind: "amenity_issue"; issueId: string };

export type MediaRejection = {
  reason: "missing" | "too-large" | "unsupported-type" | "unreadable" | "too-many";
  message: string;
};

export type NormalizedImage = {
  bytes: Buffer;
  contentType: (typeof ALLOWED_MEDIA_TYPES)[number];
  extension: string;
  width: number;
  height: number;
  checksum: string;
};

const EXTENSION_BY_TYPE: Record<(typeof ALLOWED_MEDIA_TYPES)[number], string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const MAX_LIMITS: Record<MediaOwner["kind"], number> = {
  amenity_gallery: MAX_GALLERY_IMAGES,
  amenity_review: MAX_REVIEW_IMAGES,
  amenity_issue: MAX_ISSUE_IMAGES,
};

/** Largest edge kept after normalization. Bounds both storage and decode cost. */
const MAX_DIMENSION = 2_400;
/** Anything larger than this decoded is treated as hostile, not merely big. */
const MAX_PIXELS = 40_000_000;

/**
 * Identifies an image from its leading bytes.
 *
 * Shares its reasoning with `lib/server/avatar.ts` but stays separate: the two
 * have different allow-lists and different failure copy, and merging them
 * would make a change to one silently change the other.
 */
export function sniffImageType(
  bytes: Uint8Array,
): (typeof ALLOWED_MEDIA_TYPES)[number] | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }

  const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= 8 && PNG.every((byte, index) => bytes[index] === byte)) {
    return "image/png";
  }

  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }

  return null;
}

/**
 * Validates, decodes, and re-encodes one uploaded image.
 *
 * The re-encode is the security control, not an optimisation: it is what
 * guarantees the stored object is a real image with no metadata, whatever the
 * uploader sent.
 */
export async function normalizeUpload(
  file: unknown,
): Promise<{ ok: true; image: NormalizedImage } | { ok: false; rejection: MediaRejection }> {
  if (!(file instanceof Blob) || file.size === 0) {
    return { ok: false, rejection: { reason: "missing", message: "Choose an image." } };
  }

  if (file.size > MAX_MEDIA_BYTES) {
    return {
      ok: false,
      rejection: {
        reason: "too-large",
        message: `Images must be ${Math.round(MAX_MEDIA_BYTES / (1024 * 1024))}MB or smaller.`,
      },
    };
  }

  const raw = new Uint8Array(await file.arrayBuffer());
  if (raw.length > MAX_MEDIA_BYTES) {
    return {
      ok: false,
      rejection: {
        reason: "too-large",
        message: `Images must be ${Math.round(MAX_MEDIA_BYTES / (1024 * 1024))}MB or smaller.`,
      },
    };
  }

  const sniffed = sniffImageType(raw);
  if (!sniffed) {
    return {
      ok: false,
      rejection: {
        reason: "unsupported-type",
        message: "That file is not a JPEG, PNG, or WebP image.",
      },
    };
  }

  try {
    const pipeline = sharp(Buffer.from(raw), {
      // `limitInputPixels` makes a crafted 100000x100000 PNG a decode error
      // instead of an out-of-memory kill.
      limitInputPixels: MAX_PIXELS,
      failOn: "error",
    });

    const metadata = await pipeline.metadata();
    if (!metadata.width || !metadata.height) {
      return {
        ok: false,
        rejection: { reason: "unreadable", message: "That image could not be read." },
      };
    }

    // `.rotate()` with no argument applies the EXIF orientation and then drops
    // it. sharp writes no metadata unless asked, so GPS tags do not survive.
    const output = await pipeline
      .rotate()
      .resize({
        width: MAX_DIMENSION,
        height: MAX_DIMENSION,
        fit: "inside",
        withoutEnlargement: true,
      })
      .toFormat(sniffed === "image/png" ? "png" : sniffed === "image/webp" ? "webp" : "jpeg", {
        quality: 82,
      })
      .toBuffer({ resolveWithObject: true });

    return {
      ok: true,
      image: {
        bytes: output.data,
        contentType: sniffed,
        extension: EXTENSION_BY_TYPE[sniffed],
        width: output.info.width,
        height: output.info.height,
        checksum: createHash("sha256").update(output.data).digest("hex"),
      },
    };
  } catch {
    // Malformed, truncated, or bomb content all land here. The specific cause
    // is deliberately not echoed to the uploader.
    return {
      ok: false,
      rejection: { reason: "unreadable", message: "That image could not be read." },
    };
  }
}

function blobToken(): string | null {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  return token && token.length > 0 ? token : null;
}

/**
 * Storage path for one asset.
 *
 * Random per object and namespaced by community and purpose, so a stored path
 * can be checked against the row that claims it and one HOA's objects never
 * share a prefix with another's.
 */
export function buildMediaPath(
  communityId: string,
  purpose: MediaOwner["kind"],
  extension: string,
): string {
  return `hoa-media/${communityId}/${purpose}/${randomUUID()}.${extension}`;
}

async function deleteBlobQuietly(path: string): Promise<void> {
  const token = blobToken();
  if (!token) return;
  try {
    await del(path, { token });
  } catch (error) {
    console.warn("[media] blob cleanup failed", {
      name: error instanceof Error ? error.name : "UnknownError",
    });
  }
}

/** How many live assets an owner already holds, for the per-owner ceiling. */
async function countExisting(owner: MediaOwner): Promise<number> {
  const where =
    owner.kind === "amenity_gallery"
      ? { amenityId: owner.amenityId }
      : owner.kind === "amenity_review"
        ? { reviewId: owner.reviewId }
        : { issueId: owner.issueId };
  return db.mediaAsset.count({ where: { ...where, status: "active" } });
}

export type StoreMediaInput = {
  communityId: string;
  uploaderUserId: string;
  owner: MediaOwner;
  image: NormalizedImage;
};

/**
 * Persists one normalized image and returns its row id.
 *
 * Throws {@link HoaWorkflowError} for a caller-fixable problem (the owner is
 * full) so route handlers map it to a 409 like every other domain rule.
 */
export async function storeMedia(input: StoreMediaInput): Promise<string> {
  const limit = MAX_LIMITS[input.owner.kind];
  const existing = await countExisting(input.owner);
  if (existing >= limit) {
    throw new HoaWorkflowError(
      `You can attach up to ${limit} photo${limit === 1 ? "" : "s"} here.`,
      409,
    );
  }

  const token = blobToken();
  if (!token) {
    console.error("[media] BLOB_READ_WRITE_TOKEN is not configured; upload refused.");
    throw new HoaWorkflowError(
      "Photo uploads are not available right now. Please try again later.",
      503,
    );
  }

  const path = buildMediaPath(input.communityId, input.owner.kind, input.image.extension);

  const uploaded = await put(path, input.image.bytes, {
    access: "public",
    contentType: input.image.contentType,
    addRandomSuffix: false,
    token,
  });

  try {
    const created = await db.mediaAsset.create({
      data: {
        communityId: input.communityId,
        purpose: input.owner.kind,
        uploaderUserId: input.uploaderUserId,
        amenityId: input.owner.kind === "amenity_gallery" ? input.owner.amenityId : null,
        reviewId: input.owner.kind === "amenity_review" ? input.owner.reviewId : null,
        issueId: input.owner.kind === "amenity_issue" ? input.owner.issueId : null,
        storagePath: path,
        storageUrl: uploaded.url,
        contentType: input.image.contentType,
        byteSize: input.image.bytes.byteLength,
        width: input.image.width,
        height: input.image.height,
        checksum: input.image.checksum,
        position: input.owner.kind === "amenity_gallery" ? existing : null,
      },
      select: { id: true },
    });
    return created.id;
  } catch (error) {
    // The object exists but nothing references it. Remove it before rethrowing.
    await deleteBlobQuietly(path);
    throw error;
  }
}

/**
 * Soft-removes an asset and deletes the stored object.
 *
 * The row survives so the audit trail — who uploaded what, and when it was
 * taken down — outlives the file itself, which is what the retention policy in
 * `docs/hoa-amenities.md` requires: keep the evidence, drop the private image.
 */
export async function removeMedia(
  mediaId: string,
  actorUserId: string,
  moderated = false,
): Promise<void> {
  const asset = await db.mediaAsset.findUnique({
    where: { id: mediaId },
    select: { id: true, storagePath: true, status: true },
  });
  if (!asset || asset.status === "removed") return;

  await db.mediaAsset.update({
    where: { id: mediaId },
    data: {
      status: "removed",
      deletedAt: new Date(),
      moderatedByUserId: moderated ? actorUserId : null,
      // The URL is cleared so a later bug cannot fetch a deleted object's
      // location out of the row.
      storageUrl: "",
    },
  });

  await deleteBlobQuietly(asset.storagePath);
}

/** The client-safe reference for one asset. Never includes `storageUrl`. */
export function toMediaRef(asset: {
  id: string;
  width: number | null;
  height: number | null;
}): MediaRef {
  return {
    id: asset.id,
    url: `/api/hoa/amenities/media/${asset.id}`,
    width: asset.width,
    height: asset.height,
  };
}

export type MediaAccess = {
  communityId: string;
  purpose: "amenity_gallery" | "amenity_review" | "amenity_issue";
  amenityId: string | null;
  reviewId: string | null;
  issueId: string | null;
  /** Set for an issue attachment: the only resident allowed to read it. */
  issueReporterUserId: string | null;
  /** Set for a review photo, so a removed review hides its images too. */
  reviewStatus: "published" | "removed" | null;
  amenityStatus: "draft" | "published" | "archived" | null;
  contentType: string;
  storageUrl: string;
};

/** Loads exactly the facts {@link canViewMedia} needs to decide. */
export async function loadMediaForAccess(mediaId: string): Promise<MediaAccess | null> {
  const asset = await db.mediaAsset.findFirst({
    where: { id: mediaId, status: "active" },
    select: {
      communityId: true,
      purpose: true,
      amenityId: true,
      reviewId: true,
      issueId: true,
      contentType: true,
      storageUrl: true,
      issue: { select: { reporterUserId: true } },
      review: { select: { status: true, amenity: { select: { status: true } } } },
      amenity: { select: { status: true } },
    },
  });
  if (!asset) return null;

  return {
    communityId: asset.communityId,
    purpose: asset.purpose,
    amenityId: asset.amenityId,
    reviewId: asset.reviewId,
    issueId: asset.issueId,
    issueReporterUserId: asset.issue?.reporterUserId ?? null,
    reviewStatus: asset.review?.status ?? null,
    amenityStatus: asset.amenity?.status ?? asset.review?.amenity.status ?? null,
    contentType: asset.contentType,
    storageUrl: asset.storageUrl,
  };
}

/**
 * The visibility matrix, in one place.
 *
 * Gallery and review images follow the amenity: any authorized member of that
 * HOA may see them. An issue attachment is narrower than the issue's own HOA —
 * only the resident who reported it, that HOA's staff, and a Bundleen admin.
 * A neighbour with an active membership in the same HOA must not be able to
 * page through their neighbours' complaint photos.
 */
export function canViewMedia(
  asset: MediaAccess,
  viewer: { communityId: string; userId: string; canManage: boolean },
): boolean {
  if (asset.communityId !== viewer.communityId) return false;

  if (asset.purpose === "amenity_issue") {
    return viewer.canManage || asset.issueReporterUserId === viewer.userId;
  }

  if (asset.purpose === "amenity_review") {
    // A removed review's photos go with it, for everyone except staff
    // reviewing the moderation decision.
    if (asset.reviewStatus === "removed" && !viewer.canManage) return false;
  }

  // Draft and archived amenities are configuration surfaces, not resident ones.
  if (asset.amenityStatus !== "published" && !viewer.canManage) return false;

  return true;
}

/**
 * Fetches the stored bytes for authenticated delivery.
 *
 * The single place a storage URL is dereferenced. Callers have already decided
 * the viewer is allowed to see it.
 */
export async function readMediaBytes(
  asset: MediaAccess,
): Promise<{ bytes: ArrayBuffer; contentType: string } | null> {
  if (!asset.storageUrl) return null;
  try {
    const response = await fetch(asset.storageUrl, { cache: "no-store" });
    if (!response.ok) return null;
    return { bytes: await response.arrayBuffer(), contentType: asset.contentType };
  } catch (error) {
    console.error("[media] fetch failed", {
      name: error instanceof Error ? error.name : "UnknownError",
    });
    return null;
  }
}
