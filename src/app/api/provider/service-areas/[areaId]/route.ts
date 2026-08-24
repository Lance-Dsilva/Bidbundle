import { NextResponse } from "next/server";

import {
  hoaErrorResponse,
  requireProviderMutation,
  validationErrorResponse,
} from "@/lib/server/hoa-api";
import { readJsonBody } from "@/lib/server/profile";
import {
  deactivateProviderServiceArea,
  updateProviderServiceArea,
} from "@/lib/server/provider-coverage";
import { fieldErrors } from "@/lib/validation/profile";
import {
  MAX_PROVIDER_COVERAGE_BODY_BYTES,
  providerServiceAreaSchema,
} from "@/lib/validation/provider-coverage";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ areaId: string }> };

export async function PUT(request: Request, context: RouteContext): Promise<NextResponse> {
  const gate = await requireProviderMutation();
  if (!gate.ok) return gate.response;

  const body = await readJsonBody(request, MAX_PROVIDER_COVERAGE_BODY_BYTES);
  if (!body.ok) return body.response;

  const parsed = providerServiceAreaSchema.safeParse(body.value);
  if (!parsed.success) return validationErrorResponse(fieldErrors(parsed.error));

  const { areaId } = await context.params;

  try {
    const area = await updateProviderServiceArea(gate.user.id, areaId, parsed.data);
    return NextResponse.json({ area });
  } catch (error) {
    return hoaErrorResponse("service area update", error);
  }
}

export async function DELETE(
  _request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  const gate = await requireProviderMutation();
  if (!gate.ok) return gate.response;

  const { areaId } = await context.params;

  try {
    const result = await deactivateProviderServiceArea(gate.user.id, areaId);
    return NextResponse.json({ ok: true, remainingActive: result.remainingActive });
  } catch (error) {
    return hoaErrorResponse("service area removal", error);
  }
}
