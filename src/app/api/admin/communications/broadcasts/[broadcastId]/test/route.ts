import { NextResponse } from "next/server";

import {
  adminErrorResponse,
  requireAdminPermissionMutation,
} from "@/lib/server/admin-api";
import { guardBroadcastMutation, guardFailureResponse } from "@/lib/server/auth-guard";
import { sendBroadcastTest } from "@/lib/server/communications";

/**
 * Sends one copy of the rendered message to the requesting admin.
 *
 * The recipient is the session's own email address — the endpoint takes no
 * address at all, so "send test to me" cannot become "send test to anyone".
 */
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ broadcastId: string }> };

export async function POST(_request: Request, context: RouteContext): Promise<NextResponse> {
  const gate = await requireAdminPermissionMutation("communications:draft");
  if (!gate.ok) return gate.response;

  const failure = await guardBroadcastMutation(gate.user.id);
  if (failure) return guardFailureResponse(failure);

  const { broadcastId } = await context.params;

  try {
    await sendBroadcastTest({ id: gate.user.id, email: gate.user.email }, broadcastId);
    return NextResponse.json({ ok: true, sentTo: gate.user.email });
  } catch (error) {
    return adminErrorResponse("broadcast test", error);
  }
}
