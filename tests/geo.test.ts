import { describe, expect, it } from "vitest";

import {
  distanceMiles,
  isWithinCommunity,
  matchNeighborhood,
  roundDistanceMiles,
  type NeighborhoodCandidate,
} from "@/lib/geo";

const SAN_FRANCISCO = { latitude: 37.7749, longitude: -122.4194 };
const OAKLAND = { latitude: 37.8044, longitude: -122.2712 };

describe("distanceMiles", () => {
  it("is zero for the same point", () => {
    expect(distanceMiles(SAN_FRANCISCO, SAN_FRANCISCO)).toBe(0);
  });

  it("matches the known San Francisco to Oakland distance", () => {
    // ~8.3 statute miles great-circle.
    expect(distanceMiles(SAN_FRANCISCO, OAKLAND)).toBeCloseTo(8.3, 1);
  });

  it("is symmetric", () => {
    expect(distanceMiles(SAN_FRANCISCO, OAKLAND)).toBeCloseTo(
      distanceMiles(OAKLAND, SAN_FRANCISCO),
      10,
    );
  });

  it("handles antipodal points without NaN from floating-point drift", () => {
    const north = { latitude: 90, longitude: 0 };
    const south = { latitude: -90, longitude: 0 };
    expect(Number.isFinite(distanceMiles(north, south))).toBe(true);
    expect(distanceMiles(north, south)).toBeCloseTo(12_437, 0);
  });

  it("crosses the antimeridian by the short way", () => {
    const west = { latitude: 0, longitude: 179.5 };
    const east = { latitude: 0, longitude: -179.5 };
    expect(distanceMiles(west, east)).toBeCloseTo(69, 0);
  });
});

describe("roundDistanceMiles", () => {
  it("keeps one decimal place", () => {
    expect(roundDistanceMiles(1.2345)).toBe(1.2);
    expect(roundDistanceMiles(1.26)).toBe(1.3);
  });
});

describe("matchNeighborhood", () => {
  const near: NeighborhoodCandidate = {
    id: "b-near",
    centerLatitude: 37.78,
    centerLongitude: -122.42,
    radiusMiles: 4,
  };
  const far: NeighborhoodCandidate = {
    id: "a-far",
    centerLatitude: 37.8,
    centerLongitude: -122.44,
    radiusMiles: 10,
  };

  it("returns null when nothing contains the home", () => {
    expect(matchNeighborhood(OAKLAND, [near])).toBeNull();
  });

  it("returns null when there are no candidates", () => {
    expect(matchNeighborhood(SAN_FRANCISCO, [])).toBeNull();
  });

  it("prefers the nearest centre when radii overlap", () => {
    expect(matchNeighborhood(SAN_FRANCISCO, [far, near])?.communityId).toBe("b-near");
    // Order of the candidate list must not change the answer.
    expect(matchNeighborhood(SAN_FRANCISCO, [near, far])?.communityId).toBe("b-near");
  });

  it("breaks an exact distance tie on the lower id, deterministically", () => {
    const east: NeighborhoodCandidate = {
      id: "z",
      centerLatitude: SAN_FRANCISCO.latitude,
      centerLongitude: SAN_FRANCISCO.longitude + 0.01,
      radiusMiles: 4,
    };
    const west: NeighborhoodCandidate = {
      id: "a",
      centerLatitude: SAN_FRANCISCO.latitude,
      centerLongitude: SAN_FRANCISCO.longitude - 0.01,
      radiusMiles: 4,
    };

    expect(matchNeighborhood(SAN_FRANCISCO, [east, west])?.communityId).toBe("a");
    expect(matchNeighborhood(SAN_FRANCISCO, [west, east])?.communityId).toBe("a");
  });

  it("skips candidates with no geometry, such as an HOA", () => {
    const hoa: NeighborhoodCandidate = {
      id: "hoa",
      centerLatitude: null,
      centerLongitude: null,
      radiusMiles: null,
    };
    expect(matchNeighborhood(SAN_FRANCISCO, [hoa])).toBeNull();
    expect(matchNeighborhood(SAN_FRANCISCO, [hoa, near])?.communityId).toBe("b-near");
  });

  it("includes a home exactly on the boundary", () => {
    const exact: NeighborhoodCandidate = {
      id: "exact",
      centerLatitude: SAN_FRANCISCO.latitude,
      centerLongitude: SAN_FRANCISCO.longitude,
      radiusMiles: distanceMiles(SAN_FRANCISCO, OAKLAND),
    };
    expect(matchNeighborhood(OAKLAND, [exact])?.communityId).toBe("exact");
  });
});

describe("isWithinCommunity", () => {
  const community: NeighborhoodCandidate = {
    id: "c",
    centerLatitude: 37.78,
    centerLongitude: -122.42,
    radiusMiles: 4,
  };

  it("reports inside with a rounded distance", () => {
    const result = isWithinCommunity(SAN_FRANCISCO, community);
    expect(result.isWithinRadius).toBe(true);
    expect(result.distanceMi).toBeLessThan(1);
  });

  it("reports outside without hiding the distance", () => {
    const result = isWithinCommunity(OAKLAND, community);
    expect(result.isWithinRadius).toBe(false);
    expect(result.distanceMi).toBeGreaterThan(4);
  });

  it("answers unknown, not outside, when the home has no coordinates", () => {
    expect(isWithinCommunity(null, community)).toEqual({
      isWithinRadius: null,
      distanceMi: null,
    });
  });

  it("answers unknown for a community with no geometry", () => {
    expect(
      isWithinCommunity(SAN_FRANCISCO, {
        id: "hoa",
        centerLatitude: null,
        centerLongitude: null,
        radiusMiles: null,
      }),
    ).toEqual({ isWithinRadius: null, distanceMi: null });
  });

  it("reports a distance but no verdict when a centre has no radius", () => {
    const result = isWithinCommunity(SAN_FRANCISCO, { ...community, radiusMiles: null });
    expect(result.distanceMi).not.toBeNull();
    expect(result.isWithinRadius).toBeNull();
  });
});
