import "server-only";

import { randomUUID } from "node:crypto";

import { coordinateBoundsForRadius, distanceMiles } from "@/lib/geo";
import { MAX_ACTIVE_SERVICE_AREAS } from "@/lib/provider-coverage";
import type { Prisma } from "@/generated/prisma/client";
import type { ProviderServiceAreaInput } from "@/lib/validation/provider-coverage";
import { buildAuditEntry } from "@/lib/server/audit";
import { db } from "@/lib/server/db";
import { HoaWorkflowError } from "@/lib/server/hoa";

/**
 * The canonical read/write path for provider coverage circles.
 *
 * Every function takes the *authenticated* provider's Bundleen user id and
 * scopes every query by it, so a provider can only ever reach their own rows —
 * an `areaId` from a request body is never enough on its own.
 *
 * Eligibility is computed here and nowhere else the browser can reach. The
 * client draws a circle; the server decides what that circle matches.
 */

export type ProviderServiceAreaView = {
  id: string;
  label: string;
  centerLatitude: number | null;
  centerLongitude: number | null;
  radiusMiles: number | null;
  postalCodes: string[];
  isPrimary: boolean;
  formattedAddress: string | null;
  locality: string | null;
  region: string | null;
  postalCode: string | null;
  countryCode: string | null;
  status: "active" | "removed";
  createdAt: string;
  updatedAt: string;
};

type ServiceAreaRow = {
  id: string;
  label: string;
  centerLatitude: number | null;
  centerLongitude: number | null;
  radiusMiles: number | null;
  postalCodes: string[];
  isPrimary: boolean;
  formattedAddress: string | null;
  locality: string | null;
  region: string | null;
  postalCode: string | null;
  countryCode: string | null;
  status: "active" | "removed";
  createdAt: Date;
  updatedAt: Date;
};

/**
 * Full detail, including the exact center and business address.
 *
 * Only ever returned to the provider who owns the row. Coverage geometry is
 * private operational data: a customer sees "this provider serves your area",
 * never where the provider's yard is.
 */
export function serializeServiceArea(row: ServiceAreaRow): ProviderServiceAreaView {
  return {
    id: row.id,
    label: row.label,
    centerLatitude: row.centerLatitude,
    centerLongitude: row.centerLongitude,
    radiusMiles: row.radiusMiles,
    postalCodes: row.postalCodes,
    isPrimary: row.isPrimary,
    formattedAddress: row.formattedAddress,
    locality: row.locality,
    region: row.region,
    postalCode: row.postalCode,
    countryCode: row.countryCode,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const areaSelect = {
  id: true,
  label: true,
  centerLatitude: true,
  centerLongitude: true,
  radiusMiles: true,
  postalCodes: true,
  isPrimary: true,
  formattedAddress: true,
  locality: true,
  region: true,
  postalCode: true,
  countryCode: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} as const;

/** Only the account that owns a row may touch it. Fails closed with a 403. */
async function requireProviderAccount(providerUserId: string): Promise<void> {
  const user = await db.user.findUnique({
    where: { id: providerUserId },
    select: { role: true, providerProfile: { select: { id: true } } },
  });
  if (!user || user.role !== "provider" || !user.providerProfile) {
    throw new HoaWorkflowError("Only provider accounts can manage service areas.", 403);
  }
}

export async function listProviderServiceAreas(
  providerUserId: string,
): Promise<ProviderServiceAreaView[]> {
  const rows = await db.providerServiceArea.findMany({
    where: { providerUserId, status: "active" },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    select: areaSelect,
  });
  return rows.map(serializeServiceArea);
}

/**
 * The audit metadata a coverage change is allowed to carry.
 *
 * Deliberately no coordinates and no street address: `AdminAuditLog` is
 * append-only and human-readable, and a provider's exact base location has no
 * business being permanently recorded there. The radius and the coarse
 * locality are enough to review what changed.
 */
function coverageAuditMetadata(input: {
  status: "active" | "removed";
  radiusMiles?: number | null;
  isPrimary?: boolean;
  changedFields?: string[];
}): Record<string, unknown> {
  return {
    status: input.status,
    ...(input.radiusMiles != null ? { radiusMiles: input.radiusMiles } : {}),
    ...(input.isPrimary !== undefined ? { isPrimary: input.isPrimary } : {}),
    ...(input.changedFields?.length ? { changedFields: input.changedFields } : {}),
  };
}

function writeData(input: ProviderServiceAreaInput) {
  return {
    label: input.label,
    centerLatitude: input.centerLatitude,
    centerLongitude: input.centerLongitude,
    radiusMiles: input.radiusMiles,
    formattedAddress: input.formattedAddress,
    locality: input.locality,
    region: input.region,
    postalCode: input.postalCode,
    countryCode: input.countryCode,
    status: "active" as const,
  };
}

/**
 * Creates one coverage circle.
 *
 * The first active area a provider ever saves becomes primary automatically —
 * onboarding therefore does not need a separate "make this my main area" step,
 * and a provider is never left with active areas and no primary.
 */
export async function createProviderServiceArea(
  providerUserId: string,
  input: ProviderServiceAreaInput,
): Promise<ProviderServiceAreaView> {
  await requireProviderAccount(providerUserId);

  const existing = await db.providerServiceArea.findMany({
    where: { providerUserId, status: "active" },
    select: { id: true, isPrimary: true },
  });
  if (existing.length >= MAX_ACTIVE_SERVICE_AREAS) {
    throw new HoaWorkflowError(
      `Keep at most ${MAX_ACTIVE_SERVICE_AREAS} active service areas. Remove one before adding another.`,
      409,
    );
  }

  const shouldBePrimary = existing.length === 0 || input.isPrimary === true;
  const id = randomUUID();

  // Batch form, not an interactive transaction: Neon's pooled endpoint drops
  // `$transaction(async tx => …)` with P2028. Typed as `unknown` results
  // because the array mixes an `updateMany` batch payload with row writes.
  const ops: Prisma.PrismaPromise<unknown>[] = [];
  if (shouldBePrimary) {
    ops.push(
      db.providerServiceArea.updateMany({
        where: { providerUserId, status: "active", isPrimary: true },
        data: { isPrimary: false },
      }),
    );
  }
  ops.push(
    db.providerServiceArea.create({
      data: {
        id,
        providerUserId,
        isPrimary: shouldBePrimary,
        ...writeData(input),
      },
      select: areaSelect,
    }),
  );
  ops.push(
    db.adminAuditLog.create({
      data: buildAuditEntry({
        actorUserId: providerUserId,
        action: "provider_service_area_changed",
        targetType: "provider_service_area",
        targetId: id,
        providerUserId,
        metadata: coverageAuditMetadata({
          status: "active",
          radiusMiles: input.radiusMiles,
          isPrimary: shouldBePrimary,
        }),
      }),
    }),
  );

  const results = await db.$transaction(ops);
  const created = results[shouldBePrimary ? 1 : 0] as ServiceAreaRow;
  return serializeServiceArea(created);
}

/**
 * Updates one circle the caller owns.
 *
 * The `where` clause carries `providerUserId`, so a forged `areaId` selects
 * nothing rather than another provider's row.
 */
export async function updateProviderServiceArea(
  providerUserId: string,
  areaId: string,
  input: ProviderServiceAreaInput,
): Promise<ProviderServiceAreaView> {
  await requireProviderAccount(providerUserId);

  const existing = await db.providerServiceArea.findFirst({
    where: { id: areaId, providerUserId, status: "active" },
    select: areaSelect,
  });
  if (!existing) throw new HoaWorkflowError("That service area does not exist.", 404);

  const shouldBePrimary = input.isPrimary === true || existing.isPrimary;
  const changedFields: string[] = [];
  if (existing.label !== input.label) changedFields.push("label");
  if (existing.radiusMiles !== input.radiusMiles) changedFields.push("radiusMiles");
  if (
    existing.centerLatitude !== input.centerLatitude ||
    existing.centerLongitude !== input.centerLongitude
  ) {
    changedFields.push("center");
  }
  if (existing.isPrimary !== shouldBePrimary) changedFields.push("isPrimary");

  const ops: Prisma.PrismaPromise<unknown>[] = [];
  if (shouldBePrimary && !existing.isPrimary) {
    ops.push(
      db.providerServiceArea.updateMany({
        where: { providerUserId, status: "active", isPrimary: true },
        data: { isPrimary: false },
      }),
    );
  }
  const updateIndex = ops.length;
  ops.push(
    db.providerServiceArea.update({
      where: { id: areaId },
      data: { isPrimary: shouldBePrimary, ...writeData(input) },
      select: areaSelect,
    }),
  );
  ops.push(
    db.adminAuditLog.create({
      data: buildAuditEntry({
        actorUserId: providerUserId,
        action: "provider_service_area_changed",
        targetType: "provider_service_area",
        targetId: areaId,
        providerUserId,
        metadata: coverageAuditMetadata({
          status: "active",
          radiusMiles: input.radiusMiles,
          isPrimary: shouldBePrimary,
          changedFields,
        }),
      }),
    }),
  );

  const results = await db.$transaction(ops);
  return serializeServiceArea(results[updateIndex] as ServiceAreaRow);
}

/**
 * Deactivates one circle.
 *
 * Rows are never deleted: a removed area still explains why a provider was
 * eligible for a request they bid on last month. Removing the primary promotes
 * the oldest remaining active area, so "active areas but no primary" is not a
 * state this function can produce.
 */
export async function deactivateProviderServiceArea(
  providerUserId: string,
  areaId: string,
): Promise<{ remainingActive: number }> {
  await requireProviderAccount(providerUserId);

  const area = await db.providerServiceArea.findFirst({
    where: { id: areaId, providerUserId, status: "active" },
    select: { id: true, isPrimary: true, radiusMiles: true },
  });
  if (!area) throw new HoaWorkflowError("That service area does not exist.", 404);

  const successor = area.isPrimary
    ? await db.providerServiceArea.findFirst({
        where: { providerUserId, status: "active", id: { not: areaId } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { id: true },
      })
    : null;

  const ops: Prisma.PrismaPromise<unknown>[] = [
    db.providerServiceArea.updateMany({
      where: { id: areaId, providerUserId, status: "active" },
      data: { status: "removed", isPrimary: false },
    }),
  ];
  if (successor) {
    ops.push(
      db.providerServiceArea.update({
        where: { id: successor.id },
        data: { isPrimary: true },
      }),
    );
  }
  ops.push(
    db.adminAuditLog.create({
      data: buildAuditEntry({
        actorUserId: providerUserId,
        action: "provider_service_area_changed",
        targetType: "provider_service_area",
        targetId: areaId,
        providerUserId,
        metadata: coverageAuditMetadata({
          status: "removed",
          radiusMiles: area.radiusMiles,
        }),
      }),
    }),
  );

  await db.$transaction(ops);

  const remainingActive = await db.providerServiceArea.count({
    where: { providerUserId, status: "active" },
  });
  return { remainingActive };
}

/* ── Matching ────────────────────────────────────────────────────────────── */

export type CoverageCircle = {
  centerLatitude: number | null;
  centerLongitude: number | null;
  radiusMiles: number | null;
  postalCodes?: string[];
};

export type CoverageTarget = {
  latitude: number | null;
  longitude: number | null;
  postalCode?: string | null;
};

export type CoverageVerdict = {
  /** `null` means "cannot tell" — a missing coordinate is never "at distance 0". */
  covered: boolean | null;
  /** Distance to the nearest covering circle's center, or null when unknown. */
  distanceMi: number | null;
};

/**
 * Whether one circle covers one location.
 *
 * Returns `null` rather than `false` when either side lacks geometry: a request
 * with no verified coordinates is *unknown*, and treating unknown as "inside"
 * (distance 0) would show providers work they cannot reach, while treating it
 * as a hard "outside" would silently hide legitimate requests. Callers decide
 * what to do with unknown; matching excludes it.
 */
export function circleCoversLocation(
  circle: CoverageCircle,
  target: CoverageTarget,
): CoverageVerdict {
  const postalMatch =
    target.postalCode && circle.postalCodes?.length
      ? circle.postalCodes.some(
          (code) => code.toUpperCase() === target.postalCode!.toUpperCase(),
        )
      : false;

  if (
    circle.centerLatitude == null ||
    circle.centerLongitude == null ||
    circle.radiusMiles == null
  ) {
    return { covered: postalMatch ? true : null, distanceMi: null };
  }
  if (target.latitude == null || target.longitude == null) {
    return { covered: postalMatch ? true : null, distanceMi: null };
  }

  const distance = distanceMiles(
    { latitude: circle.centerLatitude, longitude: circle.centerLongitude },
    { latitude: target.latitude, longitude: target.longitude },
  );
  // Inclusive: a home exactly on the boundary is inside the circle the
  // provider drew. Rounded to a tenth of a mile first so a floating-point
  // remainder cannot flip a boundary case between two otherwise equal runs.
  const covered = Math.round(distance * 10) / 10 <= circle.radiusMiles || postalMatch;
  return { covered, distanceMi: Math.round(distance * 10) / 10 };
}

/** True when *any* active circle covers the location. Unknown counts as no. */
export function coverageCoversLocation(
  circles: readonly CoverageCircle[],
  target: CoverageTarget,
): CoverageVerdict {
  let best: CoverageVerdict = { covered: circles.length === 0 ? false : null, distanceMi: null };
  for (const circle of circles) {
    const verdict = circleCoversLocation(circle, target);
    if (verdict.covered === true) {
      if (best.covered !== true || (verdict.distanceMi ?? Infinity) < (best.distanceMi ?? Infinity)) {
        best = verdict;
      }
      continue;
    }
    if (best.covered === true) continue;
    if (verdict.covered === false) {
      best = {
        covered: false,
        distanceMi:
          best.distanceMi == null
            ? verdict.distanceMi
            : Math.min(best.distanceMi, verdict.distanceMi ?? Infinity),
      };
    }
  }
  return best;
}

/**
 * Bounding-box prefilter for "which providers could possibly cover this point".
 *
 * A rectangle is cheap for the database and always a superset of the circle;
 * the exact verdict still comes from Haversine in {@link coverageCoversLocation}.
 * The widest possible circle is used for the box because each provider's radius
 * differs and the filter must not exclude a large-radius provider.
 */
export function coverageBoundsFilter(target: {
  latitude: number;
  longitude: number;
  maxRadiusMiles: number;
}) {
  const bounds = coordinateBoundsForRadius(
    { latitude: target.latitude, longitude: target.longitude },
    target.maxRadiusMiles,
  );
  return {
    centerLatitude: { gte: bounds.minLatitude, lte: bounds.maxLatitude },
    OR: bounds.longitudeRanges.map((range) => ({
      centerLongitude: { gte: range.min, lte: range.max },
    })),
  };
}
