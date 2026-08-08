import { NextResponse } from "next/server";

import { authorizeRequest } from "@/lib/server/auth";
import { db } from "@/lib/server/db";
import { commonProfileSelect, internalErrorResponse } from "@/lib/server/profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The legacy `AuthUser` shape, now backed by real Neon columns rather than the
 * `null` placeholders it returned while the profile tables did not exist.
 *
 * Kept in snake_case because several screens still read it. New code should
 * call `GET /api/profile` instead.
 */
export async function GET(): Promise<NextResponse> {
  const authorized = await authorizeRequest();
  if (!authorized.ok) return authorized.response;

  try {
    const user = await db.user.findUnique({
      where: { id: authorized.user.id },
      select: commonProfileSelect,
    });

    if (!user) {
      return NextResponse.json({ error: "Profile not found." }, { status: 404 });
    }

    return NextResponse.json({
      id: user.id,
      email: user.email,
      full_name: user.fullName,
      phone: user.phone,
      role: user.role,
      neighborhood: user.neighborhood,
      address: user.address,
      latitude: user.latitude,
      longitude: user.longitude,
      avatar_url: user.avatarUrl,
      is_verified: user.isVerified,
    });
  } catch (error) {
    return internalErrorResponse("session profile read", error);
  }
}
