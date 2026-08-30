import { z } from "zod";

/**
 * The contract for an individual (non-HOA) homeowner service request.
 *
 * Three boundaries are enforced by shape alone, so no handler can weaken them:
 *
 * 1. The body carries *what* the homeowner wants, never *who* they are or
 *    *where* it goes. Owner, community, membership, and status are derived from
 *    the verified session on the server. `.strict()` means a body that tries to
 *    send `ownerId`, `communityId`, or `status` is rejected outright rather than
 *    silently ignored — a silent drop would hide an attempted privilege change.
 * 2. Budget is a bounded, finite, whole number of **US cents**, matching
 *    `ServiceBid.amountCents` and the `HoaServiceRequest_budget_bounds` CHECK.
 *    One unit, stated once, and the same one in the database.
 * 3. Text is bounded on both ends. Blank-but-present strings fail, because a
 *    request with an empty description is unanswerable by a provider.
 */

export const MAX_REQUEST_BODY_BYTES = 32 * 1024;

export const MAX_REQUEST_TITLE_LENGTH = 120;
export const MAX_REQUEST_DESCRIPTION_LENGTH = 4_000;

/** $1,000,000. Far above any real home service, and safely inside INT4. */
export const MAX_BUDGET_CENTS = 100_000_000;

/**
 * The supported service categories.
 *
 * Lowercase slugs, because provider eligibility compares them against
 * `ProviderProfile.trades` lowercased. A closed list rather than free text: the
 * homeowner form, the provider trade filter, and the request feed have to agree
 * on the same word for a match to ever happen.
 */
export const SERVICE_CATEGORIES = [
  "cleaning",
  "electrical",
  "gutter",
  "handyman",
  "hvac",
  "lawn",
  "plumbing",
  "roofing",
  "other",
] as const;

export type ServiceCategory = (typeof SERVICE_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<ServiceCategory, string> = {
  cleaning: "Cleaning",
  electrical: "Electrical",
  gutter: "Gutter",
  handyman: "Handyman",
  hvac: "HVAC",
  lawn: "Lawn",
  plumbing: "Plumbing",
  roofing: "Roofing",
  other: "Other",
};

/** Collapses control characters and runaway blank lines a paste can carry. */
export function normalizeRequestText(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

const boundedText = (max: number, emptyMessage: string) =>
  z
    .string()
    .transform(normalizeRequestText)
    .refine((value) => value.length >= 1, { message: emptyMessage })
    .refine((value) => value.length <= max, {
      message: `Keep this under ${max.toLocaleString()} characters.`,
    });

/**
 * A budget amount in whole cents.
 *
 * `z.number().int()` already rejects `NaN` and `Infinity`, which is the
 * "finite" half of the requirement; the bounds are the rest. Cents are integers
 * on purpose — a fractional cent is not money, it is a rounding bug waiting to
 * be argued about.
 */
const budgetCents = z
  .number({ message: "Enter a budget amount." })
  .int("Enter a whole dollar amount.")
  .min(0, "A budget cannot be negative.")
  .max(MAX_BUDGET_CENTS, "That budget is higher than Bundleen supports.");

export const createHomeownerRequestSchema = z
  .object({
    title: boundedText(MAX_REQUEST_TITLE_LENGTH, "Give your request a short title."),
    category: z.enum(SERVICE_CATEGORIES, {
      message: "Choose one of the supported service categories.",
    }),
    description: boundedText(
      MAX_REQUEST_DESCRIPTION_LENGTH,
      "Describe the work you need done.",
    ),
    budgetMinCents: budgetCents,
    budgetMaxCents: budgetCents,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.budgetMaxCents < value.budgetMinCents) {
      context.addIssue({
        code: "custom",
        path: ["budgetMaxCents"],
        message: "The maximum budget cannot be below the minimum.",
      });
    }
  });

export type CreateHomeownerRequestInput = z.infer<typeof createHomeownerRequestSchema>;
