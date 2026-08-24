import { NextResponse } from "next/server";

import {
  adminErrorResponse,
  readAdminBody,
  requireAdminPermission,
  requireAdminPermissionMutation,
  validationErrorResponse,
} from "@/lib/server/admin-api";
import { createBroadcastDraft, listBroadcasts } from "@/lib/server/communications";
import { broadcastDraftSchema, MAX_BROADCAST_BODY_BYTES } from "@/lib/validation/communications";
import { fieldErrors } from "@/lib/validation/profile";

/**
 * Broadcast composition and history.
 *
 * Drafting needs `communications:draft`; delivery needs the separate, stronger
 * `communications:send_global` (see the `send` route). Ordinary portal access
 * grants neither.
 */
export const runtime = "nodejs";

export async function GET(request: Request): Promise<NextResponse> {
  const gate = await requireAdminPermission("communications:draft");
  if (!gate.ok) return gate.response;

  const search = new URL(request.url).searchParams.get("search")?.trim() || undefined;

  try {
    return NextResponse.json({
      broadcasts: await listBroadcasts({ search }),
      // The UI hides the send control entirely rather than offering a button
      // that will 403.
      canSendGlobal: gate.user.adminPermissions.includes("communications:send_global") ||
        gate.user.adminAccessLevel === "owner",
    });
  } catch (error) {
    return adminErrorResponse("broadcast list", error);
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const gate = await requireAdminPermissionMutation("communications:draft");
  if (!gate.ok) return gate.response;

  const body = await readAdminBody(request, MAX_BROADCAST_BODY_BYTES);
  if (!body.ok) return body.response;

  const parsed = broadcastDraftSchema.safeParse(body.value);
  if (!parsed.success) return validationErrorResponse(fieldErrors(parsed.error));

  try {
    const broadcast = await createBroadcastDraft(gate.user.id, parsed.data);
    return NextResponse.json({ broadcast }, { status: 201 });
  } catch (error) {
    return adminErrorResponse("broadcast create", error);
  }
}
