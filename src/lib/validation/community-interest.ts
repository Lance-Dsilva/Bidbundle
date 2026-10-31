import { z } from "zod";

import { MAX_PHONE_LENGTH, normalizeEmail } from "@/lib/validation/auth";

export const COMMUNITY_INTEREST_ROLE_LABELS = {
  community_manager: "Community manager",
  hoa_board: "HOA board member",
  property_manager: "Property manager",
  resident: "Resident",
  other: "Other",
} as const;
export const COMMUNITY_INTEREST_ROLES = ["community_manager", "hoa_board", "property_manager", "resident", "other"] as const;
export const MAX_COMMUNITY_INTEREST_BODY_BYTES = 8 * 1024;

/** Contact descriptions only. These values never grant application authority. */
export const communityInterestRoleSchema = z.enum(COMMUNITY_INTEREST_ROLES, {
  message: "Choose your connection to the community.",
});

export function normalizeCommunityInterestText(value: string): string {
  return value.normalize("NFKC").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
}

export function communityInterestKey(communityName: string): string {
  return normalizeCommunityInterestText(communityName).toLowerCase();
}

const boundedText = (maximum: number) => z.string().transform(normalizeCommunityInterestText)
  .pipe(z.string().min(1, "This field is required.").max(maximum, `Keep this under ${maximum} characters.`));

export const communityInterestSchema = z.object({
  contactName: boundedText(120),
  contactRole: communityInterestRoleSchema,
  communityName: boundedText(160),
  numberOfHomes: z.number({ message: "Enter the number of homes." })
    .int("Enter a whole number of homes.")
    .min(1, "Enter at least 1 home.")
    .max(10_000, "Enter 10,000 homes or fewer."),
  email: z.string().transform(normalizeEmail).pipe(z.string().max(254).email("Enter a valid email address.")),
  phone: z.string().transform(normalizeCommunityInterestText).pipe(z.string().max(MAX_PHONE_LENGTH))
    .nullable().optional().transform((value) => value || null),
}).strict();

export const communityInterestReceiptSchema = z.object({ received: z.literal(true) }).strict();
export const communityInterestListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
}).strict();

export const communityInterestItemSchema = z.object({
  id: z.string(),
  contactName: z.string(),
  contactRole: communityInterestRoleSchema,
  communityName: z.string(),
  numberOfHomes: z.number().int().positive(),
  email: z.string(),
  phone: z.string().nullable(),
  createdAt: z.string().datetime(),
}).strict();
export const communityInterestListSchema = z.object({
  items: z.array(communityInterestItemSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().min(1).max(50),
}).strict();

export type CommunityInterestInput = z.infer<typeof communityInterestSchema>;
export type CommunityInterestListQuery = z.infer<typeof communityInterestListQuerySchema>;
