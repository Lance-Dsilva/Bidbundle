import { z } from "zod";

/**
 * Everything the provider console — and the conversation surface it shares
 * with the customer inbox — accepts from a browser.
 *
 * The list is deliberately short, and that is the point: an overview, a page
 * of reviews, an inbox, and a message body. No handler takes a provider id, a
 * customer id, a conversation owner, or a community. Opening a thread names a
 * *request* (provider side) or a *bid* (customer side), and the server reads
 * the other party off it, so there is no parameter a caller could edit to
 * reach someone they have no business with.
 */

export const MAX_PROVIDER_CONSOLE_BODY_BYTES = 16 * 1024;

export const MAX_CONVERSATION_MESSAGE_LENGTH = 4_000;

/** Page sizes. Bounded so a caller cannot ask for the whole table. */
export const REVIEW_PAGE_SIZE = 20;
export const MAX_REVIEW_PAGE_SIZE = 50;
export const MESSAGE_PAGE_SIZE = 50;
export const MAX_MESSAGE_PAGE_SIZE = 100;
export const MAX_INBOX_THREADS = 100;

/**
 * Reads `limit`/`offset` from a query string.
 *
 * Anything unparseable falls back to the default rather than erroring: a
 * malformed page number is a broken link, not an attack, and the ceiling is
 * what actually protects the database.
 */
export function readPagination(
  params: URLSearchParams,
  defaults: { limit: number; maxLimit: number },
): { limit: number; offset: number } {
  const rawLimit = Number(params.get("limit"));
  const rawOffset = Number(params.get("offset"));

  const limit =
    Number.isFinite(rawLimit) && rawLimit >= 1
      ? Math.min(Math.floor(rawLimit), defaults.maxLimit)
      : defaults.limit;
  const offset =
    Number.isFinite(rawOffset) && rawOffset >= 0
      ? Math.min(Math.floor(rawOffset), 10_000)
      : 0;

  return { limit, offset };
}

/**
 * Collapses control characters and runaway blank lines without touching
 * anything a person meant to type.
 *
 * Normalization, not sanitization: safety comes from never rendering this text
 * as HTML. Stripping `<` would corrupt "my quote is < $500" and protect
 * nothing that plain-text rendering does not already protect.
 */
export function normalizeMessageBody(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    // Keep tab and newline; drop the rest of C0 plus DEL.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

export const conversationMessageSchema = z.object({
  body: z
    .string()
    .transform(normalizeMessageBody)
    .pipe(
      z
        .string()
        .min(1, "Write a message before sending.")
        .max(
          MAX_CONVERSATION_MESSAGE_LENGTH,
          `Keep messages under ${MAX_CONVERSATION_MESSAGE_LENGTH.toLocaleString()} characters.`,
        ),
    ),
});

export type ConversationMessageInput = z.infer<typeof conversationMessageSchema>;

/**
 * Opening a thread names a *request*, never a person. The server reads the
 * customer off that request and confirms the caller has quoted it.
 */
export const startConversationSchema = z.object({
  requestId: z.string().min(1).max(64),
});

export type StartConversationInput = z.infer<typeof startConversationSchema>;

/**
 * The customer's mirror: a *bid*, never a provider. The server reads who
 * quoted it and confirms the bid is on a request this account owns.
 */
export const startCustomerConversationSchema = z.object({
  bidId: z.string().min(1).max(64),
});

export type StartCustomerConversationInput = z.infer<typeof startCustomerConversationSchema>;

/** Flattens a Zod failure into the `{ field: message }` shape the API returns. */
export function fieldErrorsFrom(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "body";
    if (!(key in fields)) fields[key] = issue.message;
  }
  return fields;
}
