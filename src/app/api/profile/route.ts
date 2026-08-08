import { NextResponse } from "next/server";

import { authorizeRequest } from "@/lib/server/auth";
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
    const user = await db.$transaction(async (tx) => {
      const current = await tx.user.findUnique({
        where: { id: authorized.user.id },
        select: { address: true },
      });
      if (!current) return null;

      return tx.user.update({
        where: { id: authorized.user.id },
        data: commonProfileUpdateData(current.address, parsed.data),
        select: commonProfileSelect,
      });
    });

    if (!user) {
      return NextResponse.json({ error: "Profile not found." }, { status: 404 });
    }

    return NextResponse.json(serializeCommonProfile(user));
  } catch (error) {
    return internalErrorResponse("common profile update", error);
  }
}
