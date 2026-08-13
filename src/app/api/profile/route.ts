import { NextResponse } from "next/server";

import { authorizeRequest } from "@/lib/server/auth";
import { syncNeighborhoodMembership } from "@/lib/server/communities";
import { db } from "@/lib/server/db";
import {
  commonProfileSelect,
  commonProfileUpdateData,
  internalErrorResponse,
  readJsonBody,
  serializeCommonProfile,
  validationErrorResponse,
} from "@/lib/server/profile";
import { commonProfileUpdateSchema, fieldErrors } from "@/lib/validation/profile";

export const runtime = "nodejs";
/** Profile data is per-user and changes on save; never serve a cached copy. */
export const dynamic = "force-dynamic";

/** Reads the signed-in user's common profile. */
export async function GET(): Promise<NextResponse> {
  const authorized = await authorizeRequest();
  if (!authorized.ok) return authorized.response;

  try {
    const user = await db.user.findUnique({
      where: { id: authorized.user.id },
      select: commonProfileSelect,
    });

    if (!user) {
      return NextResponse.json({ error: "Profile not found." }, { status: 404 });
    }

    return NextResponse.json(serializeCommonProfile(user));
  } catch (error) {
    return internalErrorResponse("common profile read", error);
  }
}

/**
 * Updates the fields a user owns about themselves.
 *
 * The `where` clause is keyed on the id resolved from the verified session, so
 * there is no request-supplied identifier that could address another row.
 * `email`, `role`, and `isVerified` are rejected by the schema's `.strict()`
 * rather than quietly ignored.
 */
export async function PATCH(request: Request): Promise<NextResponse> {
  const authorized = await authorizeRequest();
  if (!authorized.ok) return authorized.response;

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;

  const parsed = commonProfileUpdateSchema.safeParse(body.value);
  if (!parsed.success) return validationErrorResponse(fieldErrors(parsed.error));

  try {
    const current = await db.user.findUnique({
      where: { id: authorized.user.id },
      select: { address: true },
    });
    if (!current) {
      return NextResponse.json({ error: "Profile not found." }, { status: 404 });
    }

    const user = await db.user.update({
      where: { id: authorized.user.id },
      data: commonProfileUpdateData(current.address, parsed.data),
      select: commonProfileSelect,
    });

    // A new address may put a homeowner inside a neighborhood they were not in
    // before. Best-effort and after the save: the profile change is what the
    // user asked for, and a placement failure must not report it as failed.
    // The matcher itself never moves or removes an existing membership.
    if (authorized.user.role === "homeowner") {
      try {
        await syncNeighborhoodMembership(authorized.user.id);
      } catch (error) {
        console.error("[profile] neighborhood placement failed", {
          name: error instanceof Error ? error.name : "UnknownError",
        });
      }
    }

    return NextResponse.json(serializeCommonProfile(user));
  } catch (error) {
    return internalErrorResponse("common profile update", error);
  }
}
