import "server-only";

import { NextResponse } from "next/server";

import { CommunityRuleError } from "@/lib/community-rules";
import { authorizeRequest, type SessionUser } from "@/lib/server/auth";
import { guardAdminMutation, guardFailureResponse } from "@/lib/server/auth-guard";
import { readJsonBody, validationErrorResponse } from "@/lib/server/profile";
import { MAX_ADMIN_BODY_BYTES } from "@/lib/validation/community";

/**
 * Shared entry and exit for every `/api/admin/**` handler.
 *
 * Each endpoint starts with {@link requireAdmin} — never with a middleware
 * assumption — and ends with {@link adminErrorResponse}, which is the only
 * place that decides what a failure tells the client. Prisma's messages quote
 * the failing statement, so none of them reach a response body.
 */

export type AdminGate =
  | { ok: true; user: SessionUser }
  | { ok: false; response: NextResponse };

/** Read-only admin endpoints: authenticate, authorize, no limiter. */
export async function requireAdmin(): Promise<AdminGate> {
  const authorized = await authorizeRequest(["admin"]);
  if (!authorized.ok) return { ok: false, response: authorized.response };
  return { ok: true, user: authorized.user };
}

/** Mutating admin endpoints: the above, plus the per-admin write limiter. */
export async function requireAdminMutation(): Promise<AdminGate> {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;

  const failure = await guardAdminMutation(gate.user.id);
  if (failure) return { ok: false, response: guardFailureResponse(failure) };

  return gate;
}

/** Reads and parses an admin JSON body under the admin size ceiling. */
export function readAdminBody(request: Request) {
  return readJsonBody(request, MAX_ADMIN_BODY_BYTES);
}

export { validationErrorResponse };

export function notFoundResponse(message = "Not found."): NextResponse {
  return NextResponse.json({ error: message }, { status: 404 });
}

/**
 * Turns a thrown error into the response the client sees.
 *
 * A {@link CommunityRuleError} carries a message written for a human and a
 * status chosen for the rule it enforces, so it is passed through verbatim.
 * Anything else is a bug or an outage: the class name is logged, and the
 * client gets one fixed sentence with no database detail in it.
 */
export function adminErrorResponse(scope: string, error: unknown): NextResponse {
  if (error instanceof CommunityRuleError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }

  // A partial unique index rejecting a concurrent write is a real conflict,
  // not a server fault: two admins acted on the same community at once and
  // the database kept the invariant. Say so, without naming the constraint.
  if (isUniqueConstraintViolation(error)) {
    return NextResponse.json(
      {
        error:
          "Someone else changed this at the same time. Reload the page and try again.",
      },
      { status: 409 },
    );
  }

  if (isInvariantConstraintViolation(error)) {
    return NextResponse.json(
      { error: "This change conflicts with the current community state. Reload and try again." },
      { status: 409 },
    );
  }

  // Optimistic credential verification uses `updatedAt` in the update where
  // clause. Prisma reports a stale reviewed row as P2025.
  if (isStaleWrite(error)) {
    return NextResponse.json(
      { error: "This provider changed after you opened the page. Reload and review the latest details." },
      { status: 409 },
    );
  }

  console.error(`[admin] ${scope} failed`, {
    name: error instanceof Error ? error.name : "UnknownError",
  });

  return NextResponse.json(
    { error: "Something went wrong on our end. Please try again." },
    { status: 500 },
  );
}

function isStaleWrite(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  return (error as { code?: unknown }).code === "P2025";
}

function isInvariantConstraintViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as { code?: unknown; meta?: { code?: unknown } };
  return (
    candidate.code === "P2004" ||
    candidate.code === "23514" ||
    candidate.meta?.code === "23514"
  );
}

/**
 * Detects Postgres 23505 / Prisma P2002, including from the partial unique
 * indexes that Prisma does not know about and therefore reports as a raw
 * driver error rather than a typed one.
 */
function isUniqueConstraintViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as { code?: unknown; meta?: { code?: unknown } };
  return (
    candidate.code === "P2002" ||
    candidate.code === "23505" ||
    candidate.meta?.code === "23505"
  );
}
