import { NextResponse } from "next/server";

import {
  amenityErrorResponse,
  readAmenityBody,
  requireAmenityScope,
  validationErrorResponse,
} from "@/lib/server/amenity-api";
import { createBooking } from "@/lib/server/amenity-bookings";
import { bookingCreateSchema } from "@/lib/validation/amenities";
import { fieldErrors } from "@/lib/validation/profile";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ amenityId: string }> };

/**
 * Reserves a slot.
 *
 * Idempotent: a repeated submission for the same amenity and start instant
 * returns the reservation the resident already holds, with `201` reserved for
 * a genuinely new one.
 */
export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  const { amenityId } = await context.params;
  const gate = await requireAmenityScope(amenityId, "view", "mutation");
  if (!gate.ok) return gate.response;

  const body = await readAmenityBody(request);
  if (!body.ok) return body.response;
  const parsed = bookingCreateSchema.safeParse(body.value);
  if (!parsed.success) return validationErrorResponse(fieldErrors(parsed.error));

  try {
    const result = await createBooking(gate.scope, amenityId, parsed.data);
    return NextResponse.json(result, { status: result.idempotent ? 200 : 201 });
  } catch (error) {
    return amenityErrorResponse("booking creation", error);
  }
}
