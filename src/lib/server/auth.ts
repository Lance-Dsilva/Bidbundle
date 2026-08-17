import "server-only";

import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";

import { db } from "@/lib/server/db";
import { isHoaManager } from "@/lib/server/hoa";
import { DASHBOARD_BY_ROLE, isAppRole, type AppRole } from "@/lib/validation/auth";

/**
 * The only place the application decides who a request belongs to and what
 * they may do.
 *
 * Middleware is an optimisation, not a control — it can be bypassed by any
 * request that reaches a handler through a path its matcher misses. Every
 * protected page and every write endpoint calls into this module, so
 * authorization does not depend on the middleware having run.
 */

export type SessionUser = {
  /** Bundleen database id used by application records and relationships. */
  id: string;
  /** Clerk identity id used only to map the verified session to this profile. */
  clerkUserId: string;
  email: string;
  name: string | null;
  role: AppRole;
  isVerified: boolean;
  /** Present only for an active, database-backed admin allow-list entry. */
  adminAccessLevel: "owner" | "admin" | null;
};

async function findBundleenUser(clerkUserId: string): Promise<SessionUser | null> {
  const currentUser = await db.user.findUnique({
    where: { clerkUserId },
    select: {
      id: true,
      clerkUserId: true,
      email: true,
      fullName: true,
      role: true,
      isVerified: true,
      adminAccess: {
        select: { email: true, level: true, status: true },
      },
    },
  });

  if (!currentUser || !isAppRole(currentUser.role)) return null;

  const adminAccess =
    currentUser.role === "admin" &&
    currentUser.isVerified &&
    currentUser.adminAccess?.status === "active" &&
    currentUser.adminAccess.email === currentUser.email.toLowerCase()
      ? currentUser.adminAccess.level
      : null;

  return {
    id: currentUser.id,
    clerkUserId: currentUser.clerkUserId,
    email: currentUser.email,
    name: currentUser.fullName,
    role: currentUser.role,
    isVerified: currentUser.isVerified,
    adminAccessLevel: adminAccess,
  };
}

/**
 * Reads the verified Clerk session and resolves its live Bundleen profile.
 * Clerk proves identity; the database remains authoritative for application
 * roles so a deleted or demoted user loses access on the next request.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const { userId } = await auth();
  if (!userId) return null;
  return findBundleenUser(userId);
}

/* ── Page (Server Component) guards ── */

/**
 * Requires any signed-in user, otherwise redirects to sign-in with a
 * `redirect_url` so the user lands back where they were headed.
 */
export async function requireUser(callbackPath?: string): Promise<SessionUser> {
  const { userId } = await auth();

  if (!userId) {
    const target = callbackPath
      ? `/sign-in?redirect_url=${encodeURIComponent(callbackPath)}`
      : "/sign-in";
    redirect(target);
  }

  const user = await findBundleenUser(userId);
  if (!user) redirect("/get-started/profile");

  return user;
}

/**
 * Requires one of `allowed`.
 *
 * A signed-in user with the wrong role is sent to their own dashboard rather
 * than shown a forbidden page — for this app that is the useful destination,
 * and it avoids confirming that the page they tried exists.
 */
export async function requireRole(
  allowed: readonly AppRole[],
  callbackPath?: string,
): Promise<SessionUser> {
  const user = await requireUser(callbackPath);

  // `admin` in the legacy role column is not sufficient. Portal access also
  // requires an active email grant, so a stale/manual role edit fails closed.
  if (allowed.includes("admin") && user.role === "admin" && !user.adminAccessLevel) {
    redirect("/admin/access-denied");
  }

  if (!allowed.includes(user.role)) {
    redirect(DASHBOARD_BY_ROLE[user.role]);
  }

  return user;
}

/**
 * Page guard for the dedicated HOA operations portal. The global homeowner
 * role is intentionally insufficient: access exists only while a live,
 * community-scoped `hoa_manager` assignment exists in the database.
 */
export async function requireHoaManager(callbackPath = "/app/hoa/dashboard"): Promise<SessionUser> {
  const user = await requireRole(["homeowner"], callbackPath);
  if (!(await isHoaManager(user.id))) redirect("/app/homeowner/dashboard");
  return user;
}

/* ── Route Handler (API) guards ── */

/**
 * API counterpart of {@link requireUser}. Returns either the user or the
 * `401`/`403` response to send — never redirects, since an API client cannot
 * follow one usefully.
 *
 * Every future write handler is expected to start with this call:
 *
 * ```ts
 * const result = await authorizeRequest(["homeowner"]);
 * if (!result.ok) return result.response;
 * ```
 */
export type AuthorizeResult =
  | { ok: true; user: SessionUser }
  | { ok: false; response: NextResponse };

export async function authorizeRequest(
  allowed?: readonly AppRole[],
): Promise<AuthorizeResult> {
  const { userId } = await auth();

  if (!userId) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Authentication required." }, { status: 401 }),
    };
  }

  // The profile lookup is a database call, so it can fail for reasons that
  // have nothing to do with the caller. Handled here rather than left to throw,
  // so an outage answers with a generic 500 instead of an unhandled rejection.
  let user: SessionUser | null;
  try {
    user = await findBundleenUser(userId);
  } catch (error) {
    console.error("[auth] session profile lookup failed", {
      name: error instanceof Error ? error.name : "UnknownError",
    });
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Something went wrong on our end. Please try again." },
        { status: 500 },
      ),
    };
  }

  if (!user) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Complete your Bundleen profile before continuing." },
        { status: 409 },
      ),
    };
  }

  if (allowed && !allowed.includes(user.role)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "You do not have access to this resource." },
        { status: 403 },
      ),
    };
  }

  if (allowed?.includes("admin") && user.role === "admin" && !user.adminAccessLevel) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "This account does not have active Bundleen admin access." },
        { status: 403 },
      ),
    };
  }

  return { ok: true, user };
}
