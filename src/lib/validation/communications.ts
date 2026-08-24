import { z } from "zod";

/**
 * The allow-list for operational broadcasts.
 *
 * Nothing here decides who receives anything. Audience *segments* are named
 * here; the actual recipient set is resolved server-side from live account
 * state, so a client cannot supply a recipient list, a recipient count, or an
 * email address.
 */

export const MAX_BROADCAST_BODY_BYTES = 16 * 1024;

export const MAX_BROADCAST_SUBJECT_LENGTH = 160;
export const MAX_BROADCAST_MESSAGE_LENGTH = 5_000;
export const MAX_BROADCAST_IN_APP_TITLE_LENGTH = 120;
export const MAX_BROADCAST_IN_APP_BODY_LENGTH = 400;

export const BROADCAST_SEVERITIES = [
  "announcement",
  "maintenance",
  "degraded",
  "outage",
  "security",
] as const;

/**
 * The severities that may override a recipient's general announcement email
 * preference. An ordinary `announcement` never can — which is the whole point
 * of the preference.
 */
export const URGENT_OPERATIONAL_SEVERITIES = [
  "maintenance",
  "degraded",
  "outage",
  "security",
] as const;

export const BROADCAST_SEGMENTS = ["homeowner", "hoa_manager", "provider"] as const;

export type BroadcastSeverityValue = (typeof BROADCAST_SEVERITIES)[number];
export type BroadcastSegment = (typeof BROADCAST_SEGMENTS)[number];

/** The exact phrase an admin must type to release a global send. */
export const GLOBAL_SEND_CONFIRMATION = "SEND TO ALL";

function boundedText(max: number, message: string) {
  return z
    .string()
    .transform((value) => value.replace(/\r\n?/g, "\n").trim())
    .refine((value) => value.length >= 1, { message })
    .refine((value) => value.length <= max, {
      message: `Keep this under ${max.toLocaleString()} characters.`,
    });
}

function optionalBoundedText(max: number) {
  return z
    .union([z.string(), z.null()])
    .optional()
    .transform((value) => {
      if (value === null || value === undefined) return null;
      const trimmed = value.replace(/\r\n?/g, "\n").trim();
      return trimmed.length === 0 ? null : trimmed;
    })
    .refine((value) => value === null || value.length <= max, {
      message: `Keep this under ${max.toLocaleString()} characters.`,
    });
}

/**
 * In-app destinations are app-relative paths only.
 *
 * A protocol-relative `//evil.example` is a same-origin-looking link that is
 * not, so it is rejected alongside absolute URLs — a platform-wide message is
 * the worst possible place to ship an open redirect.
 */
const linkPathField = z
  .union([z.string(), z.null()])
  .optional()
  .transform((value) => {
    if (value === null || value === undefined) return null;
    const trimmed = value.trim();
    return trimmed.length === 0 ? null : trimmed;
  })
  .refine(
    (value) => value === null || (value.startsWith("/") && !value.startsWith("//")),
    { message: "Use an in-app path such as /app/homeowner/dashboard." },
  )
  .refine((value) => value === null || value.length <= 200, {
    message: "That link is too long.",
  });

export const broadcastDraftSchema = z
  .object({
    subject: boundedText(MAX_BROADCAST_SUBJECT_LENGTH, "Add a subject line."),
    body: boundedText(MAX_BROADCAST_MESSAGE_LENGTH, "Write the message."),
    severity: z.enum(BROADCAST_SEVERITIES),
    inAppTitle: optionalBoundedText(MAX_BROADCAST_IN_APP_TITLE_LENGTH),
    inAppBody: optionalBoundedText(MAX_BROADCAST_IN_APP_BODY_LENGTH),
    linkPath: linkPathField,
    /** Empty means every active account. */
    audienceSegments: z.array(z.enum(BROADCAST_SEGMENTS)).max(3).default([]),
    overridesEmailPreference: z.boolean().default(false),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.overridesEmailPreference &&
      !(URGENT_OPERATIONAL_SEVERITIES as readonly string[]).includes(value.severity)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["overridesEmailPreference"],
        message:
          "Only maintenance, degraded, outage, and security messages may reach people who turned announcement email off.",
      });
    }
    // An in-app notification with a body but no title has nothing to render in
    // the bell; both or neither.
    if (Boolean(value.inAppTitle) !== Boolean(value.inAppBody)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["inAppBody"],
        message: "Give the in-app notification both a title and a body, or leave both empty.",
      });
    }
  });

export type BroadcastDraftInput = z.infer<typeof broadcastDraftSchema>;

/**
 * The final release. Carries the typed confirmation phrase and the recipient
 * count the admin was shown, so a preview that has drifted is caught before
 * anything is delivered.
 */
export const broadcastSendSchema = z
  .object({
    confirmation: z.literal(GLOBAL_SEND_CONFIRMATION, {
      message: `Type ${GLOBAL_SEND_CONFIRMATION} exactly to confirm.`,
    }),
    /** From the server-calculated preview the admin approved. */
    acknowledgedRecipientCount: z.number().int().min(0).max(10_000_000),
  })
  .strict();

export type BroadcastSendInput = z.infer<typeof broadcastSendSchema>;
