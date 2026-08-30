import { NextResponse } from "next/server";

import { amenityErrorResponse, requireAmenityScope } from "@/lib/server/amenity-api";
import { getAmenityAvailability } from "@/lib/server/amenities";
import { availabilityQuerySchema } from "@/lib/validation/amenities";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ amenityId: string }> };

/**
 * The server-authoritative slot calendar.
 *
 * The browser renders what this returns and nothing else; it never computes
 * availability of its own, and a slot it shows as free is still re-checked on
 * submit.
 */
export async function GET(request: Request, context: RouteContext): Promise<NextResponse> {
  const { amenityId } = await context.params;
  const gate = await requireAmenityScope(amenityId, "view");
  if (!gate.ok) return gate.response;

  const params = new URL(request.url).searchParams;
  const parsed = availabilityQuerySchema.safeParse({
    from: params.get("from") ?? undefined,
    days: params.get("days") ? Number(params.get("days")) : undefined,
    durationMinutes: params.get("durationMinutes")
      ? Number(params.get("durationMinutes"))
      : undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid availability query." }, { status: 400 });
  }

  try {
    return NextResponse.json(
      await getAmenityAvailability(gate.scope, amenityId, parsed.data),
    );
  } catch (error) {
    return amenityErrorResponse("availability", error);
  }
}
