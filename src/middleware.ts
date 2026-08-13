import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const isProtectedRoute = createRouteMatcher([
  "/app(.*)",
  "/auth/continue(.*)",
  "/get-started/profile(.*)",
  "/api/auth/me(.*)",
  "/api/auth/profile(.*)",
  "/api/admin(.*)",
  "/api/me(.*)",
]);
const isAdminPage = createRouteMatcher(["/app/admin(.*)"]);

/**
 * Verifies Clerk session tokens and exposes `auth()` to Server Components and
 * Route Handlers. Bundleen deliberately performs authorization beside each
 * protected resource in `lib/server/auth.ts`, where the live database role is
 * available, rather than trusting a client-visible role or route matcher.
 */
export default clerkMiddleware(async (auth, request) => {
  // Admin pages use their own sign-in-only entry point. APIs remain on
  // `auth.protect()` below and enforce the database allow-list in every route.
  if (isAdminPage(request)) {
    const { userId } = await auth();
    if (!userId) return NextResponse.redirect(new URL("/admin/sign-in", request.url));
    return;
  }
  if (isProtectedRoute(request)) await auth.protect();
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
