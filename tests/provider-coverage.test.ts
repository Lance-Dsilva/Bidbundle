import { describe, expect, it } from "vitest";

import {
  SERVICE_RADIUS_DEFAULT_MILES,
  SERVICE_RADIUS_MAX_MILES,
  SERVICE_RADIUS_MIN_MILES,
  clampRadiusMiles,
  coverageListLabel,
  coverageSummary,
  isRadiusInRange,
  normalizeRadiusMiles,
  suggestedAreaLabel,
} from "@/lib/provider-coverage";
import {
  circleCoversLocation,
  coverageBoundsFilter,
  coverageCoversLocation,
} from "@/lib/server/provider-coverage";
import { providerServiceAreaSchema } from "@/lib/validation/provider-coverage";

/** Austin, TX — the same reference point the HOA market tests use. */
const AUSTIN = { latitude: 30.4021, longitude: -97.7266, postalCode: "78758" };

describe("radius constants", () => {
  it("keeps the default inside the product range", () => {
    expect(SERVICE_RADIUS_DEFAULT_MILES).toBeGreaterThanOrEqual(SERVICE_RADIUS_MIN_MILES);
    expect(SERVICE_RADIUS_DEFAULT_MILES).toBeLessThanOrEqual(SERVICE_RADIUS_MAX_MILES);
  });

  it("clamps out-of-range and non-finite input rather than throwing", () => {
    expect(clampRadiusMiles(0)).toBe(SERVICE_RADIUS_MIN_MILES);
    expect(clampRadiusMiles(1_000)).toBe(SERVICE_RADIUS_MAX_MILES);
    expect(clampRadiusMiles(Number.NaN)).toBe(SERVICE_RADIUS_DEFAULT_MILES);
    expect(clampRadiusMiles(12.34)).toBe(12.3);
  });

  it("rounds to the stored tenth-of-a-mile precision", () => {
    expect(normalizeRadiusMiles(15.049)).toBe(15);
    expect(normalizeRadiusMiles(15.06)).toBe(15.1);
  });

  it.each([
    [SERVICE_RADIUS_MIN_MILES, true],
    [SERVICE_RADIUS_MAX_MILES, true],
    [SERVICE_RADIUS_MIN_MILES - 0.1, false],
    [SERVICE_RADIUS_MAX_MILES + 0.1, false],
  ])("range check for %s is %s", (value, expected) => {
    expect(isRadiusInRange(value)).toBe(expected);
  });
});

describe("coverage summary copy", () => {
  it("names the locality and region when both are known", () => {
    expect(
      coverageSummary({
        radiusMiles: 15,
        place: { locality: "North Austin", region: "TX" },
      }),
    ).toBe("Serving within 15 miles of North Austin, TX");
  });

  it("uses the singular unit at one mile", () => {
    expect(coverageSummary({ radiusMiles: 1, place: { locality: "Austin" } })).toBe(
      "Serving within 1 mile of Austin",
    );
  });

  it("falls back through formatted address and label before a generic phrase", () => {
    expect(coverageSummary({ radiusMiles: 5, place: { formattedAddress: "1 Main St, Austin" } })).toContain(
      "1 Main St, Austin",
    );
    expect(coverageSummary({ radiusMiles: 5, label: "My patch" })).toContain("My patch");
    expect(coverageSummary({ radiusMiles: 5 })).toBe(
      "Serving within 5 miles of your selected center",
    );
  });

  it("builds a compact list label", () => {
    expect(coverageListLabel({ radiusMiles: 20, place: { locality: "Austin", region: "TX" } })).toBe(
      "Austin, TX · 20 mi",
    );
    expect(coverageListLabel({ radiusMiles: 20 })).toBe("20 mi radius");
  });

  it("suggests a name from the place rather than a numbered placeholder", () => {
    expect(suggestedAreaLabel({ locality: "North Austin" })).toBe("North Austin");
    expect(suggestedAreaLabel({ formattedAddress: "1 Main St, Austin, TX" })).toBe("1 Main St");
    expect(suggestedAreaLabel(null)).toBe("My service area");
  });
});

describe("providerServiceAreaSchema", () => {
  const valid = {
    label: "North Austin",
    centerLatitude: 30.4021,
    centerLongitude: -97.7266,
    radiusMiles: 15,
  };

  it("accepts a complete circle", () => {
    const result = providerServiceAreaSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it("requires a complete circle — no half-defined geometry", () => {
    expect(providerServiceAreaSchema.safeParse({ ...valid, centerLatitude: undefined }).success).toBe(
      false,
    );
    expect(providerServiceAreaSchema.safeParse({ ...valid, radiusMiles: undefined }).success).toBe(
      false,
    );
  });

  it("rejects out-of-range coordinates and radii", () => {
    expect(providerServiceAreaSchema.safeParse({ ...valid, centerLatitude: 91 }).success).toBe(false);
    expect(providerServiceAreaSchema.safeParse({ ...valid, centerLongitude: -181 }).success).toBe(
      false,
    );
    expect(
      providerServiceAreaSchema.safeParse({ ...valid, radiusMiles: SERVICE_RADIUS_MAX_MILES + 1 })
        .success,
    ).toBe(false);
  });

  it("normalizes the radius to a tenth of a mile", () => {
    const result = providerServiceAreaSchema.safeParse({ ...valid, radiusMiles: 15.06 });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.radiusMiles).toBe(15.1);
  });

  it("treats blank address context as absent rather than empty strings", () => {
    const result = providerServiceAreaSchema.safeParse({ ...valid, locality: "   ", region: null });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.locality).toBeNull();
      expect(result.data.region).toBeNull();
    }
  });

  it("refuses unknown fields, including a forged owner id", () => {
    expect(
      providerServiceAreaSchema.safeParse({ ...valid, providerUserId: "someone-else" }).success,
    ).toBe(false);
    expect(providerServiceAreaSchema.safeParse({ ...valid, status: "active" }).success).toBe(false);
  });
});

describe("circleCoversLocation", () => {
  const circle = { centerLatitude: 30.45, centerLongitude: -97.7, radiusMiles: 10 };

  it("covers a point inside the circle", () => {
    expect(circleCoversLocation(circle, AUSTIN).covered).toBe(true);
  });

  it("rejects a point outside the circle", () => {
    // San Antonio, ~75 miles away.
    expect(
      circleCoversLocation(circle, { latitude: 29.42, longitude: -98.49 }).covered,
    ).toBe(false);
  });

  it("includes a point exactly on the boundary", () => {
    // One degree of latitude is ~69.05 miles; 10 miles is ~0.14484 degrees.
    const boundary = {
      latitude: circle.centerLatitude + 10 / 69.0546,
      longitude: circle.centerLongitude,
    };
    expect(circleCoversLocation(circle, boundary).covered).toBe(true);
  });

  it("returns unknown — never zero distance — when the target has no coordinates", () => {
    const verdict = circleCoversLocation(circle, { latitude: null, longitude: null });
    expect(verdict.covered).toBeNull();
    expect(verdict.distanceMi).toBeNull();
  });

  it("returns unknown when the provider area has no circle", () => {
    const verdict = circleCoversLocation(
      { centerLatitude: null, centerLongitude: null, radiusMiles: null },
      AUSTIN,
    );
    expect(verdict.covered).toBeNull();
  });

  it("still matches a legacy postal-code-only area", () => {
    const verdict = circleCoversLocation(
      { centerLatitude: null, centerLongitude: null, radiusMiles: null, postalCodes: ["78758"] },
      AUSTIN,
    );
    expect(verdict.covered).toBe(true);
  });

  it("matches postal codes case-insensitively and rejects a different one", () => {
    const area = {
      centerLatitude: null,
      centerLongitude: null,
      radiusMiles: null,
      postalCodes: ["ab1 2cd"],
    };
    expect(circleCoversLocation(area, { latitude: null, longitude: null, postalCode: "AB1 2CD" }).covered).toBe(
      true,
    );
    expect(circleCoversLocation(area, { latitude: null, longitude: null, postalCode: "XY9" }).covered).toBe(
      null,
    );
  });

  it("works at the maximum radius", () => {
    expect(
      circleCoversLocation(
        { centerLatitude: 30.45, centerLongitude: -97.7, radiusMiles: SERVICE_RADIUS_MAX_MILES },
        { latitude: 29.42, longitude: -98.49 },
      ).covered,
    ).toBe(true);
  });
});

describe("coverageCoversLocation", () => {
  const near = { centerLatitude: 30.45, centerLongitude: -97.7, radiusMiles: 10 };
  const far = { centerLatitude: 29.42, centerLongitude: -98.49, radiusMiles: 5 };

  it("is covered when any one area covers the point", () => {
    expect(coverageCoversLocation([far, near], AUSTIN).covered).toBe(true);
  });

  it("is not covered when every area misses", () => {
    expect(coverageCoversLocation([far], AUSTIN).covered).toBe(false);
  });

  it("reports no coverage for a provider with no areas at all", () => {
    expect(coverageCoversLocation([], AUSTIN).covered).toBe(false);
  });

  it("reports the distance to the covering area", () => {
    const verdict = coverageCoversLocation([near], AUSTIN);
    expect(verdict.covered).toBe(true);
    expect(verdict.distanceMi).toBeGreaterThan(0);
    expect(verdict.distanceMi).toBeLessThanOrEqual(10);
  });

  it("stays unknown when the point has no coordinates", () => {
    expect(
      coverageCoversLocation([near, far], { latitude: null, longitude: null }).covered,
    ).toBeNull();
  });
});

describe("coverageBoundsFilter", () => {
  it("builds a rectangle that contains the circle", () => {
    const filter = coverageBoundsFilter({
      latitude: 30.4021,
      longitude: -97.7266,
      maxRadiusMiles: SERVICE_RADIUS_MAX_MILES,
    });
    expect(filter.centerLatitude.gte).toBeLessThan(30.4021);
    expect(filter.centerLatitude.lte).toBeGreaterThan(30.4021);
    expect(filter.OR.length).toBeGreaterThanOrEqual(1);
  });
});
