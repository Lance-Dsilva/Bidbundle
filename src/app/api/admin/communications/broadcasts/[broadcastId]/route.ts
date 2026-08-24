import { NextResponse } from "next/server";

import {
  adminErrorResponse,
  readAdminBody,
  requireAdminPermission,
  requireAdminPermissionMutation,
  validationErrorResponse,
} from "@/lib/server/admin-api";
import {
  discardBroadcastDraft,
  getBroadcast,
  previewBroadcastAudience,
  reconcileBroadcastDelivery,
  updateBroadcastDraft,
} from "@/lib/server/communications";
import type { BroadcastSegment } from "@/lib/validation/communications";
import { broadcastDraftSchema, MAX_BROADCAST_BODY_BYTES } from "@/lib/validation/communications";
import { fieldErrors } from "@/lib/validation/profile";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ broadcastId: string }> };

export async function GET(_request: Request, context: RouteContext): Promise<NextResponse> {
  const gate = await requireAdminPermission("communications:draft");
  if (!gate.ok) return gate.response;
  const { broadcastId } = await context.params;

  try {
    // A queued broadcast is reconciled on read so the delivery summary reflects
    // what the outbox worker has actually achieved.
    const existing = await getBroadcast(broadcastId);
    if (!existing) {
      return NextResponse.json({ error: "That broadcast does not exist." }, { status: 404 });
    }
    const broadcast =
      existing.status === "queued" || existing.status === "processing"
        ? await reconcileBroadcastDelivery(broadcastId)
        : existing;

    // Recipient counts are always recalculated server-side, never echoed from
    // whatever the client last saw.
    const preview = await previewBroadcastAudience({
      audienceSegments: broadcast.audienceSegments as BroadcastSegment[],
      severity: broadcast.severity,
      overridesEmailPreference: broadcast.overridesEmailPreference,
    });

    return NextResponse.json({ broadcast, preview });
  } catch (error) {
    return adminErrorResponse("broadcast read", error);
  }
}

export async function PUT(request: Request, context: RouteContext): Promise<NextResponse> {
  const gate = await requireAdminPermissionMutation("communications:draft");
  if (!gate.ok) return gate.response;

  const body = await readAdminBody(request, MAX_BROADCAST_BODY_BYTES);
  if (!body.ok) return body.response;

  const parsed = broadcastDraftSchema.safeParse(body.value);
  if (!parsed.success) return validationErrorResponse(fieldErrors(parsed.error));

  const { broadcastId } = await context.params;

  try {
    const broadcast = await updateBroadcastDraft(gate.user.id, broadcastId, parsed.data);
    return NextResponse.json({ broadcast });
  } catch (error) {
    return adminErrorResponse("broadcast update", error);
  }
}

export async function DELETE(_request: Request, context: RouteContext): Promise<NextResponse> {
  const gate = await requireAdminPermissionMutation("communications:draft");
  if (!gate.ok) return gate.response;
  const { broadcastId } = await context.params;

  try {
    await discardBroadcastDraft(gate.user.id, broadcastId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return adminErrorResponse("broadcast discard", error);
  }
}
