import "server-only";

import { NextResponse } from "next/server";

import { authorizeRequest, type SessionUser } from "@/lib/server/auth";
import { guardFailureResponse, guardHoaMutation } from "@/lib/server/auth-guard";
import { HoaWorkflowError } from "@/lib/server/hoa";
import { readJsonBody, validationErrorResponse } from "@/lib/server/profile";
import { MAX_HOA_BODY_BYTES } from "@/lib/validation/hoa";

type HoaGate =
  | { ok: true; user: SessionUser }
  | { ok: false; response: NextResponse };

export async function requireHoaUser(): Promise<HoaGate> {
  const authorized = await authorizeRequest(["homeowner"]);
  return authorized.ok
    ? { ok: true, user: authorized.user }
    : { ok: false, response: authorized.response };
}

export async function requireHoaMutation(): Promise<HoaGate> {
  const gate = await requireHoaUser();
  if (!gate.ok) return gate;
  const failure = await guardHoaMutation(gate.user.id);
  if (failure) return { ok: false, response: guardFailureResponse(failure) };
  return gate;
}

export async function requireProviderUser(): Promise<HoaGate> {
  const authorized = await authorizeRequest(["provider"]);
  return authorized.ok
    ? { ok: true, user: authorized.user }
    : { ok: false, response: authorized.response };
}

export async function requireProviderMutation(): Promise<HoaGate> {
  const gate = await requireProviderUser();
  if (!gate.ok) return gate;
  const failure = await guardHoaMutation(gate.user.id);
  if (failure) return { ok: false, response: guardFailureResponse(failure) };
  return gate;
}

export function readHoaBody(request: Request) {
  return readJsonBody(request, MAX_HOA_BODY_BYTES);
}

export { validationErrorResponse };

export function hoaErrorResponse(scope: string, error: unknown): NextResponse {
  if (error instanceof HoaWorkflowError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }

  if (
    typeof error === "object" &&
    error !== null &&
    ((error as { code?: unknown }).code === "P2002" ||
      (error as { code?: unknown }).code === "23505")
  ) {
    return NextResponse.json(
      { error: "That record already exists. Refresh the page and try again." },
      { status: 409 },
    );
  }

  console.error(`[hoa] ${scope} failed`, {
    name: error instanceof Error ? error.name : "UnknownError",
  });
  return NextResponse.json(
    { error: "Something went wrong on our end. Please try again." },
    { status: 500 },
  );
}
