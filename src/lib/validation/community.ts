import { z } from "zod";

import { COMMUNITY_RADIUS_MI } from "@/lib/validation/profile";

/**
 * Community and internal-portal validation.
 *
 * Same principle as `@/lib/validation/profile`: a field that is absent from a
 * schema cannot be written through the API. That is what keeps
 * `assignedByUserId`, `assignedAt`, `revokedAt`, verification timestamps, and
 * every distance/eligibility result under server control — a client may ask
 * for an action, never state its outcome.
 */

export const COMMUNITY_TYPES = ["hoa", "neighborhood"] as const;
export type CommunityType = (typeof COMMUNITY_TYPES)[number];

export const COMMUNITY_STATUSES = ["active", "archived"] as const;
export type CommunityStatus = (typeof COMMUNITY_STATUSES)[number];

export const MEMBERSHIP_STATUSES = ["pending", "active", "removed"] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

export const COMMUNITY_STAFF_ROLES = [
  "neighborhood_manager",
  "hoa_manager",
  "hoa_team",
] as const;
export type CommunityStaffRole = (typeof COMMUNITY_STAFF_ROLES)[number];

export const PROVIDER_ACCOUNT_STATUSES = ["pending", "active", "suspended"] as const;
export type ProviderAccountStatus = (typeof PROVIDER_ACCOUNT_STATUSES)[number];

/** Which community type each scoped role is meaningful for. */
export const STAFF_ROLE_COMMUNITY_TYPE: Record<CommunityStaffRole, CommunityType> = {
  neighborhood_manager: "neighborhood",
  hoa_manager: "hoa",
  hoa_team: "hoa",
};

/** Human labels, used by the portal and by the customer identity area. */
export const STAFF_ROLE_LABELS: Record<CommunityStaffRole, string> = {
  neighborhood_manager: "Neighborhood manager",
  hoa_manager: "HOA manager",
  hoa_team: "HOA team",
};

/**
 * Most to least privileged. When someone holds several scoped roles the
 * identity area shows the first match, so this order is the tie-break.
 */
export const STAFF_ROLE_PRECEDENCE: readonly CommunityStaffRole[] = [
  "hoa_manager",
  "neighborhood_manager",
  "hoa_team",
];

export const MAX_COMMUNITY_NAME_LENGTH = 120;
export const MAX_ADMIN_NOTE_LENGTH = 500;
export const MAX_ADMIN_BODY_BYTES = 8 * 1024;

/** Upper bound on a community radius. Guards against a typo, not a policy. */
export const MAX_COMMUNITY_RADIUS_MI = 100;

/** Page size ceiling for every admin list endpoint. */
export const MAX_ADMIN_PAGE_SIZE = 100;
export const DEFAULT_ADMIN_PAGE_SIZE = 25;

/* ── Field builders ──────────────────────────────────────────────────────── */

const communityNameField = z
  .string()
  .trim()
  .min(1, "Enter a community name.")
  .max(MAX_COMMUNITY_NAME_LENGTH, "Community name is too long.");

const latitudeField = z
  .number()
  .refine((value) => Number.isFinite(value) && value >= -90 && value <= 90, {
    message: "Latitude must be between -90 and 90.",
  });

const longitudeField = z
  .number()
  .refine((value) => Number.isFinite(value) && value >= -180 && value <= 180, {
    message: "Longitude must be between -180 and 180.",
  });

const radiusField = z
  .number()
  .refine(
    (value) => Number.isFinite(value) && value > 0 && value <= MAX_COMMUNITY_RADIUS_MI,
    { message: `Radius must be between 0 and ${MAX_COMMUNITY_RADIUS_MI} miles.` },
  );

const noteField = z
  .union([z.string(), z.null()])
  .transform((value) => {
    if (value === null) return null;
    const trimmed = value.trim();
    return trimmed.length === 0 ? null : trimmed;
  })
  .refine((value) => value === null || value.length <= MAX_ADMIN_NOTE_LENGTH, {
    message: "Note is too long.",
  });

const idField = z.string().trim().min(1).max(64);

/* ── Community create / update ───────────────────────────────────────────── */

/**
 * A neighborhood needs a centre and a radius; an HOA may have neither.
 *
 * The radius defaults to the standard community radius rather than being
 * requested from the UI as a free choice — see `COMMUNITY_RADIUS_MI`. It is
 * accepted here only because Bundleen staff, not customers, may tune a
 * particular neighborhood.
 */
export const communityCreateSchema = z
  .object({
    name: communityNameField,
    type: z.enum(COMMUNITY_TYPES, { message: "Choose a community type." }),
    centerLatitude: latitudeField.nullable().optional(),
    centerLongitude: longitudeField.nullable().optional(),
    radiusMiles: radiusField.nullable().optional(),
  })
  .strict()
  .transform((value) => ({
    ...value,
    radiusMiles:
      value.type === "neighborhood" && value.radiusMiles == null
        ? COMMUNITY_RADIUS_MI
        : (value.radiusMiles ?? null),
    centerLatitude: value.centerLatitude ?? null,
    centerLongitude: value.centerLongitude ?? null,
  }))
  .superRefine((value, context) => {
    if (value.type !== "neighborhood") return;

    if (value.centerLatitude === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A neighborhood community needs a centre point.",
        path: ["centerLatitude"],
      });
    }
    if (value.centerLongitude === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A neighborhood community needs a centre point.",
        path: ["centerLongitude"],
      });
    }
  });

export type CommunityCreateInput = z.infer<typeof communityCreateSchema>;

/**
 * `type` is absent on purpose: flipping an HOA into a neighborhood would
 * invalidate every staff assignment it already holds. Archive and recreate
 * instead, which leaves the history readable.
 */
export const communityUpdateSchema = z
  .object({
    name: communityNameField,
    status: z.enum(COMMUNITY_STATUSES, { message: "Choose a valid status." }),
    centerLatitude: latitudeField.nullable(),
    centerLongitude: longitudeField.nullable(),
    radiusMiles: radiusField.nullable(),
  })
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Send at least one field to update.",
  })
  .refine(
    (value) =>
      // Half a centre point is not a centre point.
      !("centerLatitude" in value || "centerLongitude" in value) ||
      ("centerLatitude" in value &&
        "centerLongitude" in value &&
        (value.centerLatitude === null) === (value.centerLongitude === null)),
    {
      message: "Latitude and longitude must be provided together.",
      path: ["centerLatitude"],
    },
  );

export type CommunityUpdateInput = z.infer<typeof communityUpdateSchema>;

/* ── Membership ──────────────────────────────────────────────────────────── */

export const membershipCreateSchema = z
  .object({
    userId: idField,
    status: z.enum(["pending", "active"], { message: "Choose a valid membership status." }),
    isPrimary: z.boolean().optional(),
    /**
     * Set when staff place a homeowner the radius match would not have chosen.
     * The server still records the real distance; this only says the decision
     * was manual.
     */
    isAdminOverride: z.boolean().optional(),
    note: noteField.optional(),
  })
  .strict();

export type MembershipCreateInput = z.infer<typeof membershipCreateSchema>;

export const membershipUpdateSchema = z
  .object({
    status: z.enum(MEMBERSHIP_STATUSES, { message: "Choose a valid membership status." }),
    isPrimary: z.boolean(),
    isAdminOverride: z.boolean(),
    note: noteField,
  })
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Send at least one field to update.",
  });

export type MembershipUpdateInput = z.infer<typeof membershipUpdateSchema>;

/* ── Staff assignment ────────────────────────────────────────────────────── */

/**
 * `assignedByUserId` is not a field here — it comes from the verified session.
 * A request that names its own assigner is exactly the thing this endpoint
 * must not honour.
 */
export const staffAssignSchema = z
  .object({
    userId: idField,
    role: z.enum(COMMUNITY_STAFF_ROLES, { message: "Choose a valid role." }),
    /**
     * Required acknowledgement that appointing a neighborhood manager revokes
     * the current one. The server refuses the replacement without it.
     */
    replaceExistingManager: z.boolean().optional(),
    note: noteField.optional(),
  })
  .strict();

export type StaffAssignInput = z.infer<typeof staffAssignSchema>;

export const staffRevokeSchema = z
  .object({ note: noteField.optional() })
  .strict();

export type StaffRevokeInput = z.infer<typeof staffRevokeSchema>;

/* ── Provider administration ─────────────────────────────────────────────── */

/**
 * Verification is expressed as an intent (`verify` / `revoke`), never as a
 * timestamp. The server writes the clock so a client cannot backdate a
 * credential check.
 */
export const providerAdminUpdateSchema = z
  .object({
    accountStatus: z.enum(PROVIDER_ACCOUNT_STATUSES, {
      message: "Choose a valid provider status.",
    }),
    license: z.enum(["verify", "revoke"]),
    insurance: z.enum(["verify", "revoke"]),
    /**
     * The provider row the administrator actually reviewed. Credential
     * actions are rejected if the provider changes the claim meanwhile.
     */
    expectedUpdatedAt: z.string().datetime({ offset: true }),
    note: noteField,
  })
  .partial()
  .strict()
  .refine((value) => Boolean(value.accountStatus || value.license || value.insurance), {
    message: "Send at least one change.",
  })
  .superRefine((value, context) => {
    if ((value.accountStatus || value.license || value.insurance) && !value.expectedUpdatedAt) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Reload this provider before changing credential verification.",
        path: ["expectedUpdatedAt"],
      });
    }
  });

export type ProviderAdminUpdateInput = z.infer<typeof providerAdminUpdateSchema>;

/* ── List queries ────────────────────────────────────────────────────────── */

const pageSizeParam = z
  .coerce.number()
  .int()
  .min(1)
  .max(MAX_ADMIN_PAGE_SIZE)
  .catch(DEFAULT_ADMIN_PAGE_SIZE);

const pageParam = z.coerce.number().int().min(1).max(10_000).catch(1);

const searchParam = z.string().trim().max(120).catch("");

/**
 * List filters are read with `.catch(...)` throughout: a malformed query string
 * should render the default view, not a validation error page.
 */
export const communityListQuerySchema = z.object({
  search: searchParam,
  type: z.enum(COMMUNITY_TYPES).nullable().catch(null),
  status: z.enum(COMMUNITY_STATUSES).nullable().catch(null),
  managerState: z.enum(["assigned", "unassigned"]).nullable().catch(null),
  page: pageParam,
  pageSize: pageSizeParam,
});

export type CommunityListQuery = z.infer<typeof communityListQuerySchema>;

export const providerListQuerySchema = z.object({
  search: searchParam,
  status: z.enum(PROVIDER_ACCOUNT_STATUSES).nullable().catch(null),
  verification: z.enum(["verified", "unverified"]).nullable().catch(null),
  page: pageParam,
  pageSize: pageSizeParam,
});

export type ProviderListQuery = z.infer<typeof providerListQuerySchema>;

export const auditListQuerySchema = z.object({
  communityId: z.string().trim().max(64).nullable().catch(null),
  providerUserId: z.string().trim().max(64).nullable().catch(null),
  page: pageParam,
  pageSize: pageSizeParam,
});

export type AuditListQuery = z.infer<typeof auditListQuerySchema>;

/** Turns `URLSearchParams` into the plain object the schemas above parse. */
export function searchParamsToObject(params: URLSearchParams): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of params.entries()) {
    // Blank filters mean "no filter" and must reach `.catch(null)` as null
    // rather than as `""`, which `z.enum` would reject into the same default
    // but which `search` would treat as a real (empty) term.
    result[key] = value === "" ? undefined : value;
  }
  return result;
}
