import { NextResponse } from "next/server";

/**
 * Authentication template only.
 * Credential verification and session creation will be added later.
 */
export async function POST() {
  return NextResponse.json(
    { error: "Login is not implemented yet." },
    { status: 501 },
  );
}
