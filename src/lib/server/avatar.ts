import "server-only";

import { ALLOWED_AVATAR_TYPES, MAX_AVATAR_BYTES } from "@/lib/validation/profile";

/**
 * Avatar file inspection.
 *
 * Kept out of the route handler so the rules can be unit-tested without a
 * Blob store, a database, or a Clerk session.
 */

export type AvatarType = (typeof ALLOWED_AVATAR_TYPES)[number];

const EXTENSION_BY_TYPE: Record<AvatarType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export type AvatarRejection =
  | { reason: "missing"; message: string }
  | { reason: "too-large"; message: string }
  | { reason: "unsupported-type"; message: string };

export type AvatarInspection =
  | { ok: true; bytes: Uint8Array; contentType: AvatarType; extension: string }
  | { ok: false; rejection: AvatarRejection };

const SUPPORTED_LIST = "JPEG, PNG, or WebP";

/**
 * Identifies an image from its leading bytes.
 *
 * The browser-supplied `Content-Type` and filename are both attacker-chosen, so
 * neither decides what gets stored. An `.png` full of HTML would be served back
 * from the Blob host on a URL this app hands out, so the actual bytes have to
 * agree with the label.
 */
export function sniffImageType(bytes: Uint8Array): AvatarType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }

  const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= 8 && PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)) {
    return "image/png";
  }

  // RIFF....WEBP
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

/** Applies presence, size, and real-type checks to an uploaded form field. */
export async function inspectAvatarUpload(file: unknown): Promise<AvatarInspection> {
  if (!(file instanceof Blob) || file.size === 0) {
    return {
      ok: false,
      rejection: { reason: "missing", message: "Choose an image to upload." },
    };
  }

  // Checked before reading so an oversized file is refused without being
  // buffered into memory.
  if (file.size > MAX_AVATAR_BYTES) {
    return {
      ok: false,
      rejection: {
        reason: "too-large",
        message: `Images must be ${Math.round(MAX_AVATAR_BYTES / (1024 * 1024))}MB or smaller.`,
      },
    };
  }

  const bytes = new Uint8Array(await file.arrayBuffer());

  // `Blob.size` is trustworthy, but re-checking the decoded length costs
  // nothing and closes the gap if the stream ever reports a smaller size than
  // it delivers.
  if (bytes.length > MAX_AVATAR_BYTES) {
    return {
      ok: false,
      rejection: {
        reason: "too-large",
        message: `Images must be ${Math.round(MAX_AVATAR_BYTES / (1024 * 1024))}MB or smaller.`,
      },
    };
  }

  const contentType = sniffImageType(bytes);
  if (!contentType) {
    return {
      ok: false,
      rejection: {
        reason: "unsupported-type",
        message: `That file is not a ${SUPPORTED_LIST} image.`,
      },
    };
  }

  return { ok: true, bytes, contentType, extension: EXTENSION_BY_TYPE[contentType] };
}

/**
 * Builds the storage path for a user's avatar.
 *
 * The owning user id is a path segment, so a stored path can be checked against
 * the caller before anything is deleted, and one user's upload can never land
 * on another user's object.
 */
export function buildAvatarPath(userId: string, extension: string, unique: string): string {
  return `avatars/${userId}/${unique}.${extension}`;
}

/** True when `path` belongs to `userId` under {@link buildAvatarPath}. */
export function isOwnedAvatarPath(path: string, userId: string): boolean {
  return path.startsWith(`avatars/${userId}/`);
}
