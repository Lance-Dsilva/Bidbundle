import { z } from "zod";

import {
  MAX_SERVICE_AREA_ADDRESS_LENGTH,
  MAX_SERVICE_AREA_LABEL_LENGTH,
  SERVICE_RADIUS_MAX_MILES,
  SERVICE_RADIUS_MIN_MILES,
  normalizeRadiusMiles,
} from "@/lib/provider-coverage";

/**
 * The allow-list for a provider-drawn coverage circle.
 *
 * Unlike the older `serviceAreaSchema` (which also accepted a postal-code-only
 * area and a 200-mile radius), this schema is what the map editor writes: a
 * complete circle inside the single encoded product range. Radius bounds come
 * from `lib/provider-coverage.ts` so the slider, the schema, and the database
 * CHECK constraint cannot drift apart.
 *
 * `status`, `providerUserId`, and the audit trail are absent on purpose —
 * ownership is derived from the Clerk session on the server, never from a body.
 */

export const MAX_PROVIDER_COVERAGE_BODY_BYTES = 8 * 1024;

const latitudeField = z
  .number()
  .refine((value) => Number.isFinite(value) && value >= -90 && value <= 90, {
    message: "Pick a point on the map to set your service center.",
  });

const longitudeField = z
  .number()
  .refine((value) => Number.isFinite(value) && value >= -180 && value <= 180, {
    message: "Pick a point on the map to set your service center.",
  });

/** Trimmed optional text where `""`/`null` both mean "no value stored". */
function optionalPlaceText(max: number) {
  return z
    .union([z.string(), z.null()])
    .optional()
    .transform((value) => {
      if (value === null || value === undefined) return null;
      const trimmed = value.trim();
      return trimmed.length === 0 ? null : trimmed.slice(0, max);
    });
}

export const providerServiceAreaSchema = z
  .object({
    label: z
      .string()
      .trim()
      .min(1, "Name this service area.")
      .max(MAX_SERVICE_AREA_LABEL_LENGTH, "That name is too long."),
    centerLatitude: latitudeField,
    centerLongitude: longitudeField,
    radiusMiles: z
      .number()
      .min(SERVICE_RADIUS_MIN_MILES, `Use at least ${SERVICE_RADIUS_MIN_MILES} mile.`)
      .max(SERVICE_RADIUS_MAX_MILES, `Use at most ${SERVICE_RADIUS_MAX_MILES} miles.`)
      .transform(normalizeRadiusMiles),
    formattedAddress: optionalPlaceText(MAX_SERVICE_AREA_ADDRESS_LENGTH),
    locality: optionalPlaceText(120),
    region: optionalPlaceText(120),
    postalCode: optionalPlaceText(12),
    countryCode: optionalPlaceText(60),
    /**
     * Requests promotion to primary. Demoting the current primary is the
     * server's job — a provider always has exactly one while any area is
     * active, so this is never used to *clear* the flag.
     */
    isPrimary: z.boolean().optional(),
  })
  .strict();

export type ProviderServiceAreaInput = z.infer<typeof providerServiceAreaSchema>;

/**
 * Onboarding's copy of the same circle, embedded in the profile-completion
 * body. Identical rules; kept separate so the profile route's error map can
 * report `providerCoverage` as one field.
 */
export const onboardingCoverageSchema = providerServiceAreaSchema;
