import "server-only";

import { NextResponse } from "next/server";

import { authorizeRequest, type SessionUser } from "@/lib/server/auth";
import { guardFailureResponse, guardSupportMutation } from "@/lib/server/auth-guard";
import { logUnexpectedFailure } from "@/lib/server/errors";
import { readJsonBody, validationErrorResponse } from "@/lib/server/profile";
import { SupportError } from "@/lib/server/support";
import { MAX_SUPPORT_BODY_BYTES } from "@/lib/validation/support";

/**
 * Shared entry and exit for `/api/support/**` and `/api/admin/support/**`.
 *
 * Both families start with a gate from this module — never with a middleware
 * assumption — and end with {@link supportErrorResponse}, which is the only
 * place that decides what a failure tells the client.
 */

export type SupportGate =
  | { ok: true; user: SessionUser }
  | { ok: false; response: NextResponse };

/** Any signed-in, profiled account may use the support centre. */
export async function requireSupportUser(): Promise<SupportGate> {
  const authorized = await authorizeRequest();
  return authorized.ok
    ? { ok: true, user: authorized.user }
    : { ok: false, response: authorized.response };
}

export async function requireSupportMutation(): Promise<SupportGate> {
  const gate = await requireSupportUser();
  if (!gate.ok) return gate;
  const failure = await guardSupportMutation(gate.user.id);
  if (failure) return { ok: false, response: guardFailureResponse(failure) };
  return gate;
}

export function readSupportBody(request: Request) {
  return readJsonBody(request, MAX_SUPPORT_BODY_BYTES);
}

export { validationErrorResponse };

export function supportErrorResponse(scope: string, error: unknown): NextResponse {
  if (error instanceof SupportError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }

  // The optimistic `updateMany` guard usually reports a stale write as a zero
  // count, which the service turns into SupportConflictError. A raw P2025 can
  // still surface from a nested write racing a delete; it means the same thing.
  if (typeof error === "object" && error !== null) {
    const code = (error as { code?: unknown }).code;
    if (code === "P2025") {
      return NextResponse.json(
        { error: "This ticket changed while you were working. Reload and try again." },
        { status: 409 },
      );
    }
    if (code === "P2002" || code === "23505") {
      return NextResponse.json(
        { error: "That was already recorded. Reload the page." },
        { status: 409 },
      );
    }
  }

  // Unexpected: log the complete cause (constraint, code, stack) under a
  // reference, and give the client that reference and nothing else.
  const reference = logUnexpectedFailure(`support:${scope}`, error);
  return NextResponse.json(
    {
      error:
        "Something went wrong on our end and your request was not saved. Please try again.",
      reference,
    },
    { status: 500 },
  );
}
