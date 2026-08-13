import { NextResponse } from "next/server";

import {
  adminErrorResponse,
  readAdminBody,
  requireAdminMutation,
  validationErrorResponse,
} from "@/lib/server/admin-api";
import { addMember, getCommunityDetail } from "@/lib/server/communities";
import { membershipCreateSchema } from "@/lib/validation/community";
import { fieldErrors } from "@/lib/validation/profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ communityId: string }> };

/**
 * Adds a homeowner to a community, or revives a removed membership.
 *
 * Idempotent: the community/user pair is unique, so the same submit sent twice
 * lands on the same row. The response is `200` for an existing membership and
 * `201` for a new one, which lets the portal tell "added" from "already there"
 * without inspecting the payload.
 */
export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  const gate = await requireAdminMutation();
  if (!gate.ok) return gate.response;

  const { communityId } = await context.params;

  const body = await readAdminBody(request);
  if (!body.ok) return body.response;

  const parsed = membershipCreateSchema.safeParse(body.value);
  if (!parsed.success) return validationErrorResponse(fieldErrors(parsed.error));

  try {
    const { alreadyMember } = await addMember(gate.user, communityId, parsed.data);
    return NextResponse.json(await getCommunityDetail(communityId), {
      status: alreadyMember ? 200 : 201,
    });
  } catch (error) {
    return adminErrorResponse("member add", error);
  }
}
