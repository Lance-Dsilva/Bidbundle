import { NextResponse } from "next/server";

import { readJsonBody } from "@/lib/server/profile";
import {
  hoaErrorResponse,
  requireProviderMutation,
  requireProviderUser,
  validationErrorResponse,
} from "@/lib/server/hoa-api";
import {
  createProviderServiceArea,
  listProviderServiceAreas,
} from "@/lib/server/provider-coverage";
import { fieldErrors } from "@/lib/validation/profile";
import {
  MAX_PROVIDER_COVERAGE_BODY_BYTES,
  providerServiceAreaSchema,
} from "@/lib/validation/provider-coverage";

/**
 * The canonical provider coverage endpoint.
 *
 * `/api/provider/marketplace/service-areas` still exists and still works for the
 * older HOA workspace form; both write the same rows through the same
 * ownership checks. New callers use this path.
 */
export const runtime = "nodejs";

export async function GET(): Promise<NextResponse> {
  const gate = await requireProviderUser();
  if (!gate.ok) return gate.response;

  try {
    const areas = await listProviderServiceAreas(gate.user.id);
    return NextResponse.json({ areas });
  } catch (error) {
    return hoaErrorResponse("service area list", error);
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const gate = await requireProviderMutation();
  if (!gate.ok) return gate.response;

  const body = await readJsonBody(request, MAX_PROVIDER_COVERAGE_BODY_BYTES);
  if (!body.ok) return body.response;

  const parsed = providerServiceAreaSchema.safeParse(body.value);
  if (!parsed.success) return validationErrorResponse(fieldErrors(parsed.error));

  try {
    const area = await createProviderServiceArea(gate.user.id, parsed.data);
    return NextResponse.json({ area }, { status: 201 });
  } catch (error) {
    return hoaErrorResponse("service area create", error);
  }
}
