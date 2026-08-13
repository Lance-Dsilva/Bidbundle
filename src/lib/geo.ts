/**
 * Distance and neighborhood matching.
 *
 * Deliberately dependency-free and free of `server-only` so the same
 * implementation can be unit tested directly, but nothing in the browser is
 * permitted to *use* a result from here to make an authorization decision: the
 * server recomputes every distance and every eligibility verdict from stored
 * coordinates, and ignores any distance a request supplies.
 */

export type Coordinates = {
  latitude: number;
  longitude: number;
};

/** Mean Earth radius in miles. */
const EARTH_RADIUS_MI = 3958.7613;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/**
 * Great-circle distance in miles.
 *
 * Haversine rather than the equirectangular approximation: the approximation
 * drifts at high latitudes, and a community boundary is exactly the place a
 * few hundred metres decides whether someone is a member.
 */
export function distanceMiles(from: Coordinates, to: Coordinates): number {
  const deltaLatitude = toRadians(to.latitude - from.latitude);
  const deltaLongitude = toRadians(to.longitude - from.longitude);

  const a =
    Math.sin(deltaLatitude / 2) ** 2 +
    Math.cos(toRadians(from.latitude)) *
      Math.cos(toRadians(to.latitude)) *
      Math.sin(deltaLongitude / 2) ** 2;

  return 2 * EARTH_RADIUS_MI * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Rounds to a tenth of a mile — precise enough to judge, too coarse to locate. */
export function roundDistanceMiles(distance: number): number {
  return Math.round(distance * 10) / 10;
}

export type NeighborhoodCandidate = {
  id: string;
  centerLatitude: number | null;
  centerLongitude: number | null;
  radiusMiles: number | null;
};

export type NeighborhoodMatch = {
  communityId: string;
  distanceMi: number;
};

/**
 * Picks the one neighborhood community a homeowner belongs to.
 *
 * Radii overlap in practice, so the tie-break is defined rather than left to
 * whatever order the database returned rows in: nearest centre wins, and an
 * exact distance tie falls back to the lower community id. The same inputs
 * therefore always produce the same community, which matters because this
 * decision is re-run on every address change.
 *
 * Candidates missing a centre or radius are skipped rather than treated as
 * infinite — an HOA has no geometry and must never be matched this way.
 */
export function matchNeighborhood(
  home: Coordinates,
  candidates: readonly NeighborhoodCandidate[],
): NeighborhoodMatch | null {
  let best: NeighborhoodMatch | null = null;

  for (const candidate of candidates) {
    const { centerLatitude, centerLongitude, radiusMiles } = candidate;
    if (centerLatitude === null || centerLongitude === null || radiusMiles === null) {
      continue;
    }

    const distance = distanceMiles(home, {
      latitude: centerLatitude,
      longitude: centerLongitude,
    });
    if (distance > radiusMiles) continue;

    if (
      best === null ||
      distance < best.distanceMi ||
      (distance === best.distanceMi && candidate.id < best.communityId)
    ) {
      best = { communityId: candidate.id, distanceMi: distance };
    }
  }

  return best;
}

/**
 * Whether a home falls inside a community's boundary.
 *
 * `null` when the answer is unknown — the home has no stored coordinates, or
 * the community has no geometry (every HOA). Unknown is not "outside": an HOA
 * resident is a resident regardless of where the map puts them.
 */
export function isWithinCommunity(
  home: Coordinates | null,
  community: NeighborhoodCandidate,
): { isWithinRadius: boolean | null; distanceMi: number | null } {
  const { centerLatitude, centerLongitude, radiusMiles } = community;

  if (home === null || centerLatitude === null || centerLongitude === null) {
    return { isWithinRadius: null, distanceMi: null };
  }

  const distance = distanceMiles(home, {
    latitude: centerLatitude,
    longitude: centerLongitude,
  });

  return {
    distanceMi: roundDistanceMiles(distance),
    isWithinRadius: radiusMiles === null ? null : distance <= radiusMiles,
  };
}
