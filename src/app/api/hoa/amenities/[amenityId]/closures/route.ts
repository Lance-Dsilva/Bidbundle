import { NextResponse } from "next/server";

import {
  amenityErrorResponse,
  readAmenityBody,
  requireAmenityScope,
  validationErrorResponse,
} from "@/lib/server/amenity-api";
import { cancelBookingsForClosure } from "@/lib/server/amenity-bookings";
import { createClosure } from "@/lib/server/amenities";
import { amenityClosureSchema } from "@/lib/validation/amenities";
import { fieldErrors } from "@/lib/validation/profile";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ amenityId: string }> };

/**
 * Adds a closure and, for a dated one, cancels the reservations it covers.
 *
 * The cancellation is deliberate rather than a side effect to be discovered
 * later: a resident whose slot no longer exists is told now, by name, with the
 * reason the manager gave.
 */
export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  const { amenityId } = await context.params;
  const gate = await requireAmenityScope(amenityId, "manage", "mutation");
  if (!gate.ok) return gate.response;

  const body = await readAmenityBody(request);
  if (!body.ok) return body.response;
  const parsed = amenityClosureSchema.safeParse(body.value);
  if (!parsed.success) return validationErrorResponse(fieldErrors(parsed.error));

  try {
    const closureId = await createClosure(gate.scope, amenityId, parsed.data);

    let cancelledBookings = 0;
    if (parsed.data.startsAt && parsed.data.endsAt) {
      cancelledBookings = await cancelBookingsForClosure(
        gate.scope,
        amenityId,
        { start: new Date(parsed.data.startsAt), end: new Date(parsed.data.endsAt) },
        parsed.data.reason ?? "The amenity is closed for this period.",
      );
    }

    return NextResponse.json({ closureId, cancelledBookings }, { status: 201 });
  } catch (error) {
    return amenityErrorResponse("closure creation", error);
  }
}
