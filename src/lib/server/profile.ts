import "server-only";

import { NextResponse } from "next/server";

import type { CommonProfile, HomeownerProfile, ProviderProfile } from "@/lib/profile-types";
import { isAppRole } from "@/lib/validation/auth";
import {
  COMMUNITY_RADIUS_MI,
  MAX_PROFILE_BODY_BYTES,
  type CommonProfileUpdate,
  type ProviderProfileUpdate,
} from "@/lib/validation/profile";

/**
 * Shared plumbing for the `/api/profile*` handlers: body reading, row → wire
 * serialization, and the two error responses every handler can produce.
 */

/* ── Request body ────────────────────────────────────────────────────────── */

export type BodyResult = { ok: true; value: unknown } | { ok: false; response: NextResponse };

/**
 * Reads a JSON body with a hard size ceiling.
 *
 * `Content-Length` is checked first so an oversized upload is rejected before
 * it is buffered, and the decoded length is checked again afterwards because a
 * chunked request can omit or understate the header.
 */
export async function readJsonBody(
  request: Request,
  maxBytes: number = MAX_PROFILE_BODY_BYTES,
): Promise<BodyResult> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Expected application/json." }, { status: 415 }),
    };
  }

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Request body is too large." }, { status: 413 }),
    };
  }

  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return {
      ok: false,
      response: NextResponse.json({ error: "Could not read the request body." }, { status: 400 }),
    };
  }

  if (new TextEncoder().encode(raw).length > maxBytes) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Request body is too large." }, { status: 413 }),
    };
  }

  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return {
      ok: false,
      response: NextResponse.json({ error: "Invalid JSON body." }, { status: 400 }),
    };
  }
}

/* ── Error responses ─────────────────────────────────────────────────────── */

export function validationErrorResponse(fields: Record<string, string>): NextResponse {
  return NextResponse.json(
    { error: "Please check the highlighted fields.", fields },
    { status: 400 },
  );
}

/**
 * Logs the failure class and returns a body that says nothing about it.
 *
 * Prisma error messages quote the failing statement, which for these tables
 * means addresses, coordinates, and license numbers. Only the error's name
 * reaches the log, and only a fixed sentence reaches the client.
 */
export function internalErrorResponse(scope: string, error: unknown): NextResponse {
  console.error(`[profile] ${scope} failed`, {
    name: error instanceof Error ? error.name : "UnknownError",
  });
  return NextResponse.json(
    { error: "Something went wrong on our end. Please try again." },
    { status: 500 },
  );
}

/* ── Consistency helpers ─────────────────────────────────────────────────── */

/**
 * Invalidates a saved position when its human-readable address changes unless
 * the same request supplies a fresh coordinate pair.
 */
export function commonProfileUpdateData(
  currentAddress: string | null,
  patch: CommonProfileUpdate,
): CommonProfileUpdate {
  if (
    "address" in patch &&
    patch.address !== currentAddress &&
    !("latitude" in patch || "longitude" in patch)
  ) {
    return { ...patch, latitude: null, longitude: null };
  }
  return patch;
}

type ProviderClaims = Pick<
  ProviderProfileUpdate,
  "licenseNumber" | "licenseState" | "insuranceProvider" | "insurancePolicyNumber"
>;

/** Clears staff verification whenever the underlying provider claim changes. */
export function providerProfileUpdateData(
  current: Partial<ProviderClaims> | null,
  patch: ProviderProfileUpdate,
): ProviderProfileUpdate & {
  licenseVerifiedAt?: null;
  insuranceVerifiedAt?: null;
} {
  const licenseChanged =
    current !== null &&
    (["licenseNumber", "licenseState"] as const).some(
      (field) => field in patch && patch[field] !== (current[field] ?? null),
    );
  const insuranceChanged =
    current !== null &&
    (["insuranceProvider", "insurancePolicyNumber"] as const).some(
      (field) => field in patch && patch[field] !== (current[field] ?? null),
    );

  return {
    ...patch,
    ...(licenseChanged ? { licenseVerifiedAt: null } : {}),
    ...(insuranceChanged ? { insuranceVerifiedAt: null } : {}),
  };
}

/* ── Prisma selections ───────────────────────────────────────────────────── */

/**
 * Every column the common profile exposes.
 *
 * An explicit selection rather than the whole row: new sensitive columns then
 * have to be opted into a response instead of leaking into one.
 */
export const commonProfileSelect = {
  id: true,
  email: true,
  fullName: true,
  phone: true,
  role: true,
  isVerified: true,
  address: true,
  neighborhood: true,
  latitude: true,
  longitude: true,
  avatarUrl: true,
  avatarUpdatedAt: true,
  createdAt: true,
} as const;

export const homeownerProfileSelect = {
  notifyBids: true,
  notifyGroups: true,
  notifySavings: true,
  notifyEmail: true,
  notifyPush: true,
  serviceRadiusMi: true,
} as const;

export const providerProfileSelect = {
  companyName: true,
  bio: true,
  trades: true,
  serviceRadiusMi: true,
  workingDays: true,
  workingHoursStart: true,
  workingHoursEnd: true,
  licenseNumber: true,
  licenseState: true,
  insuranceProvider: true,
  insurancePolicyNumber: true,
  licenseVerifiedAt: true,
  insuranceVerifiedAt: true,
  payoutStatus: true,
  payoutLast4: true,
  payoutProvider: true,
  payoutUpdatedAt: true,
  notifyNewJobs: true,
  notifyMessages: true,
  notifyPayouts: true,
} as const;

/* ── Serializers ─────────────────────────────────────────────────────────── */

type CommonProfileRow = {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  role: string;
  isVerified: boolean;
  address: string | null;
  neighborhood: string | null;
  latitude: number | null;
  longitude: number | null;
  avatarUrl: string | null;
  avatarUpdatedAt: Date | null;
  createdAt: Date;
};

export function serializeCommonProfile(row: CommonProfileRow): CommonProfile {
  return {
    id: row.id,
    email: row.email,
    fullName: row.fullName,
    phone: row.phone,
    // The column is an enum, so this only fails if the enum gains a member the
    // application does not know about; `homeowner` is the least-privileged
    // fallback.
    role: isAppRole(row.role) ? row.role : "homeowner",
    isVerified: row.isVerified,
    address: row.address,
    neighborhood: row.neighborhood,
    latitude: row.latitude,
    longitude: row.longitude,
    avatarUrl: row.avatarUrl,
    avatarUpdatedAt: row.avatarUpdatedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    communityRadiusMi: COMMUNITY_RADIUS_MI,
  };
}

type HomeownerProfileRow = {
  notifyBids: boolean;
  notifyGroups: boolean;
  notifySavings: boolean;
  notifyEmail: boolean;
  notifyPush: boolean;
  serviceRadiusMi: number;
};

export function serializeHomeownerProfile(row: HomeownerProfileRow): HomeownerProfile {
  return {
    notifyBids: row.notifyBids,
    notifyGroups: row.notifyGroups,
    notifySavings: row.notifySavings,
    notifyEmail: row.notifyEmail,
    notifyPush: row.notifyPush,
    serviceRadiusMi: row.serviceRadiusMi,
  };
}

type ProviderProfileRow = {
  companyName: string | null;
  bio: string | null;
  trades: string[];
  serviceRadiusMi: number;
  workingDays: string[];
  workingHoursStart: string | null;
  workingHoursEnd: string | null;
  licenseNumber: string | null;
  licenseState: string | null;
  insuranceProvider: string | null;
  insurancePolicyNumber: string | null;
  licenseVerifiedAt: Date | null;
  insuranceVerifiedAt: Date | null;
  payoutStatus: string;
  payoutLast4: string | null;
  payoutProvider: string | null;
  payoutUpdatedAt: Date | null;
  notifyNewJobs: boolean;
  notifyMessages: boolean;
  notifyPayouts: boolean;
};

export function serializeProviderProfile(row: ProviderProfileRow): ProviderProfile {
  return {
    companyName: row.companyName,
    bio: row.bio,
    trades: row.trades,
    serviceRadiusMi: row.serviceRadiusMi,
    workingDays: row.workingDays as ProviderProfile["workingDays"],
    workingHoursStart: row.workingHoursStart,
    workingHoursEnd: row.workingHoursEnd,
    licenseNumber: row.licenseNumber,
    licenseState: row.licenseState,
    insuranceProvider: row.insuranceProvider,
    insurancePolicyNumber: row.insurancePolicyNumber,
    // Verified means an admin recorded a timestamp — never that the provider
    // filled in a license number.
    isLicenseVerified: row.licenseVerifiedAt !== null,
    isInsuranceVerified: row.insuranceVerifiedAt !== null,
    licenseVerifiedAt: row.licenseVerifiedAt?.toISOString() ?? null,
    insuranceVerifiedAt: row.insuranceVerifiedAt?.toISOString() ?? null,
    payoutStatus: row.payoutStatus as ProviderProfile["payoutStatus"],
    payoutLast4: row.payoutLast4,
    payoutProvider: row.payoutProvider,
    payoutUpdatedAt: row.payoutUpdatedAt?.toISOString() ?? null,
    notifyNewJobs: row.notifyNewJobs,
    notifyMessages: row.notifyMessages,
    notifyPayouts: row.notifyPayouts,
  };
}
