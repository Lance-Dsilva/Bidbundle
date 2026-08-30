import { z } from "zod";

/**
 * Bounded input for every amenity, booking, issue, and review mutation.
 *
 * Nothing here accepts a community id, an owner, a status the server derives,
 * a coordinate, or an aggregate. Those come from the session and the database;
 * a client that sends them is ignored, not trusted.
 */

export const MAX_AMENITY_BODY_BYTES = 64 * 1024;

export const MAX_AMENITY_NAME_LENGTH = 120;
export const MAX_AMENITY_DESCRIPTION_LENGTH = 4_000;
export const MAX_AMENITY_FEATURES = 12;
export const MAX_AMENITY_FEATURE_LENGTH = 60;
export const MAX_AMENITY_RULES_LENGTH = 4_000;
export const MAX_AMENITY_LABEL_LENGTH = 120;
export const MAX_AMENITY_RESOURCES = 40;
export const MAX_AMENITY_HOURS_ROWS = 21;
export const MAX_CLOSURE_REASON_LENGTH = 200;

export const MAX_BOOKING_NOTE_LENGTH = 500;
export const MAX_CANCELLATION_REASON_LENGTH = 300;

export const MAX_ISSUE_SUBJECT_LENGTH = 160;
export const MAX_ISSUE_DESCRIPTION_LENGTH = 4_000;
export const MAX_ISSUE_MESSAGE_LENGTH = 4_000;
export const MAX_ISSUE_RESOLUTION_LENGTH = 2_000;

export const MAX_AMENITY_REVIEW_LENGTH = 2_000;
export const MAX_REVIEW_RESPONSE_LENGTH = 2_000;

export const MAX_AMENITY_BROADCAST_SUBJECT_LENGTH = 160;
export const MAX_AMENITY_BROADCAST_BODY_LENGTH = 5_000;

/** Per-file and per-owner media limits, shared by the server and the UI copy. */
export const MAX_MEDIA_BYTES = 8 * 1024 * 1024;
export const MAX_GALLERY_IMAGES = 12;
export const MAX_ISSUE_IMAGES = 5;
export const MAX_REVIEW_IMAGES = 3;
export const ALLOWED_MEDIA_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export const AMENITY_TYPES = [
  "pool",
  "clubhouse",
  "gym",
  "tennis_court",
  "badminton_court",
  "basketball_court",
  "meeting_room",
  "barbecue_area",
  "playground",
  "park",
  "other",
] as const;

export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

export const ISSUE_CATEGORIES = [
  "damage",
  "cleanliness",
  "safety",
  "access",
  "equipment",
  "reservation_conflict",
  "noise",
  "other",
] as const;

export const CLOSURE_KINDS = [
  "blackout",
  "maintenance",
  "holiday",
  "private_event",
] as const;

export const OPERATIONAL_STATUSES = [
  "open",
  "closed",
  "maintenance",
  "temporarily_unavailable",
] as const;

const idField = z.string().trim().min(1).max(64);

/**
 * An optional, trimmed, length-capped free-text field.
 *
 * `.optional()` is applied *after* the transform on purpose. Applying it first
 * — as `validation/hoa.ts` does — makes the transform's output type
 * `string | null` and therefore turns every one of these into a *required*
 * property on the inferred type, which forces callers to pass `note: null`,
 * `reason: null`, and so on to satisfy the compiler. Ordering it this way keeps
 * three distinct meanings distinct: absent (leave alone), `null` (clear), and a
 * string (set).
 */
const boundedText = (max: number) =>
  z
    .union([z.string(), z.null()])
    .transform((value) => {
      if (value === null) return null;
      const trimmed = value.trim();
      return trimmed ? trimmed.slice(0, max) : null;
    })
    .optional();

const requiredText = (max: number, message: string) =>
  z.string().trim().min(1, message).max(max);

/* ── Amenity configuration (manager / admin) ─────────────────────────────── */

/**
 * Minute-of-day opening window. `closesMinute` may run to 1800 (06:00 the
 * following day) so an overnight window stays a single ordered pair, matching
 * the `AmenityHours_window` check constraint exactly.
 */
export const amenityHoursSchema = z
  .object({
    weekday: z.enum(WEEKDAYS),
    opensMinute: z.number().int().min(0).max(1_439),
    closesMinute: z.number().int().min(1).max(1_800),
  })
  .refine((value) => value.closesMinute > value.opensMinute, {
    message: "Closing time must be after opening time.",
    path: ["closesMinute"],
  });

export const amenityPolicySchema = z
  .object({
    slotMinutes: z.number().int().min(5).max(1_440),
    minDurationMinutes: z.number().int().min(5).max(1_440),
    maxDurationMinutes: z.number().int().min(5).max(1_440),
    bufferMinutes: z.number().int().min(0).max(240),
    maxPartySize: z.number().int().min(1).max(500),
    advanceDays: z.number().int().min(0).max(365),
    minNoticeMinutes: z.number().int().min(0).max(43_200),
    cancellationCutoffMinutes: z.number().int().min(0).max(43_200),
    maxActiveBookingsPerResident: z.number().int().min(1).max(50),
    maxActiveBookingsPerUnit: z.union([z.number().int().min(1).max(50), z.null()]).optional(),
    approvalRequired: z.boolean(),
  })
  .refine((value) => value.maxDurationMinutes >= value.minDurationMinutes, {
    message: "Maximum duration cannot be shorter than the minimum.",
    path: ["maxDurationMinutes"],
  })
  .refine((value) => value.minDurationMinutes % value.slotMinutes === 0, {
    message: "Minimum duration must be a whole number of slots.",
    path: ["minDurationMinutes"],
  })
  .refine((value) => value.maxDurationMinutes % value.slotMinutes === 0, {
    message: "Maximum duration must be a whole number of slots.",
    path: ["maxDurationMinutes"],
  });

export const amenityCreateSchema = z.object({
  name: requiredText(MAX_AMENITY_NAME_LENGTH, "Give the amenity a name."),
  type: z.enum(AMENITY_TYPES),
  description: boundedText(MAX_AMENITY_DESCRIPTION_LENGTH),
  features: z
    .array(z.string().trim().min(1).max(MAX_AMENITY_FEATURE_LENGTH))
    .max(MAX_AMENITY_FEATURES)
    .optional()
    .transform((value) => value ?? []),
  locationLabel: boundedText(MAX_AMENITY_LABEL_LENGTH),
  rules: boundedText(MAX_AMENITY_RULES_LENGTH),
  permittedUses: boundedText(MAX_AMENITY_RULES_LENGTH),
  ageRestriction: boundedText(MAX_AMENITY_LABEL_LENGTH),
  guestPolicy: boundedText(MAX_AMENITY_RULES_LENGTH),
  cancellationPolicy: boundedText(MAX_AMENITY_RULES_LENGTH),
  contactInstructions: boundedText(MAX_AMENITY_RULES_LENGTH),
  bookingRequired: z.boolean(),
  /**
   * How many equivalent spaces exist. One exclusive court is `1`; four
   * identical courts is `4`. The server turns this into `AmenityResource`
   * rows, which is what the no-overbooking constraint operates on.
   */
  resourceCount: z.number().int().min(1).max(MAX_AMENITY_RESOURCES).optional(),
  resourceLabels: z
    .array(z.string().trim().min(1).max(MAX_AMENITY_LABEL_LENGTH))
    .max(MAX_AMENITY_RESOURCES)
    .optional(),
  policy: amenityPolicySchema.optional(),
  hours: z.array(amenityHoursSchema).max(MAX_AMENITY_HOURS_ROWS).optional(),
});

export const amenityUpdateSchema = amenityCreateSchema.partial().extend({
  operationalStatus: z.enum(OPERATIONAL_STATUSES).optional(),
  operationalNote: boundedText(MAX_CLOSURE_REASON_LENGTH),
  reopensAt: z.union([z.string().datetime({ offset: true }), z.null()]).optional(),
});

export const amenityStatusSchema = z.object({
  /** `archived` preserves every booking, review, and issue; it never deletes. */
  status: z.enum(["draft", "published", "archived"]),
});

export const amenityCoverSchema = z.object({ mediaId: idField });

export const amenityGalleryOrderSchema = z.object({
  mediaIds: z.array(idField).min(1).max(MAX_GALLERY_IMAGES),
});

export const amenityClosureSchema = z
  .object({
    kind: z.enum(CLOSURE_KINDS),
    startsAt: z.union([z.string().datetime({ offset: true }), z.null()]).optional(),
    endsAt: z.union([z.string().datetime({ offset: true }), z.null()]).optional(),
    recurringWeekday: z.union([z.enum(WEEKDAYS), z.null()]).optional(),
    recurringStartMinute: z
      .union([z.number().int().min(0).max(1_439), z.null()])
      .optional(),
    recurringEndMinute: z.union([z.number().int().min(1).max(1_800), z.null()]).optional(),
    residentVisible: z.boolean().optional(),
    reason: boundedText(MAX_CLOSURE_REASON_LENGTH),
  })
  .refine(
    (value) => {
      const oneOff = Boolean(value.startsAt && value.endsAt);
      const recurring =
        value.recurringWeekday != null &&
        value.recurringStartMinute != null &&
        value.recurringEndMinute != null;
      return oneOff !== recurring;
    },
    { message: "Give either a date range or a weekly repeat, not both." },
  )
  .refine(
    (value) =>
      !value.startsAt ||
      !value.endsAt ||
      new Date(value.endsAt).getTime() > new Date(value.startsAt).getTime(),
    { message: "The closure must end after it starts.", path: ["endsAt"] },
  )
  .refine(
    (value) =>
      value.recurringStartMinute == null ||
      value.recurringEndMinute == null ||
      value.recurringEndMinute > value.recurringStartMinute,
    { message: "The weekly window must end after it starts.", path: ["recurringEndMinute"] },
  );

/* ── Bookings ────────────────────────────────────────────────────────────── */

export const bookingCreateSchema = z.object({
  /** Server-generated slot instant. Never a local wall-clock string. */
  startsAt: z.string().datetime({ offset: true }),
  /**
   * Optional; the server falls back to the amenity's minimum duration. Sent as
   * a length rather than an end instant so a client cannot smuggle in an
   * unaligned range.
   */
  durationMinutes: z.number().int().min(5).max(1_440).optional(),
  partySize: z.number().int().min(1).max(500).optional(),
  note: boundedText(MAX_BOOKING_NOTE_LENGTH),
});

export const bookingCancelSchema = z.object({
  reason: boundedText(MAX_CANCELLATION_REASON_LENGTH),
});

export const bookingRescheduleSchema = z.object({
  startsAt: z.string().datetime({ offset: true }),
  durationMinutes: z.number().int().min(5).max(1_440).optional(),
});

export const managerBookingDecisionSchema = z.object({
  decision: z.enum(["approve", "decline", "cancel", "complete", "no_show"]),
  reason: boundedText(MAX_CANCELLATION_REASON_LENGTH),
});

export const availabilityQuerySchema = z.object({
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date.")
    .optional(),
  days: z.number().int().min(1).max(31).optional(),
  durationMinutes: z.number().int().min(5).max(1_440).optional(),
});

/* ── Issues ──────────────────────────────────────────────────────────────── */

export const issueCreateSchema = z.object({
  category: z.enum(ISSUE_CATEGORIES),
  subject: requiredText(MAX_ISSUE_SUBJECT_LENGTH, "Give the report a short subject."),
  description: requiredText(
    MAX_ISSUE_DESCRIPTION_LENGTH,
    "Describe what you found so the manager can act on it.",
  ),
  bookingId: idField.optional(),
});

export const issueMessageSchema = z.object({
  body: requiredText(MAX_ISSUE_MESSAGE_LENGTH, "Write a message."),
  /**
   * Manager-only. An internal note is never serialized to the reporter, never
   * emailed, and never reaches AI context — see `amenity-issues.ts`.
   */
  internal: z.boolean().optional(),
});

export const issueUpdateSchema = z.object({
  status: z
    .enum(["acknowledged", "investigating", "waiting_on_resident", "resolved", "closed"])
    .optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
  /** A Bundleen user id; the server verifies they staff this exact HOA. */
  assignedToUserId: z.union([idField, z.null()]).optional(),
  resolutionSummary: boundedText(MAX_ISSUE_RESOLUTION_LENGTH),
});

export const issueWithdrawSchema = z.object({
  action: z.enum(["withdraw", "reopen"]),
});

/* ── Reviews ─────────────────────────────────────────────────────────────── */

export const amenityReviewSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: requiredText(MAX_AMENITY_REVIEW_LENGTH, "Write a short review."),
  /** Required when the amenity takes bookings; identifies the completed visit. */
  bookingId: idField.optional(),
});

export const reviewResponseSchema = z.object({
  body: requiredText(MAX_REVIEW_RESPONSE_LENGTH, "Write a response."),
});

export const reviewModerationSchema = z.object({
  reason: requiredText(MAX_CLOSURE_REASON_LENGTH, "Record why this was removed."),
});

export const reviewListQuerySchema = z.object({
  sort: z.enum(["newest", "highest", "lowest"]).optional(),
  cursor: idField.optional(),
  limit: z.number().int().min(1).max(50).optional(),
});

/* ── HOA-scoped amenity communications ───────────────────────────────────── */

export const amenityBroadcastSchema = z.object({
  /**
   * Never a global audience and never another HOA: every option below resolves
   * to residents of the one HOA the manager is scoped to.
   */
  audience: z.enum(["all_residents", "upcoming_bookings", "affected_by_closure"]),
  subject: requiredText(MAX_AMENITY_BROADCAST_SUBJECT_LENGTH, "Give the message a subject."),
  body: requiredText(MAX_AMENITY_BROADCAST_BODY_LENGTH, "Write the message."),
  /**
   * Overrides an ordinary opt-out. Allowed only for a genuine safety or
   * closure notice, and recorded in the audit log with its justification.
   */
  urgent: z.boolean().optional(),
  urgentJustification: boundedText(MAX_CLOSURE_REASON_LENGTH),
  mode: z.enum(["preview", "test", "send"]),
});

export type AmenityCreateInput = z.infer<typeof amenityCreateSchema>;
export type AmenityUpdateInput = z.infer<typeof amenityUpdateSchema>;
export type AmenityPolicyInput = z.infer<typeof amenityPolicySchema>;
export type AmenityHoursInput = z.infer<typeof amenityHoursSchema>;
export type AmenityClosureInput = z.infer<typeof amenityClosureSchema>;
export type BookingCreateInput = z.infer<typeof bookingCreateSchema>;
export type BookingRescheduleInput = z.infer<typeof bookingRescheduleSchema>;
export type ManagerBookingDecisionInput = z.infer<typeof managerBookingDecisionSchema>;
export type IssueCreateInput = z.infer<typeof issueCreateSchema>;
export type IssueUpdateInput = z.infer<typeof issueUpdateSchema>;
export type AmenityReviewInput = z.infer<typeof amenityReviewSchema>;
export type AmenityBroadcastInput = z.infer<typeof amenityBroadcastSchema>;
