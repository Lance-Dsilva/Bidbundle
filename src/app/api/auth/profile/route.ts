import { auth, currentUser } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

import { guardFailureResponse, guardRegistration } from "@/lib/server/auth-guard";
import { syncNeighborhoodMembership } from "@/lib/server/communities";
import { db } from "@/lib/server/db";
import { providerProfileUpdateData } from "@/lib/server/profile";
import { DASHBOARD_BY_ROLE, MAX_AUTH_BODY_BYTES, normalizeEmail } from "@/lib/validation/auth";
import { onboardingProfileSchema } from "@/lib/validation/profile";

export const runtime = "nodejs";

const UNIQUE_VIOLATION = "P2002";
const TRANSIENT_DATABASE_CODES = new Set(["P1001", "P1002", "P2024", "P2028"]);
type PersistenceStage = "user" | "homeowner" | "provider";

class SuspendedProviderError extends Error {}

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
 * Matches a homeowner to a neighborhood community, if one contains them.
 *
 * Deliberately best-effort. The profile is already saved by this point, and a
 * community placement failing is not a reason to tell someone their signup did
 * not work — an admin can place them by hand, and the next address change
 * tries again.
 */
async function placeInNeighborhood(userId: string): Promise<void> {
  try {
    await syncNeighborhoodMembership(userId);
  } catch (error) {
    console.error("[auth] neighborhood placement failed", {
      name: error instanceof Error ? error.name : "UnknownError",
    });
  }
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

    // Use one nested write rather than an interactive transaction. Prisma can
    // send this as a dependent atomic mutation without holding a serverless
    // connection open between JavaScript callbacks — the operation that was
    // failing with P2028 on the deployed Neon pool.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      persistenceStage = "user";
      try {
        const existing = await db.user.findUnique({
          where: { clerkUserId: userId },
          select: {
            role: true,
            providerProfile: {
              select: {
                accountStatus: true,
                licenseNumber: true,
                licenseState: true,
                insuranceProvider: true,
                insurancePolicyNumber: true,
              },
            },
          },
        });

        // A returning user retains the authorization role already stored in
        // Bundleen. New users receive the role chosen during this signup.
        const effectiveRole = existing?.role ?? parsed.data.role;
        if (
          effectiveRole === "provider" &&
          existing?.providerProfile?.accountStatus === "suspended"
        ) {
          throw new SuspendedProviderError();
        }
        persistenceStage =
          effectiveRole === "homeowner" || effectiveRole === "provider"
            ? effectiveRole
            : "user";

        const providerUpdate =
          effectiveRole === "provider"
            ? existing
              ? {}
              : providerProfileUpdateData(null, parsed.data.providerBusiness ?? {})
            : null;

        user = await db.user.upsert({
          where: { clerkUserId: userId },
          create: {
            clerkUserId: userId,
            email,
            fullName,
            phone,
            role: effectiveRole,
            isVerified,
            ...location,
            ...(effectiveRole === "homeowner"
              ? { homeownerProfile: { create: {} } }
              : effectiveRole === "provider"
                ? { providerProfile: { create: providerUpdate ?? {} } }
                : {}),
          },
          update: {
            email,
            fullName,
            phone,
            isVerified,
            ...location,
            ...(effectiveRole === "homeowner"
              ? { homeownerProfile: { upsert: { create: {}, update: {} } } }
              : effectiveRole === "provider"
                ? {
                    providerProfile: {
                      upsert: {
                        create: providerUpdate ?? {},
                        update: providerUpdate ?? {},
                      },
                    },
                  }
                : {}),
          },
          select: { id: true, role: true },
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

    if (user.role === "homeowner") await placeInNeighborhood(user.id);

    return NextResponse.json({
      profileReady: true,
      role: user.role,
      redirectTo: DASHBOARD_BY_ROLE[user.role],
    });
  } catch (error) {
    if (error instanceof SuspendedProviderError) {
      return NextResponse.json(
        { error: "This provider account is suspended. Contact Bundleen support to restore it." },
        { status: 403 },
      );
    }
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
