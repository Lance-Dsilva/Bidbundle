import { NextResponse } from "next/server";

import {
  readAdminBody,
  requireAdminMutation,
  validationErrorResponse,
} from "@/lib/server/admin-api";
import { createAdminProviderTicket } from "@/lib/server/support";
import { supportErrorResponse } from "@/lib/server/support-api";
import { fieldErrors } from "@/lib/validation/profile";
import { adminProviderTicketCreateSchema } from "@/lib/validation/support";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ userId: string }> };

/**
 * Bundleen starts a provider-facing support conversation.
 *
 * The provider comes only from the path and the sender only from the verified
 * admin session. A request body cannot impersonate either side or assign the
 * ticket to a different administrator.
 */
export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  const gate = await requireAdminMutation();
  if (!gate.ok) return gate.response;

  const body = await readAdminBody(request);
  if (!body.ok) return body.response;

  const parsed = adminProviderTicketCreateSchema.safeParse(body.value);
  if (!parsed.success) return validationErrorResponse(fieldErrors(parsed.error));

  const { userId } = await context.params;
  try {
    const ticket = await createAdminProviderTicket(
      { id: gate.user.id, name: gate.user.name },
      userId,
      parsed.data,
    );
    return NextResponse.json({ ticket }, { status: 201 });
  } catch (error) {
    return supportErrorResponse("admin provider ticket create", error);
  }
}
