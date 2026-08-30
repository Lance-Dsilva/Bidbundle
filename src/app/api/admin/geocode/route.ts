import { NextResponse } from "next/server";

import {
  adminErrorResponse,
  readAdminBody,
  requireAdminMutation,
  validationErrorResponse,
} from "@/lib/server/admin-api";
import { searchAddressCandidates } from "@/lib/server/address-verification";
import { addressSearchSchema, MAX_ADDRESS_BODY_BYTES } from "@/lib/validation/address";
import { fieldErrors } from "@/lib/validation/profile";

/**
 * Admin address lookup: normalized candidates for one postal address.
 *
 * This exists for the neighbourhood-centre picker and the "did you mean" step,
 * where an admin needs to *choose* a place before anything is stored. It never
 * writes, and it never returns coordinates — the browser picks an address and
 * the server resolves the numbers again on the save.
 *
 * Guarded exactly like every other admin mutation, and rate-limited on the
 * mutation limiter rather than treated as a read: without that this would be
 * an authenticated proxy that lets anyone with portal access spend the
 * organisation's geocoding quota at will.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  const gate = await requireAdminMutation();
  if (!gate.ok) return gate.response;

  const body = await readAdminBody(request, MAX_ADDRESS_BODY_BYTES);
  if (!body.ok) return body.response;

  const parsed = addressSearchSchema.safeParse(body.value);
  if (!parsed.success) return validationErrorResponse(fieldErrors(parsed.error));

  try {
    const candidates = await searchAddressCandidates(parsed.data);
    return NextResponse.json({ candidates });
  } catch (error) {
    return adminErrorResponse("admin geocode", error);
  }
}
