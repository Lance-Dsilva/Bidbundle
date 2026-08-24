/**
 * Provider coverage: the one place the service-radius numbers are defined.
 *
 * Deliberately free of `server-only` and of any Prisma/Leaflet import so the
 * onboarding step, the profile editor, the Zod schema, and the server matcher
 * all read the same constants. Nothing in the browser is permitted to *decide*
 * eligibility with these — the server recomputes every verdict from stored
 * coordinates (see `lib/server/provider-coverage.ts`).
 *
 * This coverage circle is entirely separate from `COMMUNITY_RADIUS_MI`, the
 * fixed 4-mile radius used to group non-HOA homeowners into a neighborhood.
 * A provider chooses how far they will travel; a homeowner never chooses how
 * their community is drawn.
 */

/**
 * Product limits, encoded once.
 *
 * The earlier `serviceAreaSchema` accepted up to 200 miles, which was a
 * placeholder rather than a decision: a 200-mile circle covers most of a state
 * and makes the "requests near you" promise meaningless. 100 miles is the
 * widest genuine service territory a residential trade operates, so that is
 * the ceiling both the UI slider and the API enforce.
 */
export const SERVICE_RADIUS_MIN_MILES = 1;
export const SERVICE_RADIUS_MAX_MILES = 100;
export const SERVICE_RADIUS_DEFAULT_MILES = 15;
/** Slider/stepper granularity. Radii are stored to a tenth of a mile. */
export const SERVICE_RADIUS_STEP_MILES = 1;

/** Server-side ceiling on simultaneously active areas for one provider. */
export const MAX_ACTIVE_SERVICE_AREAS = 10;

export const MAX_SERVICE_AREA_LABEL_LENGTH = 120;
export const MAX_SERVICE_AREA_ADDRESS_LENGTH = 200;

/** Rounds a radius to the stored precision, one decimal place. */
export function normalizeRadiusMiles(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Clamps a candidate radius into the product range without throwing. */
export function clampRadiusMiles(value: number): number {
  if (!Number.isFinite(value)) return SERVICE_RADIUS_DEFAULT_MILES;
  return normalizeRadiusMiles(
    Math.min(SERVICE_RADIUS_MAX_MILES, Math.max(SERVICE_RADIUS_MIN_MILES, value)),
  );
}

export function isRadiusInRange(value: number): boolean {
  return (
    Number.isFinite(value) &&
    value >= SERVICE_RADIUS_MIN_MILES &&
    value <= SERVICE_RADIUS_MAX_MILES
  );
}

/**
 * The saved address context for one coverage circle.
 *
 * Held so the editor can redraw the provider's own selection later without a
 * second geocoding round trip. `formattedAddress` is the provider's business
 * base, which is private operational data — see `serializeServiceArea` in
 * `lib/server/provider-coverage.ts` for what leaves the server.
 */
export type ServiceAreaPlace = {
  formattedAddress: string | null;
  locality: string | null;
  region: string | null;
  postalCode: string | null;
  countryCode: string | null;
};

/**
 * The plain-language sentence shown under the map, e.g.
 * `Serving within 15 miles of North Austin, TX`.
 *
 * Falls back through locality/region to the full formatted address, and then
 * to the area's own label, so the summary is never a bare number.
 */
export function coverageSummary(input: {
  radiusMiles: number;
  place?: Partial<ServiceAreaPlace> | null;
  label?: string | null;
}): string {
  const radius = normalizeRadiusMiles(input.radiusMiles);
  const unit = radius === 1 ? "mile" : "miles";
  const place = input.place ?? {};
  const locality = [place.locality, place.region].filter(Boolean).join(", ");
  const where = locality || place.formattedAddress?.trim() || input.label?.trim() || "";
  return where
    ? `Serving within ${radius} ${unit} of ${where}`
    : `Serving within ${radius} ${unit} of your selected center`;
}

/** Short label for a list row, e.g. `North Austin, TX · 15 mi`. */
export function coverageListLabel(input: {
  radiusMiles: number;
  place?: Partial<ServiceAreaPlace> | null;
}): string {
  const radius = normalizeRadiusMiles(input.radiusMiles);
  const place = input.place ?? {};
  const where = [place.locality, place.region].filter(Boolean).join(", ");
  return where ? `${where} · ${radius} mi` : `${radius} mi radius`;
}

/**
 * A sensible default name for a newly drawn area, derived from the place the
 * provider actually picked rather than a generic "Service area 1".
 */
export function suggestedAreaLabel(place?: Partial<ServiceAreaPlace> | null): string {
  const locality = place?.locality?.trim();
  if (locality) return locality.slice(0, MAX_SERVICE_AREA_LABEL_LENGTH);
  const formatted = place?.formattedAddress?.trim();
  if (formatted) return formatted.split(",")[0]!.slice(0, MAX_SERVICE_AREA_LABEL_LENGTH);
  return "My service area";
}
