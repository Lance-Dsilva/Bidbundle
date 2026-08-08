import "server-only";

import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";

import { db } from "@/lib/server/db";
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
    },
  });

  if (!currentUser || !isAppRole(currentUser.role)) return null;

  return {
    id: currentUser.id,
    clerkUserId: currentUser.clerkUserId,
    email: currentUser.email,
    name: currentUser.fullName,
    role: currentUser.role,
    isVerified: currentUser.isVerified,
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

  if (!allowed.includes(user.role)) {
    redirect(DASHBOARD_BY_ROLE[user.role]);
  }

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

  const user = await findBundleenUser(userId);
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

  return { ok: true, user };
}
