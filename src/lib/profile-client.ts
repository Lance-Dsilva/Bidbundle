"use client";

import { ApiError, apiFetch } from "@/lib/api";
import type {
  AvatarUploadResult,
  CommonProfile,
  HomeownerProfile,
  ProviderFullProfileResult,
  ProviderProfile,
} from "@/lib/profile-types";
import type { CommonProfileUpdate, ProviderProfileUpdate } from "@/lib/validation/profile";

/**
 * Typed wrappers around `/api/profile*`.
 *
 * Every call is same-origin and carries the Clerk session cookie; no token is
 * read from or written to browser storage.
 */

export function fetchCommonProfile(): Promise<CommonProfile> {
  return apiFetch<CommonProfile>("/profile", { cache: "no-store" });
}

export function patchCommonProfile(patch: CommonProfileUpdate): Promise<CommonProfile> {
  return apiFetch<CommonProfile>("/profile", { method: "PATCH", body: JSON.stringify(patch) });
}

export function fetchHomeownerProfile(): Promise<HomeownerProfile> {
  return apiFetch<HomeownerProfile>("/profile/homeowner", { cache: "no-store" });
}

export function patchHomeownerProfile(
  patch: Partial<HomeownerProfile>,
): Promise<HomeownerProfile> {
  return apiFetch<HomeownerProfile>("/profile/homeowner", {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function fetchProviderProfile(): Promise<ProviderProfile> {
  return apiFetch<ProviderProfile>("/profile/provider", { cache: "no-store" });
}

export function patchProviderProfile(patch: ProviderProfileUpdate): Promise<ProviderProfile> {
  return apiFetch<ProviderProfile>("/profile/provider", {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function putFullProviderProfile(
  common: CommonProfileUpdate,
  provider: ProviderProfileUpdate,
): Promise<ProviderFullProfileResult> {
  return apiFetch<ProviderFullProfileResult>("/profile/provider", {
    method: "PUT",
    body: JSON.stringify({ common, provider }),
  });
}

/**
 * Uploads a profile photo.
 *
 * `XMLHttpRequest` rather than `fetch` purely for `upload.onprogress` — a 4MB
 * photo on a phone connection needs a real progress bar, and `fetch` still has
 * no upload progress event.
 */
export function uploadAvatar(
  file: File,
  onProgress?: (percent: number) => void,
): Promise<AvatarUploadResult> {
  return new Promise((resolve, reject) => {
    const body = new FormData();
    body.append("file", file);

    const request = new XMLHttpRequest();
    request.open("POST", "/api/profile/avatar");
    request.withCredentials = true;

    request.upload.onprogress = (event) => {
      if (!onProgress || !event.lengthComputable) return;
      onProgress(Math.round((event.loaded / event.total) * 100));
    };

    request.onload = () => {
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(request.responseText);
      } catch {
        // Left null; handled as a generic failure below.
      }

      if (request.status >= 200 && request.status < 300) {
        onProgress?.(100);
        resolve(parsed as AvatarUploadResult);
        return;
      }

      const message =
        parsed && typeof parsed === "object" && typeof (parsed as { error?: unknown }).error === "string"
          ? (parsed as { error: string }).error
          : "We could not upload that photo.";
      reject(new ApiError(request.status, message));
    };

    request.onerror = () =>
      reject(new ApiError(0, "The upload failed. Check your connection and try again."));
    request.onabort = () => reject(new ApiError(0, "Upload cancelled."));

    request.send(body);
  });
}

export function removeAvatar(): Promise<AvatarUploadResult> {
  return apiFetch<AvatarUploadResult>("/profile/avatar", { method: "DELETE" });
}

/**
 * Turns any thrown value into a sentence worth showing.
 *
 * Server messages are already written for users — the profile handlers never
 * put a database or Clerk detail in one — so they pass through unchanged.
 */
export function describeError(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.message || fallback;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}
