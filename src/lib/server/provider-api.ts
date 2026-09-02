import "server-only";

import { NextResponse } from "next/server";

import type { ProviderAccountStatus } from "@/generated/prisma/enums";
import type { SessionUser } from "@/lib/server/auth";
import { guardFailureResponse, guardHoaMutation } from "@/lib/server/auth-guard";
import { db } from "@/lib/server/db";
import { requireProviderUser } from "@/lib/server/hoa-api";
import { readJsonBody } from "@/lib/server/profile";
import { MAX_PROVIDER_CONSOLE_BODY_BYTES } from "@/lib/validation/provider-console";

/**
 * The gate every `/api/provider/*` console handler opens with.
 *
 * `requireProviderUser` proves the *role*; this additionally proves there is a
 * real service-provider account behind it. The distinction matters because the
 * role column can be set during onboarding before the provider record exists,
 * and a half-created account must not reach endpoints that assume one.
 *
 * Two levels, mirroring the rule the marketplace already applies:
 *
 * - **Read** — a provider account must exist. A `pending` provider still sees
 *   their own (empty) console, and a `suspended` one still sees their history
 *   and the banner explaining why it has stopped moving. Hiding their own data
 *   from them would look like a fault, not a suspension.
 * - **Mutate** — the account must additionally not be suspended. A suspended
 *   provider cannot send messages, exactly as they cannot bid.
 */

export type ProviderGate =
  | { ok: true; user: SessionUser; accountStatus: ProviderAccountStatus }
  | { ok: false; response: NextResponse };

async function resolveAccountStatus(userId: string): Promise<ProviderAccountStatus | null> {
  const profile = await db.providerProfile.findUnique({
    where: { userId },
    select: { accountStatus: true },
  });
  return profile?.accountStatus ?? null;
}

export async function requireProviderConsole(): Promise<ProviderGate> {
  const gate = await requireProviderUser();
  if (!gate.ok) return gate;

  const accountStatus = await resolveAccountStatus(gate.user.id);
  if (!accountStatus) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Finish setting up your provider account to use this." },
        { status: 409 },
      ),
    };
  }

  return { ok: true, user: gate.user, accountStatus };
}

export async function requireProviderConsoleMutation(): Promise<ProviderGate> {
  const gate = await requireProviderConsole();
  if (!gate.ok) return gate;

  if (gate.accountStatus === "suspended") {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Your provider account is suspended. Contact Bundleen support." },
        { status: 403 },
      ),
    };
  }

  const failure = await guardHoaMutation(gate.user.id);
  if (failure) return { ok: false, response: guardFailureResponse(failure) };

  return gate;
}

export function readProviderConsoleBody(request: Request) {
  return readJsonBody(request, MAX_PROVIDER_CONSOLE_BODY_BYTES);
}
