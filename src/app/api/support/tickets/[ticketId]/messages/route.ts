import { NextResponse } from "next/server";

import { addCustomerReply } from "@/lib/server/support";
import {
  readSupportBody,
  requireSupportMutation,
  supportErrorResponse,
  validationErrorResponse,
} from "@/lib/server/support-api";
import { fieldErrors } from "@/lib/validation/profile";
import { customerReplySchema } from "@/lib/validation/support";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ ticketId: string }> };

export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  const gate = await requireSupportMutation();
  if (!gate.ok) return gate.response;

  const body = await readSupportBody(request);
  if (!body.ok) return body.response;

  const parsed = customerReplySchema.safeParse(body.value);
  if (!parsed.success) return validationErrorResponse(fieldErrors(parsed.error));

  const { ticketId } = await context.params;

  try {
    const ticket = await addCustomerReply(gate.user.id, ticketId, parsed.data);
    return NextResponse.json({ ticket }, { status: 201 });
  } catch (error) {
    return supportErrorResponse("customer reply", error);
  }
}
