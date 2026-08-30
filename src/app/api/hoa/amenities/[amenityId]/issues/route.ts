import { NextResponse } from "next/server";

import {
  amenityErrorResponse,
  readAmenityBody,
  requireAmenityScope,
  validationErrorResponse,
} from "@/lib/server/amenity-api";
import { createIssue } from "@/lib/server/amenity-issues";
import { issueCreateSchema } from "@/lib/validation/amenities";
import { fieldErrors } from "@/lib/validation/profile";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ amenityId: string }> };

/** Opens an HOA operations ticket. Never a Bundleen support ticket. */
export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  const { amenityId } = await context.params;
  const gate = await requireAmenityScope(amenityId, "view", "mutation");
  if (!gate.ok) return gate.response;

  const body = await readAmenityBody(request);
  if (!body.ok) return body.response;
  const parsed = issueCreateSchema.safeParse(body.value);
  if (!parsed.success) return validationErrorResponse(fieldErrors(parsed.error));

  try {
    return NextResponse.json(
      await createIssue(gate.scope, amenityId, parsed.data),
      { status: 201 },
    );
  } catch (error) {
    return amenityErrorResponse("issue creation", error);
  }
}
