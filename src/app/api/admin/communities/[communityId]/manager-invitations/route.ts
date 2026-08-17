import { NextResponse } from "next/server";

import {
  adminErrorResponse,
  readAdminBody,
  requireAdmin,
  requireAdminMutation,
  validationErrorResponse,
} from "@/lib/server/admin-api";
import { inviteHoaManager, listHoaManagerInvitations } from "@/lib/server/hoa";
import { hoaManagerInvitationCreateSchema } from "@/lib/validation/hoa";
import { fieldErrors } from "@/lib/validation/profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ communityId: string }> };

export async function GET(_request: Request, context: RouteContext): Promise<NextResponse> {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.response;
  const { communityId } = await context.params;

  try {
    return NextResponse.json({ invitations: await listHoaManagerInvitations(communityId) });
  } catch (error) {
    return adminErrorResponse("HOA manager invitation list", error);
  }
}

export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  const gate = await requireAdminMutation();
  if (!gate.ok) return gate.response;
  const body = await readAdminBody(request);
  if (!body.ok) return body.response;
  const parsed = hoaManagerInvitationCreateSchema.safeParse(body.value);
  if (!parsed.success) return validationErrorResponse(fieldErrors(parsed.error));
  const { communityId } = await context.params;

  try {
    const invitation = await inviteHoaManager({
      actorUserId: gate.user.id,
      actorEmail: gate.user.email,
      communityId,
      email: parsed.data.email,
      requestUrl: request.url,
    });
    return NextResponse.json({ invitation }, { status: 201 });
  } catch (error) {
    return adminErrorResponse("HOA manager invitation", error);
  }
}
