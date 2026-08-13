import { del, put } from "@vercel/blob";
import { NextResponse } from "next/server";

import type { AvatarUploadResult } from "@/lib/profile-types";
import { authorizeRequest } from "@/lib/server/auth";
import { guardAvatarUpload, guardFailureResponse } from "@/lib/server/auth-guard";
import { buildAvatarPath, inspectAvatarUpload, isOwnedAvatarPath } from "@/lib/server/avatar";
import { db } from "@/lib/server/db";
import { internalErrorResponse } from "@/lib/server/profile";
import { MAX_AVATAR_BYTES } from "@/lib/validation/profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BLOB_UNCONFIGURED_MESSAGE =
  "Profile photo uploads are not available yet. Please try again later.";

/**
 * Reads the Blob credential.
 *
 * Returned, never logged or echoed: `@vercel/blob` needs the value, and a
 * handler that prints it once in a stack trace has published it to every log
 * sink the deployment has.
 */
function blobToken(): string | null {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  return token && token.length > 0 ? token : null;
}

/**
 * Removes a previously stored avatar, best-effort.
 *
 * Deletion failures are swallowed: the database row is already the source of
 * truth, and an orphaned object costs a few kilobytes, whereas failing the
 * request would leave the user staring at an error after a photo that did in
 * fact upload.
 */
async function deleteBlobIfOwned(path: string | null, userId: string, token: string): Promise<void> {
  if (!path || !isOwnedAvatarPath(path, userId)) return;

  try {
    await del(path, { token });
  } catch (error) {
    console.warn("[profile] avatar cleanup failed", {
      name: error instanceof Error ? error.name : "UnknownError",
    });
  }
}

/**
 * Replaces the signed-in user's profile photo.
 *
 * Accepts `multipart/form-data` with a single `file` field. The stored object
 * is written under the caller's own id, and only the resulting URL and path are
 * persisted — never the token that produced them.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const authorized = await authorizeRequest();
  if (!authorized.ok) return authorized.response;

  const rateLimitFailure = await guardAvatarUpload(authorized.user.id);
  if (rateLimitFailure) return guardFailureResponse(rateLimitFailure);

  const token = blobToken();
  if (!token) {
    console.error("[profile] BLOB_READ_WRITE_TOKEN is not configured; avatar upload refused.");
    return NextResponse.json({ error: BLOB_UNCONFIGURED_MESSAGE }, { status: 503 });
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    return NextResponse.json({ error: "Expected multipart/form-data." }, { status: 415 });
  }

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  // A little headroom over the image ceiling for multipart framing.
  if (Number.isFinite(declaredLength) && declaredLength > MAX_AVATAR_BYTES + 8 * 1024) {
    return NextResponse.json({ error: "That image is too large." }, { status: 413 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Could not read the uploaded file." }, { status: 400 });
  }

  const inspection = await inspectAvatarUpload(form.get("file"));
  if (!inspection.ok) {
    return NextResponse.json(
      { error: inspection.rejection.message },
      { status: inspection.rejection.reason === "too-large" ? 413 : 400 },
    );
  }

  const userId = authorized.user.id;
  // A fresh path per upload rather than a fixed name: the Blob CDN caches
  // aggressively, and reusing a path leaves the old photo on screen.
  const path = buildAvatarPath(userId, inspection.extension, crypto.randomUUID());

  try {
    const uploaded = await put(path, Buffer.from(inspection.bytes), {
      access: "public",
      contentType: inspection.contentType,
      // The path already carries a random segment; a second one would make the
      // stored path unpredictable and break ownership checks.
      addRandomSuffix: false,
      token,
    });

    const before = await db.user.findUnique({
      where: { id: userId },
      select: { avatarPath: true },
    });

    await db.user.update({
      where: { id: userId },
      data: {
        avatarUrl: uploaded.url,
        avatarPath: path,
        avatarUpdatedAt: new Date(),
      },
    });
    const previousPath = before?.avatarPath ?? null;

    // Only after the row points at the new object — the reverse order can lose
    // both photos if the update fails.
    await deleteBlobIfOwned(previousPath, userId, token);

    const result: AvatarUploadResult = {
      avatarUrl: uploaded.url,
      avatarUpdatedAt: new Date().toISOString(),
    };
    return NextResponse.json(result);
  } catch (error) {
    // The object may have been written before the database update failed.
    // Remove it so a failed request does not bill for storage nobody points at.
    await deleteBlobIfOwned(path, userId, token);
    return internalErrorResponse("avatar upload", error);
  }
}

/** Removes the signed-in user's profile photo and the stored object with it. */
export async function DELETE(): Promise<NextResponse> {
  const authorized = await authorizeRequest();
  if (!authorized.ok) return authorized.response;

  const userId = authorized.user.id;

  try {
    const before = await db.user.findUnique({
      where: { id: userId },
      select: { avatarPath: true },
    });
    const previousPath = before?.avatarPath ?? null;

    if (previousPath && isOwnedAvatarPath(previousPath, userId)) {
      const token = blobToken();
      if (!token) {
        console.error("[profile] BLOB_READ_WRITE_TOKEN is not configured; avatar removal refused.");
        return NextResponse.json({ error: BLOB_UNCONFIGURED_MESSAGE }, { status: 503 });
      }

      // Explicit removal is strict: do not clear the database pointer and tell
      // the user it worked while the public object is still accessible.
      await del(previousPath, { token });
    }

    await db.user.update({
      where: { id: userId },
      data: { avatarUrl: null, avatarPath: null, avatarUpdatedAt: null },
    });

    const result: AvatarUploadResult = { avatarUrl: null, avatarUpdatedAt: null };
    return NextResponse.json(result);
  } catch (error) {
    return internalErrorResponse("avatar removal", error);
  }
}
