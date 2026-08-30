import { NextResponse } from "next/server";

import {
  amenityErrorResponse,
  readAmenityBody,
  requireAmenityScope,
  validationErrorResponse,
} from "@/lib/server/amenity-api";
import { createReview, listReviews } from "@/lib/server/amenity-reviews";
import {
  amenityReviewSchema,
  reviewListQuerySchema,
} from "@/lib/validation/amenities";
import { fieldErrors } from "@/lib/validation/profile";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ amenityId: string }> };

export async function GET(request: Request, context: RouteContext): Promise<NextResponse> {
  const { amenityId } = await context.params;
  const gate = await requireAmenityScope(amenityId, "view");
  if (!gate.ok) return gate.response;

  const params = new URL(request.url).searchParams;
  const parsed = reviewListQuerySchema.safeParse({
    sort: params.get("sort") ?? undefined,
    cursor: params.get("cursor") ?? undefined,
    limit: params.get("limit") ? Number(params.get("limit")) : undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid review query." }, { status: 400 });
  }

  try {
    return NextResponse.json(await listReviews(gate.scope, amenityId, parsed.data));
  } catch (error) {
    return amenityErrorResponse("review list", error);
  }
}

export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  const { amenityId } = await context.params;
  const gate = await requireAmenityScope(amenityId, "view", "mutation");
  if (!gate.ok) return gate.response;

  const body = await readAmenityBody(request);
  if (!body.ok) return body.response;
  const parsed = amenityReviewSchema.safeParse(body.value);
  if (!parsed.success) return validationErrorResponse(fieldErrors(parsed.error));

  try {
    return NextResponse.json(
      await createReview(gate.scope, amenityId, parsed.data),
      { status: 201 },
    );
  } catch (error) {
    return amenityErrorResponse("review creation", error);
  }
}
