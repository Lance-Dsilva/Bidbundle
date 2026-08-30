import "server-only";

import { db } from "@/lib/server/db";

/**
 * Turning a locked participant set into valid service targets.
 *
 * A `ServiceVisit` must have exactly one target, and a neighbourhood target
 * must carry a routeable address snapshot. That is enforced by database CHECK
 * constraints; this module is what makes sure the application never *tries* to
 * violate them, and produces an actionable answer when it cannot proceed.
 *
 * The snapshot is taken once, at award time, and never re-read from the
 * homeowner's mutable profile afterwards. A resident who moves house next year
 * must not silently rewrite the address a crew visited last month.
 */

/** An HOA stop: the unit inventory is already the record of the location. */
export type UnitTarget = {
  kind: "unit";
  unitId: string;
  /** The resident to notify, when the home is occupied. */
  userId: string | null;
};

/** A neighbourhood stop plus the immutable copy of where it is. */
export type HomeownerTarget = {
  kind: "homeowner";
  userId: string;
  label: string;
  addressLine1: string;
  addressLine2: string | null;
  locality: string | null;
  region: string | null;
  postalCode: string | null;
  country: string | null;
  latitude: number;
  longitude: number;
  accessNotes: string | null;
};

export type ServiceTarget = UnitTarget | HomeownerTarget;

export type TargetResolution =
  | { ok: true; targets: ServiceTarget[] }
  /**
   * At least one participant cannot be routed to. Deliberately a whole-batch
   * refusal: a partial award would create an agreement whose locked home count
   * does not match the homes that will actually be served.
   */
  | { ok: false; missing: Array<{ userId: string; displayName: string }> };

/**
 * Splits a single-line profile address into the parts a crew needs.
 *
 * Homeowner profiles store one free-text address plus server-resolved
 * coordinates — there is no structured form to copy. Rather than pretend to
 * parse arbitrary postal formats, this keeps the whole line as
 * `addressLine1` and lifts a trailing "City, ST 12345" tail into its own
 * fields when the line clearly has one. Anything it cannot recognise stays in
 * `addressLine1`, which is always complete and always what gets displayed.
 */
export function splitProfileAddress(address: string): {
  addressLine1: string;
  locality: string | null;
  region: string | null;
  postalCode: string | null;
} {
  const trimmed = address.replace(/\s+/g, " ").trim();
  const parts = trimmed.split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) {
    return { addressLine1: trimmed, locality: null, region: null, postalCode: null };
  }

  const tail = parts[parts.length - 1];
  // "TX 78701", "TX", "78701" — the shapes a US address actually ends in.
  const stateZip = /^([A-Za-z .]{2,20}?)\s+([A-Za-z0-9][A-Za-z0-9 -]{2,11})$/.exec(tail);
  if (stateZip) {
    return {
      addressLine1: parts.slice(0, -2).join(", ") || parts[0],
      locality: parts.length >= 2 ? parts[parts.length - 2] : null,
      region: stateZip[1].trim(),
      postalCode: stateZip[2].trim(),
    };
  }

  return {
    addressLine1: parts.slice(0, -1).join(", "),
    locality: parts[parts.length - 1],
    region: null,
    postalCode: null,
  };
}

/**
 * HOA targets: one per joined participation that names a unit.
 *
 * Unchanged behavior — the unit *is* the target, and its address lives in the
 * community inventory where the manager maintains it.
 */
export function unitTargets(
  participations: ReadonlyArray<{ unitId: string | null; userId: string | null }>,
): UnitTarget[] {
  const seen = new Set<string>();
  const targets: UnitTarget[] = [];
  for (const participation of participations) {
    if (!participation.unitId || seen.has(participation.unitId)) continue;
    seen.add(participation.unitId);
    targets.push({ kind: "unit", unitId: participation.unitId, userId: participation.userId });
  }
  return targets;
}

/**
 * Neighbourhood targets: one per joined homeowner, with their address frozen.
 *
 * A participant with no address, or with an address Bundleen has not resolved
 * to coordinates, is *not* silently dropped — it is reported, so the manager
 * can be told exactly which homes to fix instead of discovering a short award
 * afterwards.
 */
export async function homeownerTargets(
  participations: ReadonlyArray<{ userId: string | null }>,
): Promise<TargetResolution> {
  const userIds = [
    ...new Set(
      participations
        .map((participation) => participation.userId)
        .filter((userId): userId is string => userId !== null),
    ),
  ];
  if (userIds.length === 0) return { ok: true, targets: [] };

  const users = await db.user.findMany({
    where: { id: { in: userIds } },
    select: {
      id: true,
      fullName: true,
      address: true,
      latitude: true,
      longitude: true,
    },
  });
  const byId = new Map(users.map((user) => [user.id, user]));

  const targets: HomeownerTarget[] = [];
  const missing: Array<{ userId: string; displayName: string }> = [];

  for (const userId of userIds) {
    const user = byId.get(userId);
    const address = user?.address?.trim() ?? "";
    if (!user || !address || user.latitude == null || user.longitude == null) {
      missing.push({ userId, displayName: user?.fullName ?? "A neighbour" });
      continue;
    }
    const parts = splitProfileAddress(address);
    targets.push({
      kind: "homeowner",
      userId,
      // The label is what the provider's stop list shows. The street line is
      // the most useful identifier, and it is information the awarded provider
      // is entitled to anyway.
      label: parts.addressLine1,
      addressLine1: parts.addressLine1,
      addressLine2: null,
      locality: parts.locality,
      region: parts.region,
      postalCode: parts.postalCode,
      country: "US",
      latitude: user.latitude,
      longitude: user.longitude,
      accessNotes: null,
    });
  }

  return missing.length > 0 ? { ok: false, missing } : { ok: true, targets };
}

/** The `ServiceVisit` columns for one target. Shape depends on the kind. */
export function visitDataForTarget(target: ServiceTarget): Record<string, unknown> {
  if (target.kind === "unit") return { unitId: target.unitId };
  return {
    homeownerUserId: target.userId,
    serviceLabel: target.label,
    serviceAddressLine1: target.addressLine1,
    serviceAddressLine2: target.addressLine2,
    serviceLocality: target.locality,
    serviceRegion: target.region,
    servicePostalCode: target.postalCode,
    serviceCountry: target.country,
    serviceLatitude: target.latitude,
    serviceLongitude: target.longitude,
    serviceAccessNotes: target.accessNotes,
  };
}

/** The account to notify about one stop, when there is one. */
export function targetUserId(target: ServiceTarget): string | null {
  return target.kind === "unit" ? target.userId : target.userId;
}
