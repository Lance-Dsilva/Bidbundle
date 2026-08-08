import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isProtectedRoute = createRouteMatcher([
  "/app(.*)",
  "/auth/continue(.*)",
  "/get-started/profile(.*)",
  "/api/auth/me(.*)",
  "/api/auth/profile(.*)",
]);

/**
 * Verifies Clerk session tokens and exposes `auth()` to Server Components and
 * Route Handlers. Bundleen deliberately performs authorization beside each
 * protected resource in `lib/server/auth.ts`, where the live database role is
 * available, rather than trusting a client-visible role or route matcher.
 */
export default clerkMiddleware(async (auth, request) => {
  if (isProtectedRoute(request)) await auth.protect();
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
