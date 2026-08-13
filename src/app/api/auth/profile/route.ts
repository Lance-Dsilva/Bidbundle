import { auth, currentUser } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

import { guardFailureResponse, guardRegistration } from "@/lib/server/auth-guard";
import { db } from "@/lib/server/db";
import { providerProfileUpdateData } from "@/lib/server/profile";
import { DASHBOARD_BY_ROLE, MAX_AUTH_BODY_BYTES, normalizeEmail } from "@/lib/validation/auth";
import { onboardingProfileSchema } from "@/lib/validation/profile";

export const runtime = "nodejs";

const UNIQUE_VIOLATION = "P2002";
const TRANSIENT_DATABASE_CODES = new Set(["P1001", "P1002", "P2024", "P2028"]);
type PersistenceStage = "user" | "homeowner" | "provider";

function prismaCode(error: unknown, depth = 0): string | undefined {
  if (depth > 3 || typeof error !== "object" || error === null) return undefined;
  if ("code" in error && typeof (error as { code?: unknown }).code === "string") {
    return (error as { code: string }).code;
  }
  return "cause" in error
    ? prismaCode((error as { cause?: unknown }).cause, depth + 1)
    : undefined;
}

function hasPrismaCode(error: unknown, code: string): boolean {
  return prismaCode(error) === code;
}

function isDatabaseConfigurationError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message === "Neither DATABASE_URL nor DIRECT_URL is set."
  );
}

/**
 * Creates or refreshes the Bundleen profile for an already authenticated
 * Clerk identity. Credentials, verification codes, and session tokens never
 * enter this endpoint; Clerk owns all of them.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const failure = await guardRegistration(userId);
  if (failure) return guardFailureResponse(failure);

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return NextResponse.json({ error: "Expected application/json." }, { status: 415 });
  }

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_AUTH_BODY_BYTES) {
    return NextResponse.json({ error: "Request body is too large." }, { status: 413 });
  }

  let payload: unknown;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).length > MAX_AUTH_BODY_BYTES) {
      return NextResponse.json({ error: "Request body is too large." }, { status: 413 });
    }
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = onboardingProfileSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Please check the highlighted fields.",
        fields: parsed.error.issues.reduce<Record<string, string>>((acc, issue) => {
          const field = issue.path[0];
          if (typeof field === "string" && !acc[field]) acc[field] = issue.message;
          return acc;
        }, {}),
      },
      { status: 400 },
    );
  }

  const identity = await currentUser();
  if (!identity || identity.id !== userId) {
    return NextResponse.json(
      { error: "We could not read your Clerk profile. Please sign in again." },
      { status: 401 },
    );
  }

  const primaryEmail =
    identity.primaryEmailAddress ?? identity.emailAddresses.find((address) => address.emailAddress);
  if (!primaryEmail?.emailAddress) {
    return NextResponse.json(
      { error: "Add an email address to your Clerk account before continuing." },
      { status: 400 },
    );
  }

  const email = normalizeEmail(primaryEmail.emailAddress);
  const fullName =
    parsed.data.fullName?.trim() ||
    identity.fullName ||
    [identity.firstName, identity.lastName].filter(Boolean).join(" ") ||
    email.split("@")[0];
  const phone = parsed.data.phone ?? identity.primaryPhoneNumber?.phoneNumber ?? null;
  const isVerified = primaryEmail.verification?.status === "verified";

  // The address and coordinates the browser collected. Approximate and
  // user-grantable — a matching hint, never proof of residence.
  //
  const { address, neighborhood, latitude, longitude } = parsed.data;
  const hasCoordinates = typeof latitude === "number" && typeof longitude === "number";
  const location = {
    // Address is required by the schema's cross-field validation. If the
    // browser has no position for it, explicitly clear any old coordinates so
    // a typed address can never retain a stale GPS point.
    address: address ?? null,
    ...(neighborhood !== undefined ? { neighborhood } : {}),
    ...(hasCoordinates
      ? { latitude, longitude }
      : { latitude: null, longitude: null }),
  };

  let persistenceStage: PersistenceStage = "user";

  try {
    let user: { id: string; role: "homeowner" | "provider" | "admin" } | undefined;
    let lastError: unknown;

    // Neon can briefly be unavailable while a suspended compute wakes, and a
    // serverless pool can transiently exhaust its checkout window. The entire
    // operation is idempotent, so one bounded retry is safe.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      persistenceStage = "user";
      try {
        user = await db.$transaction(async (tx) => {
          const saved = await tx.user.upsert({
            where: { clerkUserId: userId },
            create: {
              clerkUserId: userId,
              email,
              fullName,
              phone,
              role: parsed.data.role,
              isVerified,
              ...location,
            },
            update: {
              email,
              fullName,
              phone,
              isVerified,
              ...location,
            },
            // Role comes from the row, not the request: a returning user keeps the
            // role they already have rather than switching by resubmitting.
            select: { id: true, role: true },
          });

          // The role profile is created alongside the user so nothing downstream
          // has to cope with a homeowner who has no homeowner record.
          if (saved.role === "homeowner") {
            persistenceStage = "homeowner";
            await tx.homeownerProfile.upsert({
              where: { userId: saved.id },
              create: { userId: saved.id },
              update: {},
              select: { id: true },
            });
          } else if (saved.role === "provider") {
            persistenceStage = "provider";
            // Only what the applicant claims. No verification flag is written here
            // — `licenseVerifiedAt` and `insuranceVerifiedAt` stay admin-only.
            //
            // Keys the form omitted are dropped rather than sent as `null`, so
            // re-running onboarding cannot blank details saved on the profile
            // screen since.
            const claims = parsed.data.providerBusiness ?? {};
            const currentClaims = await tx.providerProfile.findUnique({
              where: { userId: saved.id },
              select: {
                licenseNumber: true,
                licenseState: true,
                insuranceProvider: true,
                insurancePolicyNumber: true,
              },
            });
            const providerUpdate = providerProfileUpdateData(currentClaims, claims);

            await tx.providerProfile.upsert({
              where: { userId: saved.id },
              create: { userId: saved.id, ...providerUpdate },
              update: providerUpdate,
              select: { id: true },
            });
          }

          return saved;
        });
        break;
      } catch (error) {
        lastError = error;
        const code = prismaCode(error);
        if (attempt === 0 && code && TRANSIENT_DATABASE_CODES.has(code)) continue;
        throw error;
      }
    }

    if (!user) throw lastError ?? new Error("Profile persistence did not return a user.");

    return NextResponse.json({
      profileReady: true,
      role: user.role,
      redirectTo: DASHBOARD_BY_ROLE[user.role],
    });
  } catch (error) {
    if (hasPrismaCode(error, UNIQUE_VIOLATION)) {
      return NextResponse.json(
        { error: "That email is already linked to another Bundleen profile." },
        { status: 409 },
      );
    }

    if (isDatabaseConfigurationError(error)) {
      console.error("[auth] Profile database connection is not configured.");
      return NextResponse.json(
        { error: "Profile storage is not configured for this deployment." },
        { status: 503 },
      );
    }

    const code = prismaCode(error);
    const reference = `PROFILE-${persistenceStage.toUpperCase()}-${code ?? "UNKNOWN"}`;

    console.error("[auth] Clerk profile synchronization failed", {
      name: error instanceof Error ? error.name : "UnknownError",
      // Prisma error codes identify the failed operation category without
      // logging query parameters such as email addresses or home addresses.
      code,
      stage: persistenceStage,
      reference,
    });
    return NextResponse.json(
      {
        error: `We could not finish your Bundleen profile. Please try again. Reference: ${reference}.`,
      },
      { status: code && TRANSIENT_DATABASE_CODES.has(code) ? 503 : 500 },
    );
  }
}
