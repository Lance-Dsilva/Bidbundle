import { NextResponse } from "next/server";

import { listConversations, openProviderConversation } from "@/lib/server/conversations";
import { hoaErrorResponse, validationErrorResponse } from "@/lib/server/hoa-api";
import {
  readProviderConsoleBody,
  requireProviderConsole,
  requireProviderConsoleMutation,
} from "@/lib/server/provider-api";
import {
  fieldErrorsFrom,
  startConversationSchema,
} from "@/lib/validation/provider-console";

/**
 * The provider's job conversations.
 *
 * `GET` lists the threads this account participates in. `POST` opens the
 * thread for one request the provider has quoted — it names a *request*, never
 * a person, so there is no body field that could address a stranger. The old
 * `/provider/conversations?other_user_id=…` contract did exactly that, and is
 * gone.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const gate = await requireProviderConsole();
  if (!gate.ok) return gate.response;

  try {
    return NextResponse.json(await listConversations(gate.user.id));
  } catch (error) {
    return hoaErrorResponse("provider inbox", error);
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const gate = await requireProviderConsoleMutation();
  if (!gate.ok) return gate.response;

  const body = await readProviderConsoleBody(request);
  if (!body.ok) return body.response;

  const parsed = startConversationSchema.safeParse(body.value);
  if (!parsed.success) return validationErrorResponse(fieldErrorsFrom(parsed.error));

  try {
    const thread = await openProviderConversation(gate.user.id, parsed.data.requestId);
    return NextResponse.json({ thread }, { status: 201 });
  } catch (error) {
    return hoaErrorResponse("open provider conversation", error);
  }
}
