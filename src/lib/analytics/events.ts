import { z } from "zod";
import { SERVICE_CATEGORIES } from "@/lib/service-categories";

export const ANALYTICS_CONSENT_VERSION = "product-analytics-v1";
export const PRODUCT_EVENTS = [
  "invite_opened", "request_viewed", "join_started", "card_saved", "joined",
  "tier_unlocked", "bid_submitted", "request_awarded", "visit_completed",
  "payment_succeeded", "payment_failed", "review_submitted", "rebooked",
  "hoa_onboarding_started", "hoa_roster_imported", "provider_applied", "provider_verified",
] as const;
export type ProductEvent = (typeof PRODUCT_EVENTS)[number];

// Intentionally no arbitrary strings, spread input, URLs, invitation tokens,
// names, email, addresses, user agents or IP addresses in the transport.
const internalId = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
export const productPropertiesSchema = z.object({
  communityId: internalId.optional(),
  requestId: internalId.optional(),
  category: z.enum(SERVICE_CATEGORIES).optional(),
  role: z.enum(["homeowner", "provider", "hoa_staff", "admin"]).optional(),
}).strict();
export type ProductProperties = z.infer<typeof productPropertiesSchema>;
export const productEventSchema = z.enum(PRODUCT_EVENTS);
