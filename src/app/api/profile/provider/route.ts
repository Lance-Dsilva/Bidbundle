import { NextResponse } from "next/server";

import { authorizeRequest } from "@/lib/server/auth";
import { db } from "@/lib/server/db";
import {
  commonProfileSelect,
  commonProfileUpdateData,
  internalErrorResponse,
  providerProfileUpdateData,
  providerProfileSelect,
  readJsonBody,
  serializeCommonProfile,
  serializeProviderProfile,
  validationErrorResponse,
} from "@/lib/server/profile";
import {
  fieldErrors,
  providerFullUpdateSchema,
  providerProfileUpdateSchema,
} from "@/lib/validation/profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Only providers have — or can touch — a provider profile. */
const ALLOWED_ROLES = ["provider"] as const;

export async function GET(): Promise<NextResponse> {
  const authorized = await authorizeRequest(ALLOWED_ROLES);
  if (!authorized.ok) return authorized.response;

  try {
    // See the homeowner handler: created on read so a pre-existing account
    // loads instead of failing at a missing row.
    const profile = await db.providerProfile.upsert({
      where: { userId: authorized.user.id },
      create: { userId: authorized.user.id },
      update: {},
      select: providerProfileSelect,
    });

    return NextResponse.json(serializeProviderProfile(profile));
  } catch (error) {
    return internalErrorResponse("provider profile read", error);
  }
}

/**
 * Updates provider-owned business details.
 *
 * Verification timestamps and payout status are not in the schema, so a body
 * claiming `licenseVerifiedAt` or `payoutStatus: "active"` is rejected outright
 * rather than partially applied.
 */
export async function PATCH(request: Request): Promise<NextResponse> {
  const authorized = await authorizeRequest(ALLOWED_ROLES);
  if (!authorized.ok) return authorized.response;

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;

  const parsed = providerProfileUpdateSchema.safeParse(body.value);
  if (!parsed.success) return validationErrorResponse(fieldErrors(parsed.error));

  try {
    const profile = await db.$transaction(async (tx) => {
      const owner = await tx.user.findUnique({
        where: { id: authorized.user.id },
        select: { role: true },
      });
      if (owner?.role !== "provider") return null;

      const current = await tx.providerProfile.findUnique({
        where: { userId: authorized.user.id },
        select: {
          licenseNumber: true,
          licenseState: true,
          insuranceProvider: true,
          insurancePolicyNumber: true,
        },
      });
      const update = providerProfileUpdateData(current, parsed.data);

      return tx.providerProfile.upsert({
        where: { userId: authorized.user.id },
        create: { userId: authorized.user.id, ...update },
        update,
        select: providerProfileSelect,
      });
    });

    if (!profile) {
      return NextResponse.json(
        { error: "You do not have access to this resource." },
        { status: 403 },
      );
    }

    return NextResponse.json(serializeProviderProfile(profile));
  } catch (error) {
    return internalErrorResponse("provider profile update", error);
  }
}

/** Atomically saves both halves of the provider profile edit form. */
export async function PUT(request: Request): Promise<NextResponse> {
  const authorized = await authorizeRequest(ALLOWED_ROLES);
  if (!authorized.ok) return authorized.response;

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;

  const parsed = providerFullUpdateSchema.safeParse(body.value);
  if (!parsed.success) return validationErrorResponse(fieldErrors(parsed.error));

  try {
    const saved = await db.$transaction(async (tx) => {
      const owner = await tx.user.findUnique({
        where: { id: authorized.user.id },
        select: { ...commonProfileSelect, address: true },
      });
      if (!owner || owner.role !== "provider") return null;

      const currentProvider = await tx.providerProfile.findUnique({
        where: { userId: authorized.user.id },
        select: {
          licenseNumber: true,
          licenseState: true,
          insuranceProvider: true,
          insurancePolicyNumber: true,
        },
      });

      const common = await tx.user.update({
        where: { id: authorized.user.id },
        data: commonProfileUpdateData(owner.address, parsed.data.common),
        select: commonProfileSelect,
      });
      const providerUpdate = providerProfileUpdateData(currentProvider, parsed.data.provider);
      const provider = await tx.providerProfile.upsert({
        where: { userId: authorized.user.id },
        create: { userId: authorized.user.id, ...providerUpdate },
        update: providerUpdate,
        select: providerProfileSelect,
      });

      return { common, provider };
    });

    if (!saved) {
      return NextResponse.json(
        { error: "You do not have access to this resource." },
        { status: 403 },
      );
    }

    return NextResponse.json({
      profile: serializeCommonProfile(saved.common),
      provider: serializeProviderProfile(saved.provider),
    });
  } catch (error) {
    return internalErrorResponse("full provider profile update", error);
  }
}
