import { NextResponse } from "next/server";

import {
  adminErrorResponse,
  readAdminBody,
  requireAdmin,
  requireAdminMutation,
  validationErrorResponse,
} from "@/lib/server/admin-api";
import {
  getHoaProfile,
  setHoaOnboardingStatus,
  upsertHoaProfile,
} from "@/lib/server/hoa-units";
import { hoaOnboardingStatusSchema, hoaProfileSchema } from "@/lib/validation/hoa";
import { fieldErrors } from "@/lib/validation/profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ communityId: string }> };

export async function GET(_request: Request, context: RouteContext): Promise<NextResponse> {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.response;
  const { communityId } = await context.params;

  try {
    return NextResponse.json({ profile: await getHoaProfile(communityId) });
  } catch (error) {
    return adminErrorResponse("HOA profile read", error);
  }
}

export async function PUT(request: Request, context: RouteContext): Promise<NextResponse> {
  const gate = await requireAdminMutation();
  if (!gate.ok) return gate.response;
  const body = await readAdminBody(request);
  if (!body.ok) return body.response;
  const parsed = hoaProfileSchema.safeParse(body.value);
  if (!parsed.success) return validationErrorResponse(fieldErrors(parsed.error));
  const { communityId } = await context.params;

  try {
    const profile = await upsertHoaProfile(gate.user.id, communityId, parsed.data);
    return NextResponse.json({ profile });
  } catch (error) {
    return adminErrorResponse("HOA profile update", error);
  }
}

export async function PATCH(request: Request, context: RouteContext): Promise<NextResponse> {
  const gate = await requireAdminMutation();
  if (!gate.ok) return gate.response;
  const body = await readAdminBody(request);
  if (!body.ok) return body.response;
  const parsed = hoaOnboardingStatusSchema.safeParse(body.value);
  if (!parsed.success) return validationErrorResponse(fieldErrors(parsed.error));
  const { communityId } = await context.params;

  try {
    await setHoaOnboardingStatus(gate.user.id, communityId, parsed.data);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return adminErrorResponse("HOA onboarding status", error);
  }
}
