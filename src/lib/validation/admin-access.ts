import { z } from "zod";

import { normalizeEmail } from "@/lib/validation/auth";

export const MAX_ADMIN_ACCESS_EMAIL_LENGTH = 254;

/** The browser supplies only an email; level, status, and actor are server-owned. */
export const adminAccessGrantSchema = z
  .object({
    email: z
      .string()
      .trim()
      .email("Enter a valid email address.")
      .max(MAX_ADMIN_ACCESS_EMAIL_LENGTH, "Email address is too long.")
      .transform(normalizeEmail),
  })
  .strict();
