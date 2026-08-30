import { z } from "zod";

/**
 * Address input for server-side geocoding.
 *
 * Bounded on every field, because this is the one payload that reaches an
 * external, metered provider. There is deliberately no latitude, longitude, or
 * free-form "query" escape hatch: the shape is a postal address, and anything
 * that is not one is rejected before a request is ever made.
 */

export const MAX_ADDRESS_BODY_BYTES = 8 * 1024;

export const addressSearchSchema = z
  .object({
    addressLine1: z.string().trim().min(1, "Enter the street address.").max(160),
    addressLine2: z
      .union([z.string(), z.null()])
      .optional()
      .transform((value) => (value?.trim() ? value.trim().slice(0, 160) : null)),
    locality: z.string().trim().min(1, "Enter the city.").max(80),
    region: z.string().trim().min(1, "Enter the state or region.").max(80),
    postalCode: z.string().trim().min(3, "Enter the postal code.").max(12),
    country: z.string().trim().length(2, "Use a two-letter country code.").default("US"),
  })
  .strict();

export type AddressSearchInput = z.infer<typeof addressSearchSchema>;
