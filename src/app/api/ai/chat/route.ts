import { streamAiChat } from "@/lib/server/ai/chat";
import { readAiBody, requireAiChatMutation, validationErrorResponse } from "@/lib/server/ai/gate";
import { aiChatMessageSchema } from "@/lib/validation/ai";
import { fieldErrors } from "@/lib/validation/profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Streams one assistant turn as newline-delimited JSON
 * (`{"type":"delta"|"tool"|"done"|"error", ...}`, see `ChatStreamEvent`).
 *
 * The rate limit here (`requireAiChatMutation` → `RATE_LIMITS.aiChat`) is the
 * primary cost control: it runs before any OpenAI call is made.
 */
export async function POST(request: Request): Promise<Response> {
  const gate = await requireAiChatMutation();
  if (!gate.ok) return gate.response;

  const body = await readAiBody(request);
  if (!body.ok) return body.response;

  const parsed = aiChatMessageSchema.safeParse(body.value);
  if (!parsed.success) return validationErrorResponse(fieldErrors(parsed.error));

  const stream = streamAiChat(gate.user, parsed.data.message);

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
