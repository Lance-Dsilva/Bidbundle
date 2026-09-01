import { z } from "zod";

import { ADMIN_PERMISSIONS } from "@/lib/admin-permissions";
import { normalizeEmail } from "@/lib/validation/auth";
import { MAX_NAME_LENGTH } from "@/lib/validation/auth";

export const MAX_ADMIN_ACCESS_EMAIL_LENGTH = 254;

/** The owner identifies a new staff member; level, status, and actor are server-owned. */
export const adminAccessGrantSchema = z
  .object({
    fullName: z
      .string()
      .trim()
      .min(2, "Enter the administrator's full name.")
      .max(MAX_NAME_LENGTH, "Name is too long."),
    email: z
      .string()
      .trim()
      .email("Enter a valid email address.")
      .max(MAX_ADMIN_ACCESS_EMAIL_LENGTH, "Email address is too long.")
      .transform(normalizeEmail),
  })
  .strict();

/**
 * Replacing the named capabilities on one grant.
 *
 * The complete desired set, not a delta: the owner's screen shows every
 * checkbox, so submitting it should mean exactly what it shows. Unknown
 * strings are rejected here and dropped again server-side.
 */
export const adminPermissionsSchema = z
  .object({
    permissions: z.array(z.enum(ADMIN_PERMISSIONS)).max(ADMIN_PERMISSIONS.length),
  })
  .strict();
