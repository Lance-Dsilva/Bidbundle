import { z } from "zod";

/**
 * The allow-list for everything a support API accepts.
 *
 * Two boundaries matter here and are enforced by shape alone:
 *
 * 1. A customer body can name a subject, a category, and text. It cannot name
 *    a requester, a status, a priority, an assignee, or a ticket number —
 *    those are derived from the session or owned by admins.
 * 2. Message text is bounded and stored as plain text. Nothing downstream ever
 *    treats it as markup, so a `<script>` in a ticket is characters, not code.
 */

export const MAX_SUPPORT_BODY_BYTES = 32 * 1024;

export const MAX_TICKET_SUBJECT_LENGTH = 160;
export const MAX_TICKET_MESSAGE_LENGTH = 10_000;

export const SUPPORT_TICKET_CATEGORIES = [
  "account",
  "billing",
  "service_request",
  "bidding",
  "scheduling",
  "provider_issue",
  "community",
  "technical",
  "other",
] as const;

export const SUPPORT_TICKET_STATUSES = [
  "new",
  "open",
  "pending_customer",
  "pending_internal",
  "resolved",
  "closed",
] as const;

export const SUPPORT_TICKET_PRIORITIES = ["low", "normal", "high", "urgent"] as const;

export type SupportTicketCategoryValue = (typeof SUPPORT_TICKET_CATEGORIES)[number];
export type SupportTicketStatusValue = (typeof SUPPORT_TICKET_STATUSES)[number];
export type SupportTicketPriorityValue = (typeof SUPPORT_TICKET_PRIORITIES)[number];

/**
 * Collapses the control characters and runaway blank lines a paste can carry,
 * without touching anything a human meant to type.
 *
 * This is normalization, not sanitization — safety comes from never rendering
 * this text as HTML. Stripping `<` here would corrupt legitimate messages
 * ("my bid is < $500") while providing no protection that plain-text rendering
 * does not already give.
 */
export function normalizeTicketText(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    // Keep tab and newline; drop the rest of C0 plus DEL.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

const ticketText = (max: number, message: string) =>
  z
    .string()
    .transform(normalizeTicketText)
    .refine((value) => value.length >= 1, { message })
    .refine((value) => value.length <= max, {
      message: `Keep this under ${max.toLocaleString()} characters.`,
    });

/* ── Customer ────────────────────────────────────────────────────────────── */

export const createTicketSchema = z
  .object({
    subject: ticketText(MAX_TICKET_SUBJECT_LENGTH, "Add a short subject."),
    category: z.enum(SUPPORT_TICKET_CATEGORIES),
    message: ticketText(MAX_TICKET_MESSAGE_LENGTH, "Describe what you need help with."),
    /**
     * Optional context the requester can point at. Every id is re-authorized
     * server-side against the requester's own records before it is stored, so
     * naming a stranger's request here reveals nothing.
     */
    communityId: z.string().trim().min(1).max(64).optional(),
    relatedRequestId: z.string().trim().min(1).max(64).optional(),
    relatedBidId: z.string().trim().min(1).max(64).optional(),
    relatedVisitId: z.string().trim().min(1).max(64).optional(),
  })
  .strict();

export type CreateTicketInput = z.infer<typeof createTicketSchema>;

export const customerReplySchema = z
  .object({
    message: ticketText(MAX_TICKET_MESSAGE_LENGTH, "Write a reply before sending."),
  })
  .strict();

export type CustomerReplyInput = z.infer<typeof customerReplySchema>;

/* ── Admin ───────────────────────────────────────────────────────────────── */

/**
 * Bundleen may start a support conversation with one provider from the
 * provider CRM record. The provider identity and assigned admin are derived
 * from the URL and verified session, never accepted from this body.
 */
export const adminProviderTicketCreateSchema = z
  .object({
    subject: ticketText(MAX_TICKET_SUBJECT_LENGTH, "Add a short subject."),
    category: z.enum(SUPPORT_TICKET_CATEGORIES),
    priority: z.enum(SUPPORT_TICKET_PRIORITIES).default("normal"),
    message: ticketText(MAX_TICKET_MESSAGE_LENGTH, "Write the message to the provider."),
  })
  .strict();

export type AdminProviderTicketCreateInput = z.infer<
  typeof adminProviderTicketCreateSchema
>;

/**
 * Every admin mutation carries the `updatedAt` the admin was looking at.
 *
 * The update's `where` clause includes it, so a second admin acting on a stale
 * view matches no row and gets a 409 instead of silently overwriting the reply
 * or status change that landed in between.
 */
const concurrencyToken = z.object({
  expectedUpdatedAt: z.iso.datetime({ message: "Reload the ticket and try again." }),
});

export const adminTicketMessageSchema = concurrencyToken
  .extend({
    message: ticketText(MAX_TICKET_MESSAGE_LENGTH, "Write a message before sending."),
    /** `false` sends a customer-visible reply; `true` records an internal note. */
    internal: z.boolean().default(false),
    /** Optional status to apply in the same transaction as the reply. */
    status: z.enum(SUPPORT_TICKET_STATUSES).optional(),
  })
  .strict();

export type AdminTicketMessageInput = z.infer<typeof adminTicketMessageSchema>;

export const adminTicketUpdateSchema = concurrencyToken
  .extend({
    status: z.enum(SUPPORT_TICKET_STATUSES).optional(),
    priority: z.enum(SUPPORT_TICKET_PRIORITIES).optional(),
    /** `null` unassigns; a string must be an active admin, checked server-side. */
    assignedAdminUserId: z.union([z.string().trim().min(1).max(64), z.null()]).optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.status !== undefined ||
      value.priority !== undefined ||
      value.assignedAdminUserId !== undefined,
    { message: "Nothing to change." },
  );

export type AdminTicketUpdateInput = z.infer<typeof adminTicketUpdateSchema>;

/* ── Queue query ─────────────────────────────────────────────────────────── */

export const TICKET_SORT_OPTIONS = [
  "newest",
  "oldest_unanswered",
  "priority",
  "recent_activity",
] as const;

export type TicketSortOption = (typeof TICKET_SORT_OPTIONS)[number];

/** Coerces a `URLSearchParams`-shaped record; every field is optional. */
export const adminTicketQuerySchema = z
  .object({
    search: z.string().trim().max(120).optional(),
    status: z.enum(SUPPORT_TICKET_STATUSES).optional(),
    priority: z.enum(SUPPORT_TICKET_PRIORITIES).optional(),
    category: z.enum(SUPPORT_TICKET_CATEGORIES).optional(),
    requesterRole: z.enum(["homeowner", "provider", "hoa_staff", "admin"]).optional(),
    /** `unassigned` is a distinct filter, not an empty assignee id. */
    assignee: z.string().trim().max(64).optional(),
    /** Minimum age in days, for "what has been waiting too long". */
    minAgeDays: z.coerce.number().int().min(0).max(365).optional(),
    sort: z.enum(TICKET_SORT_OPTIONS).default("recent_activity"),
    page: z.coerce.number().int().min(1).max(1_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();

export type AdminTicketQuery = z.infer<typeof adminTicketQuerySchema>;

/* ── AI assistance ───────────────────────────────────────────────────────── */

export const aiDraftApprovalSchema = concurrencyToken
  .extend({
    draftId: z.string().trim().min(1).max(64),
    /**
     * The exact text the admin is sending, after any edits. This — not the
     * model's original output — is what reaches the customer and what the
     * audit record stores.
     */
    message: ticketText(MAX_TICKET_MESSAGE_LENGTH, "The reply cannot be empty."),
    status: z.enum(SUPPORT_TICKET_STATUSES).optional(),
  })
  .strict();

export type AiDraftApprovalInput = z.infer<typeof aiDraftApprovalSchema>;

export const aiDraftDiscardSchema = z
  .object({ draftId: z.string().trim().min(1).max(64) })
  .strict();
