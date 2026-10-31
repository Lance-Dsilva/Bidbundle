import { z } from "zod";

/** Advisory only: these coordinates never authorize or assign membership. */
export const onboardingCoverageSchema = z.object({
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
}).strict();

export const onboardingCoverageResponseSchema = z.object({
  coverage: z.enum(["available", "unavailable"]),
}).strict();

export type OnboardingCoverageInput = z.infer<typeof onboardingCoverageSchema>;
export type CoverageStatus = z.infer<typeof onboardingCoverageResponseSchema>["coverage"];
export const MAX_COVERAGE_BODY_BYTES = 2 * 1024;
