import { z } from "zod";

import { normalizeEmail } from "@/lib/validation/auth";

export const MAX_HOA_BODY_BYTES = 64 * 1024;
export const MAX_HOA_TITLE_LENGTH = 120;
export const MAX_HOA_DESCRIPTION_LENGTH = 2_000;
export const MAX_HOA_CATEGORY_LENGTH = 60;
export const MAX_HOA_RECURRENCE_LENGTH = 80;
export const MAX_SURVEY_QUESTION_LENGTH = 300;
export const MAX_SURVEY_OPTION_LENGTH = 120;
export const MAX_SURVEY_OPTIONS = 10;
export const MAX_UNIT_LABEL_LENGTH = 120;
export const MAX_UNITS_PER_IMPORT = 500;
export const MAX_BID_AMOUNT_CENTS = 50_000_000;
export const MAX_BID_TEXT_LENGTH = 2_000;
export const MAX_REVIEW_COMMENT_LENGTH = 2_000;
export const MAX_ACCESS_NOTES_LENGTH = 500;
export const MAX_PLANNER_STOPS = 200;

const emailField = z
  .string()
  .trim()
  .email("Enter a valid email address.")
  .max(254, "Email address is too long.")
  .transform(normalizeEmail);

const idField = z.string().trim().min(1).max(64);

const optionalDateTime = z
  .union([z.string().datetime({ offset: true }), z.null()])
  .optional();

const boundedText = (max: number) =>
  z
    .union([z.string(), z.null()])
    .optional()
    .transform((value) => {
      if (value === null || value === undefined) return null;
      const trimmed = value.trim();
      return trimmed ? trimmed.slice(0, max) : null;
    });

const latitudeField = z.number().min(-90).max(90);
const longitudeField = z.number().min(-180).max(180);

/* ── HOA profile (Bundleen admin) ────────────────────────────────────────── */

export const hoaProfileSchema = z
  .object({
    legalName: z.string().trim().min(1, "Enter the HOA's legal name.").max(160),
    displayName: boundedText(120),
    addressLine1: z.string().trim().min(1, "Enter the street address.").max(160),
    addressLine2: boundedText(160),
    locality: z.string().trim().min(1, "Enter the city.").max(80),
    region: z.string().trim().min(1, "Enter the state or region.").max(80),
    postalCode: z.string().trim().min(3, "Enter the postal code.").max(12),
    country: z.string().trim().length(2, "Use a two-letter country code.").default("US"),
    latitude: z.union([latitudeField, z.null()]).optional(),
    longitude: z.union([longitudeField, z.null()]).optional(),
    timezone: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .refine((value) => {
        try {
          new Intl.DateTimeFormat("en-US", { timeZone: value });
          return true;
        } catch {
          return false;
        }
      }, "Enter a valid IANA timezone such as America/Chicago."),
    totalHomes: z.number().int().min(1, "An HOA needs at least one home.").max(10_000),
    referenceCode: boundedText(40),
    serviceNotes: boundedText(1_000),
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.latitude == null) !== (value.longitude == null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["longitude"],
        message: "Provide both latitude and longitude, or neither.",
      });
    }
  });

export type HoaProfileInput = z.infer<typeof hoaProfileSchema>;

export const hoaOnboardingStatusSchema = z
  .object({
    onboardingStatus: z.enum([
      "draft",
      "manager_invited",
      "manager_active",
      "residents_inviting",
      "live",
      "archived",
    ]),
  })
  .strict();

export type HoaOnboardingStatusInput = z.infer<typeof hoaOnboardingStatusSchema>;

/* ── Units ───────────────────────────────────────────────────────────────── */

const unitFields = {
  label: z.string().trim().min(1, "Enter a unit label.").max(MAX_UNIT_LABEL_LENGTH),
  addressLine1: boundedText(160),
  locality: boundedText(80),
  region: boundedText(80),
  postalCode: boundedText(12),
  latitude: z.union([latitudeField, z.null()]).optional(),
  longitude: z.union([longitudeField, z.null()]).optional(),
  accessNotes: boundedText(MAX_ACCESS_NOTES_LENGTH),
};

const requireCoordinatePair = (
  value: { latitude?: number | null; longitude?: number | null },
  context: z.RefinementCtx,
) => {
  if ((value.latitude == null) !== (value.longitude == null)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["longitude"],
      message: "Provide both latitude and longitude, or neither.",
    });
  }
};

export const unitCreateSchema = z.object(unitFields).strict().superRefine(requireCoordinatePair);

export type UnitCreateInput = z.infer<typeof unitCreateSchema>;

export const unitUpdateSchema = z
  .object({
    ...unitFields,
    label: unitFields.label.optional(),
    occupancyStatus: z.enum(["vacant", "invite_pending", "occupied", "inactive"]).optional(),
  })
  .strict()
  .superRefine(requireCoordinatePair);

export type UnitUpdateInput = z.infer<typeof unitUpdateSchema>;

/**
 * Idempotent CSV import. Header row: `label,addressLine1,locality,region,postalCode,latitude,longitude`
 * (label required, everything else optional). `commit: false` returns the
 * dry-run summary without writing.
 */
export const unitImportSchema = z
  .object({
    csv: z.string().min(1, "Paste CSV content to import.").max(256 * 1024),
    commit: z.boolean().default(false),
  })
  .strict();

export type UnitImportInput = z.infer<typeof unitImportSchema>;

/* ── Invitations ─────────────────────────────────────────────────────────── */

export const hoaManagerInvitationCreateSchema = z
  .object({ email: emailField })
  .strict();

export const hoaResidentInvitationCreateSchema = z
  .object({ email: emailField, unitId: idField })
  .strict();

export type HoaResidentInvitationCreateInput = z.infer<typeof hoaResidentInvitationCreateSchema>;

/* ── Service requests ────────────────────────────────────────────────────── */

export const hoaRequestCreateSchema = z
  .object({
    title: z.string().trim().min(1, "Enter a request title.").max(MAX_HOA_TITLE_LENGTH),
    category: z.string().trim().min(1, "Enter a category.").max(MAX_HOA_CATEGORY_LENGTH),
    description: z
      .string()
      .trim()
      .min(1, "Describe the service residents will receive.")
      .max(MAX_HOA_DESCRIPTION_LENGTH),
    kind: z.enum(["compulsory_recurring", "optional_group"]),
    recurrenceLabel: boundedText(MAX_HOA_RECURRENCE_LENGTH),
    recurrenceIntervalDays: z.union([z.number().int().min(1).max(365), z.null()]).optional(),
    totalOccurrences: z.number().int().min(1).max(104).default(1),
    startDate: optionalDateTime,
    enrollmentClosesAt: optionalDateTime,
    biddingClosesAt: optionalDateTime,
    minHomes: z.union([z.number().int().min(0).max(10_000), z.null()]).optional(),
    maxHomes: z.union([z.number().int().min(1).max(10_000), z.null()]).optional(),
    publish: z.boolean().default(false),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.kind === "compulsory_recurring") {
      if (!value.recurrenceLabel) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["recurrenceLabel"],
          message: "Describe how often this compulsory service repeats.",
        });
      }
      if (!value.recurrenceIntervalDays && value.totalOccurrences > 1) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["recurrenceIntervalDays"],
          message: "Set the number of days between recurring visits.",
        });
      }
    }
    if (value.kind === "optional_group" && value.publish && !value.enrollmentClosesAt) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["enrollmentClosesAt"],
        message: "Set when resident enrollment closes.",
      });
    }
    if (value.publish && value.kind === "compulsory_recurring" && !value.biddingClosesAt) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["biddingClosesAt"],
        message: "Set the bidding deadline before publishing.",
      });
    }
    if (
      value.minHomes != null &&
      value.maxHomes != null &&
      value.maxHomes < value.minHomes
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["maxHomes"],
        message: "Maximum homes cannot be below the minimum.",
      });
    }
  });

export type HoaRequestCreateInput = z.infer<typeof hoaRequestCreateSchema>;

/**
 * Manager-driven lifecycle transitions. Awarding is a separate endpoint, and
 * `scheduled`/`in_progress` transitions belong to the provider's plan/visits.
 */
export const hoaRequestTransitionSchema = z
  .object({
    action: z.enum([
      "publish",
      "open_bidding",
      "close_bidding",
      "complete",
      "cancel",
    ]),
    biddingClosesAt: optionalDateTime,
  })
  .strict();

export type HoaRequestTransitionInput = z.infer<typeof hoaRequestTransitionSchema>;

export const participationResponseSchema = z
  .object({ response: z.enum(["joined", "declined"]) })
  .strict();

export type ParticipationResponseInput = z.infer<typeof participationResponseSchema>;

/* ── Surveys ─────────────────────────────────────────────────────────────── */

export const hoaSurveyCreateSchema = z
  .object({
    monthKey: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Choose a valid survey month."),
    question: z
      .string()
      .trim()
      .min(1, "Enter a survey question.")
      .max(MAX_SURVEY_QUESTION_LENGTH),
    options: z
      .array(z.string().trim().min(1, "Survey options cannot be blank.").max(MAX_SURVEY_OPTION_LENGTH))
      .min(2, "Add at least two options.")
      .max(MAX_SURVEY_OPTIONS, `Add no more than ${MAX_SURVEY_OPTIONS} options.`)
      .refine(
        (options) => new Set(options.map((option) => option.toLowerCase())).size === options.length,
        "Survey options must be different.",
      ),
    status: z.enum(["draft", "open"]).default("open"),
    closesAt: optionalDateTime,
  })
  .strict();

export type HoaSurveyCreateInput = z.infer<typeof hoaSurveyCreateSchema>;

export const hoaSurveyStatusSchema = z
  .object({ status: z.enum(["open", "closed"]) })
  .strict();

export type HoaSurveyStatusInput = z.infer<typeof hoaSurveyStatusSchema>;

export const hoaSurveyVoteSchema = z
  .object({ optionIndex: z.number().int().min(0).max(MAX_SURVEY_OPTIONS - 1) })
  .strict();

export type HoaSurveyVoteInput = z.infer<typeof hoaSurveyVoteSchema>;

/* ── Provider coverage ───────────────────────────────────────────────────── */

export const serviceAreaSchema = z
  .object({
    label: z.string().trim().min(1, "Name this service area.").max(120),
    centerLatitude: z.union([latitudeField, z.null()]).optional(),
    centerLongitude: z.union([longitudeField, z.null()]).optional(),
    radiusMiles: z.union([z.number().positive().max(200), z.null()]).optional(),
    postalCodes: z
      .array(z.string().trim().min(3).max(12))
      .max(50)
      .default([]),
  })
  .strict()
  .superRefine((value, context) => {
    const hasCenter =
      value.centerLatitude != null && value.centerLongitude != null && value.radiusMiles != null;
    const centerPartsSet = [
      value.centerLatitude != null,
      value.centerLongitude != null,
      value.radiusMiles != null,
    ].filter(Boolean).length;
    if (centerPartsSet > 0 && centerPartsSet < 3) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["radiusMiles"],
        message: "A circle needs latitude, longitude, and a radius together.",
      });
    }
    if (!hasCenter && value.postalCodes.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["postalCodes"],
        message: "Add a coverage circle or at least one postal code.",
      });
    }
  });

export type ServiceAreaInput = z.infer<typeof serviceAreaSchema>;

/* ── Bids ────────────────────────────────────────────────────────────────── */

export const bidSubmitSchema = z
  .object({
    amountCents: z.number().int().min(0).max(MAX_BID_AMOUNT_CENTS),
    pricingBasis: z.enum(["total", "per_home", "per_visit"]),
    perHomeCents: z
      .union([z.number().int().min(0).max(MAX_BID_AMOUNT_CENTS), z.null()])
      .optional(),
    proposedStartDate: optionalDateTime,
    estimatedDurationLabel: boundedText(120),
    scope: z.string().trim().min(1, "Describe the work included.").max(MAX_BID_TEXT_LENGTH),
    exclusions: boundedText(MAX_BID_TEXT_LENGTH),
    cadenceLabel: boundedText(MAX_HOA_RECURRENCE_LENGTH),
    validUntil: optionalDateTime,
  })
  .strict();

export type BidSubmitInput = z.infer<typeof bidSubmitSchema>;

export const awardSchema = z.object({ bidId: idField }).strict();

export type AwardInput = z.infer<typeof awardSchema>;

/* ── Day planner and visits ──────────────────────────────────────────────── */

const timeField = z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/, "Use 24-hour HH:MM time.");

export const dayPlanSchema = z
  .object({
    stops: z
      .array(
        z
          .object({
            visitId: idField,
            stopRank: z.number().int().min(1).max(MAX_PLANNER_STOPS),
            windowStart: z.union([timeField, z.null()]).optional(),
            windowEnd: z.union([timeField, z.null()]).optional(),
            estimatedMinutes: z.union([z.number().int().min(1).max(1440), z.null()]).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(MAX_PLANNER_STOPS)
      .refine(
        (stops) => new Set(stops.map((stop) => stop.stopRank)).size === stops.length,
        "Each stop needs a distinct order.",
      )
      .refine(
        (stops) => new Set(stops.map((stop) => stop.visitId)).size === stops.length,
        "Each visit may appear only once.",
      ),
    publish: z.boolean().default(false),
  })
  .strict();

export type DayPlanInput = z.infer<typeof dayPlanSchema>;

export const visitStatusSchema = z
  .object({
    status: z.enum(["en_route", "in_progress", "completed", "skipped", "blocked"]),
    completionNote: boundedText(1_000),
  })
  .strict();

export type VisitStatusInput = z.infer<typeof visitStatusSchema>;

/* ── Reviews ─────────────────────────────────────────────────────────────── */

export const reviewCreateSchema = z
  .object({
    rating: z.number().int().min(1).max(5),
    comment: z.string().trim().min(1, "Write a short review.").max(MAX_REVIEW_COMMENT_LENGTH),
  })
  .strict();

export type ReviewCreateInput = z.infer<typeof reviewCreateSchema>;

export const emptyMutationSchema = z.object({}).strict();
