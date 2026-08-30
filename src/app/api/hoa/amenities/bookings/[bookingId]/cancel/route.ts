import { NextResponse } from "next/server";

import {
  amenityErrorResponse,
  readAmenityBody,
  requireViewerScope,
  validationErrorResponse,
} from "@/lib/server/amenity-api";
import { cancelBooking } from "@/lib/server/amenity-bookings";
import { db } from "@/lib/server/db";
import { bookingCancelSchema } from "@/lib/validation/amenities";
import { fieldErrors } from "@/lib/validation/profile";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ bookingId: string }> };

/**
 * Cancels the caller's own reservation.
 *
 * Idempotent: cancelling an already-cancelled booking answers `200` with
 * `changed: false` rather than an error, so a retried request is not presented
 * to the resident as a failure.
 */
export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  const { bookingId } = await context.params;

  // The community comes off the booking row, never the request body.
  const booking = await db.amenityBooking.findUnique({
    where: { id: bookingId },
    select: { communityId: true },
  });
  if (!booking) {
    return NextResponse.json({ error: "That reservation was not found." }, { status: 404 });
  }

  const gate = await requireViewerScope(booking.communityId, "mutation");
  if (!gate.ok) return gate.response;

  const body = await readAmenityBody(request);
  if (!body.ok) return body.response;
  const parsed = bookingCancelSchema.safeParse(body.value ?? {});
  if (!parsed.success) return validationErrorResponse(fieldErrors(parsed.error));

  try {
    const result = await cancelBooking(
      gate.scope,
      bookingId,
      parsed.data.reason ?? null,
    );
    return NextResponse.json(result);
  } catch (error) {
    return amenityErrorResponse("booking cancellation", error);
  }
}
