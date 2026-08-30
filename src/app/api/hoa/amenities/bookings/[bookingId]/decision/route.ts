import { NextResponse } from "next/server";

import {
  amenityErrorResponse,
  readAmenityBody,
  requireManagerScope,
  validationErrorResponse,
} from "@/lib/server/amenity-api";
import { decideBooking } from "@/lib/server/amenity-bookings";
import { db } from "@/lib/server/db";
import { managerBookingDecisionSchema } from "@/lib/validation/amenities";
import { fieldErrors } from "@/lib/validation/profile";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ bookingId: string }> };

/** Manager approval, decline, cancellation, completion, or no-show. */
export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  const { bookingId } = await context.params;

  const booking = await db.amenityBooking.findUnique({
    where: { id: bookingId },
    select: { communityId: true },
  });
  if (!booking) {
    return NextResponse.json({ error: "That reservation was not found." }, { status: 404 });
  }

  const gate = await requireManagerScope(booking.communityId);
  if (!gate.ok) return gate.response;

  const body = await readAmenityBody(request);
  if (!body.ok) return body.response;
  const parsed = managerBookingDecisionSchema.safeParse(body.value);
  if (!parsed.success) return validationErrorResponse(fieldErrors(parsed.error));

  try {
    return NextResponse.json(await decideBooking(gate.scope, bookingId, parsed.data));
  } catch (error) {
    return amenityErrorResponse("booking decision", error);
  }
}
