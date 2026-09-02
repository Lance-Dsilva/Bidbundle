import { NextResponse } from "next/server";

import { sendConversationMessage } from "@/lib/server/conversations";
import {
  hoaErrorResponse,
  readHoaBody,
  requireHoaMutation,
  validationErrorResponse,
} from "@/lib/server/hoa-api";
import {
  conversationMessageSchema,
  fieldErrorsFrom,
} from "@/lib/validation/provider-console";

/**
 * Sends one message into a thread the caller participates in.
 *
 * The body carries text and nothing else — no sender, no recipient, no thread
 * ownership. Both parties are already columns on the conversation row, which
 * the service re-reads under the participant test before it writes.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ threadId: string }> };

export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  const gate = await requireHoaMutation();
  if (!gate.ok) return gate.response;

  const body = await readHoaBody(request);
  if (!body.ok) return body.response;

  const parsed = conversationMessageSchema.safeParse(body.value);
  if (!parsed.success) return validationErrorResponse(fieldErrorsFrom(parsed.error));

  const { threadId } = await context.params;

  try {
    const message = await sendConversationMessage(gate.user.id, threadId, parsed.data.body);
    return NextResponse.json({ message }, { status: 201 });
  } catch (error) {
    return hoaErrorResponse("send conversation message", error);
  }
}
