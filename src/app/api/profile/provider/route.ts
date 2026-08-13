import { NextResponse } from "next/server";

import { authorizeRequest } from "@/lib/server/auth";
import { CommunityRuleError } from "@/lib/community-rules";
import { buildAuditEntry } from "@/lib/server/audit";
import { db } from "@/lib/server/db";
import {
  commonProfileSelect,
  commonProfileUpdateData,
  internalErrorResponse,
  providerClaimChanges,
  providerProfileUpdateData,
  providerProfileSelect,
  readJsonBody,
  serializeCommonProfile,
  serializeProviderProfile,
  validationErrorResponse,
} from "@/lib/server/profile";
import { assertProviderCanAct } from "@/lib/server/providers-admin";
import {
  fieldErrors,
  providerFullUpdateSchema,
  providerProfileUpdateSchema,
} from "@/lib/validation/profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Only providers have — or can touch — a provider profile. */
const ALLOWED_ROLES = ["provider"] as const;

function providerWriteError(error: unknown): NextResponse | null {
  if (error instanceof CommunityRuleError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  if (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "P2025"
  ) {
    return NextResponse.json(
      { error: "Your provider account changed while you were editing. Reload and try again." },
      { status: 409 },
    );
  }
  return null;
}

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
    await assertProviderCanAct(authorized.user.id);
    const owner = await db.user.findUnique({
      where: { id: authorized.user.id },
      select: { role: true },
    });
    if (owner?.role !== "provider") {
      return NextResponse.json(
        { error: "You do not have access to this resource." },
        { status: 403 },
      );
    }

    const current = await db.providerProfile.findUnique({
      where: { userId: authorized.user.id },
      select: {
        licenseNumber: true,
        licenseState: true,
        insuranceProvider: true,
        insurancePolicyNumber: true,
        licenseVerifiedAt: true,
        insuranceVerifiedAt: true,
      },
    });
    const update = providerProfileUpdateData(current, parsed.data);
    const changes = providerClaimChanges(current, parsed.data);
    const writeProfile = db.providerProfile.update({
      where: {
        userId: authorized.user.id,
        accountStatus: { not: "suspended" },
      },
      data: update,
      select: providerProfileSelect,
    });
    const auditWrites = [
      ...(changes.licenseChanged && current?.licenseVerifiedAt
        ? [
            db.adminAuditLog.create({
              data: buildAuditEntry({
                actorUserId: null,
                action: "provider_license_revoked",
                targetType: "provider",
                targetId: authorized.user.id,
                providerUserId: authorized.user.id,
                metadata: { reason: "The provider changed the underlying licence claim." },
              }),
            }),
          ]
        : []),
      ...(changes.insuranceChanged && current?.insuranceVerifiedAt
        ? [
            db.adminAuditLog.create({
              data: buildAuditEntry({
                actorUserId: null,
                action: "provider_insurance_revoked",
                targetType: "provider",
                targetId: authorized.user.id,
                providerUserId: authorized.user.id,
                metadata: { reason: "The provider changed the underlying insurance claim." },
              }),
            }),
          ]
        : []),
    ];
    const profile =
      auditWrites.length > 0
        ? (await db.$transaction([writeProfile, ...auditWrites]))[0]
        : await writeProfile;

    return NextResponse.json(serializeProviderProfile(profile));
  } catch (error) {
    const response = providerWriteError(error);
    if (response) return response;
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
    await assertProviderCanAct(authorized.user.id);
    const [owner, currentProvider] = await Promise.all([
      db.user.findUnique({
        where: { id: authorized.user.id },
        select: { ...commonProfileSelect, address: true },
      }),
      db.providerProfile.findUnique({
        where: { userId: authorized.user.id },
        select: {
          licenseNumber: true,
          licenseState: true,
          insuranceProvider: true,
          insurancePolicyNumber: true,
          licenseVerifiedAt: true,
          insuranceVerifiedAt: true,
        },
      }),
    ]);
    if (!owner || owner.role !== "provider") {
      return NextResponse.json(
        { error: "You do not have access to this resource." },
        { status: 403 },
      );
    }

    const providerUpdate = providerProfileUpdateData(currentProvider, parsed.data.provider);
    const changes = providerClaimChanges(currentProvider, parsed.data.provider);
    const auditWrites = [
      ...(changes.licenseChanged && currentProvider?.licenseVerifiedAt
        ? [
            db.adminAuditLog.create({
              data: buildAuditEntry({
                actorUserId: null,
                action: "provider_license_revoked",
                targetType: "provider",
                targetId: authorized.user.id,
                providerUserId: authorized.user.id,
                metadata: { reason: "The provider changed the underlying licence claim." },
              }),
            }),
          ]
        : []),
      ...(changes.insuranceChanged && currentProvider?.insuranceVerifiedAt
        ? [
            db.adminAuditLog.create({
              data: buildAuditEntry({
                actorUserId: null,
                action: "provider_insurance_revoked",
                targetType: "provider",
                targetId: authorized.user.id,
                providerUserId: authorized.user.id,
                metadata: { reason: "The provider changed the underlying insurance claim." },
              }),
            }),
          ]
        : []),
    ];
    const [common, provider] = await db.$transaction([
      db.user.update({
        where: { id: authorized.user.id },
        data: commonProfileUpdateData(owner.address, parsed.data.common),
        select: commonProfileSelect,
      }),
      db.providerProfile.update({
        where: {
          userId: authorized.user.id,
          accountStatus: { not: "suspended" },
        },
        data: providerUpdate,
        select: providerProfileSelect,
      }),
      ...auditWrites,
    ]);

    return NextResponse.json({
      profile: serializeCommonProfile(common),
      provider: serializeProviderProfile(provider),
    });
  } catch (error) {
    const response = providerWriteError(error);
    if (response) return response;
    return internalErrorResponse("full provider profile update", error);
  }
}
