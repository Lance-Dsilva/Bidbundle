import { NextResponse } from "next/server";

import {
  adminErrorResponse,
  notFoundResponse,
  readAdminBody,
  requireAdmin,
  requireAdminMutation,
  validationErrorResponse,
} from "@/lib/server/admin-api";
import { getProviderDetail, updateProviderAdministration } from "@/lib/server/providers-admin";
import { providerAdminUpdateSchema } from "@/lib/validation/community";
import { fieldErrors } from "@/lib/validation/profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ userId: string }> };

export async function GET(_request: Request, context: RouteContext): Promise<NextResponse> {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.response;

  const { userId } = await context.params;

  try {
    const detail = await getProviderDetail(userId, { includeCredentials: !gate.user.adminIsStaffAccount });
    if (!detail) return notFoundResponse("That provider account no longer exists.");
    return NextResponse.json(detail);
  } catch (error) {
    return adminErrorResponse("provider detail", error);
  }
}

/**
 * Sets provider account status and licence/insurance verification.
 *
 * These are the fields the provider is barred from writing about themselves —
 * `providerProfileUpdateSchema` has no member for any of them. Verification is
 * asked for as an intent, and the timestamp is taken from this server's clock,
 * so a credential check can never be backdated by a request body.
 *
 * Sending a state the provider is already in returns `200` and writes nothing,
 * which is what makes a double-submitted suspension safe.
 */
export async function PATCH(request: Request, context: RouteContext): Promise<NextResponse> {
  const gate = await requireAdminMutation();
  if (!gate.ok) return gate.response;

  const { userId } = await context.params;

  const body = await readAdminBody(request);
  if (!body.ok) return body.response;

  const parsed = providerAdminUpdateSchema.safeParse(body.value);
  if (!parsed.success) return validationErrorResponse(fieldErrors(parsed.error));
  if (gate.user.adminIsStaffAccount && (parsed.data.license || parsed.data.insurance)) {
    return NextResponse.json({ error: "Private credential review requires administrator access." }, { status: 403 });
  }

  try {
    const { changed } = await updateProviderAdministration(gate.user, userId, parsed.data);
    const detail = await getProviderDetail(userId, { includeCredentials: !gate.user.adminIsStaffAccount });
    if (!detail) return notFoundResponse("That provider account no longer exists.");
    return NextResponse.json({ ...detail, changed });
  } catch (error) {
    return adminErrorResponse("provider update", error);
  }
}
