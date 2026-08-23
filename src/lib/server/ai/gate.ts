import "server-only";

import { NextResponse } from "next/server";

import { authorizeRequest, type SessionUser } from "@/lib/server/auth";
import { guardAiChat, guardFailureResponse } from "@/lib/server/auth-guard";
import { readJsonBody, validationErrorResponse } from "@/lib/server/profile";

export type AiGate = { ok: true; user: SessionUser } | { ok: false; response: NextResponse };

const MAX_AI_BODY_BYTES = 4 * 1024;

/** Any signed-in, profiled user — homeowner, provider, or admin. */
export async function requireAiUser(): Promise<AiGate> {
  const authorized = await authorizeRequest();
  return authorized.ok
    ? { ok: true, user: authorized.user }
    : { ok: false, response: authorized.response };
}

/** Same as {@link requireAiUser}, plus the per-account AI chat rate limit. */
export async function requireAiChatMutation(): Promise<AiGate> {
  const gate = await requireAiUser();
  if (!gate.ok) return gate;
  const failure = await guardAiChat(gate.user.id);
  if (failure) return { ok: false, response: guardFailureResponse(failure) };
  return gate;
}

export function readAiBody(request: Request) {
  return readJsonBody(request, MAX_AI_BODY_BYTES);
}

export { validationErrorResponse };
