import { z } from "zod";

import { MAX_NAME_LENGTH, MAX_PHONE_LENGTH, PUBLIC_ROLES } from "@/lib/validation/auth";

/**
 * Profile validation.
 *
 * These schemas are the allow-list for everything a signed-in user may write
 * about themselves. A field that is absent here cannot be changed through the
 * API no matter what the request body contains, which is how `email`, `role`,
 * `isVerified`, license/insurance verification, and payout status stay under
 * server control.
 */

/** Maximum accepted JSON body for the profile routes, in bytes. */
export const MAX_PROFILE_BODY_BYTES = 16 * 1024;

export const MAX_ADDRESS_LENGTH = 200;
export const MAX_NEIGHBORHOOD_LENGTH = 80;
export const MAX_COMPANY_NAME_LENGTH = 120;
export const MAX_BIO_LENGTH = 1_000;
export const MAX_TRADE_LENGTH = 40;
export const MAX_TRADES = 12;
export const MAX_LICENSE_NUMBER_LENGTH = 60;
export const MAX_LICENSE_STATE_LENGTH = 40;
export const MAX_INSURANCE_PROVIDER_LENGTH = 120;
export const MAX_INSURANCE_POLICY_LENGTH = 60;

export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export const PAYOUT_STATUSES = ["not_connected", "pending", "active", "restricted"] as const;
export type PayoutStatus = (typeof PAYOUT_STATUSES)[number];

/**
 * The community radius, in miles.
 *
 * Deliberately a constant rather than a field: grouping neighbours by a uniform
 * proximity is the product, so no schema below accepts a radius from a client.
 */
export const COMMUNITY_RADIUS_MI = 4;

/** Accepted avatar image types and size ceiling, shared by client and route. */
export const ALLOWED_AVATAR_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const MAX_AVATAR_BYTES = 4 * 1024 * 1024;

/* ── Reusable field builders ─────────────────────────────────────────────── */

/**
 * A trimmed optional string that treats `""` and `null` as "clear this field".
 *
 * Forms send empty strings for untouched inputs, and a user clearing their
 * company name must end up with `NULL` rather than an empty string that later
 * renders as a blank line where a fallback belongs.
 */
function optionalText(max: number, tooLong: string) {
  return z
    .union([z.string(), z.null()])
    .transform((value) => {
      if (value === null) return null;
      const trimmed = value.trim();
      return trimmed.length === 0 ? null : trimmed;
    })
    .refine((value) => value === null || value.length <= max, { message: tooLong });
}

const phoneField = z
  .union([z.string(), z.null()])
  .transform((value) => {
    if (value === null) return null;
    const trimmed = value.trim();
    return trimmed.length === 0 ? null : trimmed;
  })
  .refine((value) => value === null || value.length <= MAX_PHONE_LENGTH, {
    message: "Phone number is too long.",
  })
  .refine((value) => value === null || /^[+()\d][\d\s().-]*$/.test(value), {
    message: "Enter a valid phone number.",
  });

/** `HH:MM` on a 24-hour clock. */
const timeOfDayField = z
  .union([z.string(), z.null()])
  .transform((value) => {
    if (value === null) return null;
    const trimmed = value.trim();
    return trimmed.length === 0 ? null : trimmed;
  })
  .refine((value) => value === null || /^([01]\d|2[0-3]):[0-5]\d$/.test(value), {
    message: "Enter a time as HH:MM, for example 08:30.",
  });

const latitudeField = z
  .union([z.number(), z.null()])
  .refine((value) => value === null || (Number.isFinite(value) && value >= -90 && value <= 90), {
    message: "Latitude must be between -90 and 90.",
  });

const longitudeField = z
  .union([z.number(), z.null()])
  .refine((value) => value === null || (Number.isFinite(value) && value >= -180 && value <= 180), {
    message: "Longitude must be between -180 and 180.",
  });

/* ── Common profile (any role) ───────────────────────────────────────────── */

/**
 * Fields every signed-in user owns.
 *
 * `email` and `role` are absent on purpose: email belongs to Clerk, and letting
 * a user rewrite their own role would be a privilege escalation with extra
 * steps.
 */
export const commonProfileUpdateSchema = z
  .object({
    fullName: z
      .string()
      .trim()
      .min(1, "Enter your name.")
      .max(MAX_NAME_LENGTH, "Full name is too long."),
    phone: phoneField,
    address: optionalText(MAX_ADDRESS_LENGTH, "Address is too long."),
    neighborhood: optionalText(MAX_NEIGHBORHOOD_LENGTH, "Neighborhood name is too long."),
    latitude: latitudeField,
    longitude: longitudeField,
  })
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Send at least one field to update.",
  })
  .refine(
    (value) =>
      // A lone coordinate is not a location. Both arrive together, or both are
      // cleared together.
      !("latitude" in value || "longitude" in value) ||
      ("latitude" in value &&
        "longitude" in value &&
        (value.latitude === null) === (value.longitude === null)),
    { message: "Latitude and longitude must be provided together.", path: ["latitude"] },
  );

export type CommonProfileUpdate = z.infer<typeof commonProfileUpdateSchema>;

/* ── Homeowner profile ───────────────────────────────────────────────────── */

export const homeownerProfileUpdateSchema = z
  .object({
    notifyBids: z.boolean(),
    notifyGroups: z.boolean(),
    notifySavings: z.boolean(),
    notifyEmail: z.boolean(),
    notifyPush: z.boolean(),
  })
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Send at least one field to update.",
  });

export type HomeownerProfileUpdate = z.infer<typeof homeownerProfileUpdateSchema>;

/* ── Provider profile ────────────────────────────────────────────────────── */

const tradesField = z
  .array(z.string().trim().min(1, "Trades cannot be blank.").max(MAX_TRADE_LENGTH, "Trade name is too long."))
  .max(MAX_TRADES, `Choose at most ${MAX_TRADES} trades.`)
  // Case-insensitive de-duplication, first spelling wins.
  .transform((values) => {
    const seen = new Set<string>();
    return values.filter((value) => {
      const key = value.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  });

const workingDaysField = z
  .array(z.enum(WEEKDAYS, { message: "Choose valid days of the week." }))
  .max(7)
  .transform((values) => WEEKDAYS.filter((day) => values.includes(day)));

/**
 * Provider-owned fields.
 *
 * `licenseVerifiedAt`, `insuranceVerifiedAt`, `payoutStatus`, and `payoutLast4`
 * are absent: a provider may state a license number, but only an admin or a
 * payment provider decides what counts as verified or paid out.
 */
export const providerProfileUpdateSchema = z
  .object({
    companyName: optionalText(MAX_COMPANY_NAME_LENGTH, "Company name is too long."),
    bio: optionalText(MAX_BIO_LENGTH, `Bio must be ${MAX_BIO_LENGTH} characters or fewer.`),
    trades: tradesField,
    workingDays: workingDaysField,
    workingHoursStart: timeOfDayField,
    workingHoursEnd: timeOfDayField,
    licenseNumber: optionalText(MAX_LICENSE_NUMBER_LENGTH, "License number is too long."),
    licenseState: optionalText(MAX_LICENSE_STATE_LENGTH, "License state is too long."),
    insuranceProvider: optionalText(MAX_INSURANCE_PROVIDER_LENGTH, "Insurer name is too long."),
    insurancePolicyNumber: optionalText(MAX_INSURANCE_POLICY_LENGTH, "Policy number is too long."),
    notifyNewJobs: z.boolean(),
    notifyMessages: z.boolean(),
    notifyPayouts: z.boolean(),
  })
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Send at least one field to update.",
  })
  .refine(
    (value) =>
      !("workingHoursStart" in value || "workingHoursEnd" in value) ||
      ("workingHoursStart" in value && "workingHoursEnd" in value),
    {
      message: "Opening and closing times must be provided together.",
      path: ["workingHoursStart"],
    },
  )
  .refine(
    (value) =>
      !(
        typeof value.workingHoursStart === "string" &&
        typeof value.workingHoursEnd === "string" &&
        value.workingHoursStart >= value.workingHoursEnd
      ),
    { message: "Closing time must be after opening time.", path: ["workingHoursEnd"] },
  );

export type ProviderProfileUpdate = z.infer<typeof providerProfileUpdateSchema>;

/** One atomic provider-settings save: common identity details plus business details. */
export const providerFullUpdateSchema = z
  .object({
    common: commonProfileUpdateSchema,
    provider: providerProfileUpdateSchema,
  })
  .strict();

export type ProviderFullUpdate = z.infer<typeof providerFullUpdateSchema>;

/* ── Onboarding ──────────────────────────────────────────────────────────── */

/**
 * Everything the "complete your profile" flow may send.
 *
 * Passwords, verification codes, and session tokens never reach here — Clerk
 * owns all three. The provider block records what the applicant *claims*; the
 * `isLicensed` / `isInsured` checkboxes the old sign-up form collected are
 * absent, because a self-asserted verification badge is worth nothing.
 */
export const onboardingProfileSchema = z.object({
  fullName: z.string().trim().max(MAX_NAME_LENGTH, "Full name is too long.").optional(),
  phone: z
    .string()
    .trim()
    .max(MAX_PHONE_LENGTH, "Phone number is too long.")
    .regex(/^[+()\d][\d\s().-]*$/, "Enter a valid phone number.")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  role: z.enum(PUBLIC_ROLES, {
    message: "Choose either the homeowner or service provider role.",
  }),
  address: optionalText(MAX_ADDRESS_LENGTH, "Address is too long.").optional(),
  neighborhood: optionalText(MAX_NEIGHBORHOOD_LENGTH, "Neighborhood name is too long.").optional(),
  latitude: latitudeField.optional(),
  longitude: longitudeField.optional(),
  providerBusiness: z
    .object({
      companyName: optionalText(MAX_COMPANY_NAME_LENGTH, "Company name is too long."),
      bio: optionalText(MAX_BIO_LENGTH, `Bio must be ${MAX_BIO_LENGTH} characters or fewer.`),
      trades: tradesField,
      licenseNumber: optionalText(MAX_LICENSE_NUMBER_LENGTH, "License number is too long."),
      insuranceProvider: optionalText(MAX_INSURANCE_PROVIDER_LENGTH, "Insurer name is too long."),
    })
    .partial()
    .strict()
    .optional(),
}).superRefine((value, context) => {
  if (!value.address) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Enter your address.",
      path: ["address"],
    });
  }

  const hasLatitude = typeof value.latitude === "number";
  const hasLongitude = typeof value.longitude === "number";
  if (hasLatitude !== hasLongitude) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Latitude and longitude must be provided together.",
      path: ["latitude"],
    });
  }

  if (value.role === "provider") {
    if (!value.neighborhood) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Enter your main service area.",
        path: ["neighborhood"],
      });
    }
    if (!value.providerBusiness?.companyName) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Enter your business name.",
        path: ["providerBusiness", "companyName"],
      });
    }
    if (!value.providerBusiness?.trades?.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Choose at least one service.",
        path: ["providerBusiness", "trades"],
      });
    }
  }
});

export type OnboardingProfileInput = z.infer<typeof onboardingProfileSchema>;

/* ── Error shaping ───────────────────────────────────────────────────────── */

/**
 * Flattens Zod issues into `{ field: message }` for inline form errors.
 *
 * Only the first issue per field survives — showing a user four complaints
 * about one input is noise.
 */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  return error.issues.reduce<Record<string, string>>((accumulator, issue) => {
    const field =
      [...issue.path].reverse().find((part): part is string => typeof part === "string") ?? "_";
    if (!accumulator[field]) accumulator[field] = issue.message;
    return accumulator;
  }, {});
}
