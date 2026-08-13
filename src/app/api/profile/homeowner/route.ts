import { NextResponse } from "next/server";

import { authorizeRequest } from "@/lib/server/auth";
import { db } from "@/lib/server/db";
import {
  homeownerProfileSelect,
  internalErrorResponse,
  readJsonBody,
  serializeHomeownerProfile,
  validationErrorResponse,
} from "@/lib/server/profile";
import { fieldErrors, homeownerProfileUpdateSchema } from "@/lib/validation/profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Only homeowners have — or can touch — a homeowner profile. */
const ALLOWED_ROLES = ["homeowner"] as const;

export async function GET(): Promise<NextResponse> {
  const authorized = await authorizeRequest(ALLOWED_ROLES);
  if (!authorized.ok) return authorized.response;

  try {
    // Created on read when absent: an account that predates this table, or one
    // whose role was changed by an admin, should still load its dashboard
    // rather than 404 at a row the user never had a chance to create.
    const profile = await db.homeownerProfile.upsert({
      where: { userId: authorized.user.id },
      create: { userId: authorized.user.id },
      update: {},
      select: homeownerProfileSelect,
    });

    return NextResponse.json(serializeHomeownerProfile(profile));
  } catch (error) {
    return internalErrorResponse("homeowner profile read", error);
  }
}

export async function PATCH(request: Request): Promise<NextResponse> {
  const authorized = await authorizeRequest(ALLOWED_ROLES);
  if (!authorized.ok) return authorized.response;

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;

  const parsed = homeownerProfileUpdateSchema.safeParse(body.value);
  if (!parsed.success) return validationErrorResponse(fieldErrors(parsed.error));

  try {
    const owner = await db.user.findUnique({
      where: { id: authorized.user.id },
      select: { role: true },
    });
    if (owner?.role !== "homeowner") {
      return NextResponse.json(
        { error: "You do not have access to this resource." },
        { status: 403 },
      );
    }

    const profile = await db.homeownerProfile.upsert({
      where: { userId: authorized.user.id },
      create: { userId: authorized.user.id, ...parsed.data },
      update: parsed.data,
      select: homeownerProfileSelect,
    });

    return NextResponse.json(serializeHomeownerProfile(profile));
  } catch (error) {
    return internalErrorResponse("homeowner profile update", error);
  }
}
