import { NextResponse } from "next/server";

/**
 * Authentication template only.
 * Registration validation, persistence, and session creation will be added later.
 */
export async function POST() {
  return NextResponse.json(
    { error: "Registration is not implemented yet." },
    { status: 501 },
  );
}
