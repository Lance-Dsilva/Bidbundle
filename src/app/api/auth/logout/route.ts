import { NextResponse } from "next/server";

/**
 * Authentication template only.
 * Session invalidation and cookie removal will be added later.
 */
export async function POST() {
  return NextResponse.json(
    { error: "Logout is not implemented yet." },
    { status: 501 },
  );
}
