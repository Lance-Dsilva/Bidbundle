import { NextResponse } from "next/server";

/**
 * Authentication template only.
 * The current-user session lookup will be added later.
 */
export async function GET() {
  return NextResponse.json(
    { error: "Session lookup is not implemented yet." },
    { status: 501 },
  );
}
