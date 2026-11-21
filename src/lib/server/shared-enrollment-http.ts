import "server-only";
import type { NextResponse } from "next/server";
export const SHARED_ENROLLMENT_COOKIE = "bundleen_shared_enrollment";
export function sameOriginMutation(request: Request) {
  const origin = request.headers.get("origin");
  return origin === new URL(request.url).origin && request.headers.get("sec-fetch-site") !== "cross-site";
}
export function privateEnrollmentResponse(response: NextResponse) {
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}
