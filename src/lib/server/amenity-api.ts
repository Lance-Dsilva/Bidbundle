import "server-only";

import { NextResponse } from "next/server";

import type { AmenityScope } from "@/lib/server/amenity-auth";
import {
  requireAmenityManager,
  requireAmenityResident,
  requireAmenityViewer,
  scopeForAmenity,
} from "@/lib/server/amenity-auth";
import { authorizeRequest, type SessionUser } from "@/lib/server/auth";
import {
  guardAmenityBroadcast,
  guardAmenityMediaUpload,
  guardAmenityMutation,
  guardFailureResponse,
} from "@/lib/server/auth-guard";
import { HoaWorkflowError } from "@/lib/server/hoa";
import { readJsonBody, validationErrorResponse } from "@/lib/server/profile";
import { MAX_AMENITY_BODY_BYTES } from "@/lib/validation/amenities";

/**
 * The shared front door for every amenity route handler.
 *
 * Each helper does the same three things in the same order — authenticate,
 * rate-limit, then resolve a database-derived {@link AmenityScope} — and hands
 * back either that scope or the response to return. A handler that forgets one
 * of the three does not compile, because it never gets a scope to query with.
 */

export type AmenityGate =
  | { ok: true; user: SessionUser; scope: AmenityScope }
  | { ok: false; response: NextResponse };

type Limiter = "mutation" | "media" | "broadcast" | "none";

async function applyLimiter(
  limiter: Limiter,
  userId: string,
): Promise<NextResponse | null> {
  if (limiter === "none") return null;
  const failure =
    limiter === "media"
      ? await guardAmenityMediaUpload(userId)
      : limiter === "broadcast"
        ? await guardAmenityBroadcast(userId)
        : await guardAmenityMutation(userId);
  return failure ? guardFailureResponse(failure) : null;
}

async function gate(
  resolve: (user: SessionUser) => Promise<AmenityScope>,
  limiter: Limiter,
): Promise<AmenityGate> {
  // Providers and unaffiliated accounts never reach an amenity surface: the
  // whole feature is homeowner-and-staff only, and `admin` is included solely
  // for the audited recovery path.
  const authorized = await authorizeRequest(["homeowner", "admin"]);
  if (!authorized.ok) return { ok: false, response: authorized.response };

  const limited = await applyLimiter(limiter, authorized.user.id);
  if (limited) return { ok: false, response: limited };

  try {
    const scope = await resolve(authorized.user);
    return { ok: true, user: authorized.user, scope };
  } catch (error) {
    return { ok: false, response: amenityErrorResponse("scope", error) };
  }
}

/** Active resident of the given HOA. */
export function requireResidentScope(
  communityId: string,
  limiter: Limiter = "none",
): Promise<AmenityGate> {
  return gate((user) => requireAmenityResident(user.id, communityId), limiter);
}

/** Resident, scoped staff, or Bundleen admin of the given HOA. */
export function requireViewerScope(
  communityId: string,
  limiter: Limiter = "none",
): Promise<AmenityGate> {
  return gate((user) => requireAmenityViewer(user, communityId), limiter);
}

/** Scoped staff or Bundleen admin of the given HOA. */
export function requireManagerScope(
  communityId: string,
  limiter: Limiter = "mutation",
): Promise<AmenityGate> {
  return gate((user) => requireAmenityManager(user, communityId), limiter);
}

/**
 * Resolves the scope from the amenity itself.
 *
 * The community is read off the row rather than taken from the request, so a
 * caller who guesses another HOA's amenity id gets a 403 from their own
 * membership check instead of a cross-tenant read.
 */
export async function requireAmenityScope(
  amenityId: string,
  mode: "view" | "manage" = "view",
  limiter: Limiter = "none",
): Promise<AmenityGate> {
  return gate(async (user) => {
    const resolved = await scopeForAmenity(user, amenityId, mode);
    return resolved.scope;
  }, limiter);
}

export function readAmenityBody(request: Request) {
  return readJsonBody(request, MAX_AMENITY_BODY_BYTES);
}

export { validationErrorResponse };

/**
 * Maps a domain error to a safe response.
 *
 * Everything the caller can act on carries its own status from
 * {@link HoaWorkflowError}. Anything else is logged with its name only and
 * answered generically — an amenity handler must never echo a database
 * message, which can quote a resident's own text back at a stranger.
 */
export function amenityErrorResponse(scope: string, error: unknown): NextResponse {
  if (error instanceof HoaWorkflowError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }

  if (
    typeof error === "object" &&
    error !== null &&
    ((error as { code?: unknown }).code === "P2002" ||
      (error as { code?: unknown }).code === "23505")
  ) {
    return NextResponse.json(
      { error: "That already exists. Refresh the page and try again." },
      { status: 409 },
    );
  }

  console.error(`[amenities] ${scope} failed`, {
    name: error instanceof Error ? error.name : "UnknownError",
  });
  return NextResponse.json(
    { error: "Something went wrong on our end. Please try again." },
    { status: 500 },
  );
}

/** Reads `communityId` from the query string, or returns the 400 to send. */
export function readCommunityId(
  request: Request,
): { ok: true; communityId: string } | { ok: false; response: NextResponse } {
  const communityId = new URL(request.url).searchParams.get("communityId");
  if (!communityId) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Choose a community." }, { status: 400 }),
    };
  }
  return { ok: true, communityId };
}
