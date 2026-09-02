import { NextResponse } from "next/server";

import { listConversations, openCustomerConversation } from "@/lib/server/conversations";
import {
  hoaErrorResponse,
  readHoaBody,
  requireHoaMutation,
  requireHoaUser,
  validationErrorResponse,
} from "@/lib/server/hoa-api";
import {
  fieldErrorsFrom,
  startCustomerConversationSchema,
} from "@/lib/validation/provider-console";

/**
 * The customer's side of their job conversations.
 *
 * The same rows the provider inbox reads, through the same participant-scoped
 * service — `listConversations` takes only the session user, and answers with
 * the threads that user is actually in.
 *
 * `POST` opens the thread for one quote on one of the caller's own requests.
 * It replaces `/api/homeowner/conversations?other_user_id=…`, which had no
 * handler and would have let a browser address any account by id.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const gate = await requireHoaUser();
  if (!gate.ok) return gate.response;

  try {
    return NextResponse.json(await listConversations(gate.user.id));
  } catch (error) {
    return hoaErrorResponse("customer inbox", error);
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const gate = await requireHoaMutation();
  if (!gate.ok) return gate.response;

  const body = await readHoaBody(request);
  if (!body.ok) return body.response;

  const parsed = startCustomerConversationSchema.safeParse(body.value);
  if (!parsed.success) return validationErrorResponse(fieldErrorsFrom(parsed.error));

  try {
    const thread = await openCustomerConversation(gate.user.id, parsed.data.bidId);
    return NextResponse.json({ thread }, { status: 201 });
  } catch (error) {
    return hoaErrorResponse("open customer conversation", error);
  }
}
