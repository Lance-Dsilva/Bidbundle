import { NextResponse } from "next/server";

import {
  adminErrorResponse,
  readAdminBody,
  requireAdminPermissionMutation,
  validationErrorResponse,
} from "@/lib/server/admin-api";
import { guardBroadcastMutation, guardFailureResponse } from "@/lib/server/auth-guard";
import { sendBroadcast } from "@/lib/server/communications";
import {
  broadcastSendSchema,
  MAX_BROADCAST_BODY_BYTES,
} from "@/lib/validation/communications";
import { fieldErrors } from "@/lib/validation/profile";

/**
 * The high-risk one: real delivery to real customers.
 *
 * Three independent gates stand in front of it — the dedicated
 * `communications:send_global` permission, the per-admin rate limiter, and the
 * typed confirmation phrase validated by `broadcastSendSchema`. The service
 * then re-checks the recipient count the admin actually reviewed before it
 * queues anything.
 */
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ broadcastId: string }> };

export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  const gate = await requireAdminPermissionMutation("communications:send_global");
  if (!gate.ok) return gate.response;

  const failure = await guardBroadcastMutation(gate.user.id);
  if (failure) return guardFailureResponse(failure);

  const body = await readAdminBody(request, MAX_BROADCAST_BODY_BYTES);
  if (!body.ok) return body.response;

  const parsed = broadcastSendSchema.safeParse(body.value);
  if (!parsed.success) return validationErrorResponse(fieldErrors(parsed.error));

  const { broadcastId } = await context.params;

  try {
    const result = await sendBroadcast(
      { id: gate.user.id, email: gate.user.email },
      broadcastId,
      parsed.data,
    );
    return NextResponse.json(result);
  } catch (error) {
    return adminErrorResponse("broadcast send", error);
  }
}
