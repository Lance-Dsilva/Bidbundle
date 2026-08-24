import { NextResponse } from "next/server";

import {
  adminErrorResponse,
  requireAdminPermissionMutation,
} from "@/lib/server/admin-api";
import { guardBroadcastMutation, guardFailureResponse } from "@/lib/server/auth-guard";
import { reconcileBroadcastDelivery, retryBroadcastFailures } from "@/lib/server/communications";

/**
 * Re-queues only the recipients whose delivery failed.
 *
 * Recipient rows already exist and are reused, so a retry cannot widen the
 * audience and — because each carries the same stable outbox dedupe key —
 * cannot deliver a second copy to anyone who already received one.
 */
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ broadcastId: string }> };

export async function POST(_request: Request, context: RouteContext): Promise<NextResponse> {
  const gate = await requireAdminPermissionMutation("communications:send_global");
  if (!gate.ok) return gate.response;

  const failure = await guardBroadcastMutation(gate.user.id);
  if (failure) return guardFailureResponse(failure);

  const { broadcastId } = await context.params;

  try {
    const { retried } = await retryBroadcastFailures(gate.user.id, broadcastId);
    const broadcast = await reconcileBroadcastDelivery(broadcastId);
    return NextResponse.json({ retried, broadcast });
  } catch (error) {
    return adminErrorResponse("broadcast retry", error);
  }
}
