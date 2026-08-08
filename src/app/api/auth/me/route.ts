import { NextResponse } from "next/server";

import { authorizeRequest } from "@/lib/server/auth";

export async function GET(): Promise<NextResponse> {
  const result = await authorizeRequest();
  if (!result.ok) return result.response;

  return NextResponse.json({
    id: result.user.id,
    email: result.user.email,
    full_name: result.user.name ?? "",
    phone: null,
    role: result.user.role,
    neighborhood: null,
    address: null,
    latitude: null,
    longitude: null,
    neighbourhood_id: null,
    is_verified: result.user.isVerified,
  });
}
