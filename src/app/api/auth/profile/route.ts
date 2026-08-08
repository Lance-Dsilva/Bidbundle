import { auth, currentUser } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

import { guardFailureResponse, guardRegistration } from "@/lib/server/auth-guard";
import { db } from "@/lib/server/db";
import {
  DASHBOARD_BY_ROLE,
  MAX_AUTH_BODY_BYTES,
  normalizeEmail,
  profileSetupSchema,
} from "@/lib/validation/auth";

export const runtime = "nodejs";

const UNIQUE_VIOLATION = "P2002";

function hasPrismaCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
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

  const failure = await guardRegistration(request);
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

  const parsed = profileSetupSchema.safeParse(payload);
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

  try {
    const user = await db.user.upsert({
      where: { clerkUserId: userId },
      create: {
        clerkUserId: userId,
        email,
        fullName,
        phone,
        role: parsed.data.role,
        isVerified,
      },
      update: {
        email,
        fullName,
        phone,
        isVerified,
      },
      select: { role: true },
    });

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

    console.error("[auth] Clerk profile synchronization failed", {
      name: error instanceof Error ? error.name : "UnknownError",
    });
    return NextResponse.json(
      { error: "We could not finish your Bundleen profile. Please try again." },
      { status: 500 },
    );
  }
}
