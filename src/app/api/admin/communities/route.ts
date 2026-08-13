import { NextResponse } from "next/server";

import {
  adminErrorResponse,
  readAdminBody,
  requireAdmin,
  requireAdminMutation,
  validationErrorResponse,
} from "@/lib/server/admin-api";
import { createCommunity, getCommunityDetail, listCommunities } from "@/lib/server/communities";
import {
  communityCreateSchema,
  communityListQuerySchema,
  searchParamsToObject,
} from "@/lib/validation/community";
import { fieldErrors } from "@/lib/validation/profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Paged, filterable community list. */
export async function GET(request: Request): Promise<NextResponse> {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.response;

  try {
    const url = new URL(request.url);
    const query = communityListQuerySchema.parse(searchParamsToObject(url.searchParams));
    return NextResponse.json(await listCommunities(query));
  } catch (error) {
    return adminErrorResponse("community list", error);
  }
}

/**
 * Creates a community.
 *
 * The response is the full detail payload rather than a bare id, so the portal
 * can navigate straight into the new community without a second round trip.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const gate = await requireAdminMutation();
  if (!gate.ok) return gate.response;

  const body = await readAdminBody(request);
  if (!body.ok) return body.response;

  const parsed = communityCreateSchema.safeParse(body.value);
  if (!parsed.success) return validationErrorResponse(fieldErrors(parsed.error));

  try {
    const communityId = await createCommunity(gate.user, parsed.data);
    const detail = await getCommunityDetail(communityId);
    return NextResponse.json(detail, { status: 201 });
  } catch (error) {
    return adminErrorResponse("community create", error);
  }
}
