import { NextResponse } from "next/server";

import { amenityErrorResponse, requireAmenityScope } from "@/lib/server/amenity-api";
import { deleteClosure } from "@/lib/server/amenities";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ amenityId: string; closureId: string }> };

export async function DELETE(_request: Request, context: RouteContext): Promise<NextResponse> {
  const { amenityId, closureId } = await context.params;
  const gate = await requireAmenityScope(amenityId, "manage", "mutation");
  if (!gate.ok) return gate.response;

  try {
    await deleteClosure(gate.scope, amenityId, closureId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return amenityErrorResponse("closure removal", error);
  }
}
