"use client";

import { ClerkLoaded, ClerkLoading } from "@clerk/nextjs";
import type { ReactNode } from "react";

import {
  BundleenAuthLoader,
  type AuthLoaderContext,
} from "@/components/auth/BundleenAuthLoader";

/**
 * One wrapper for every route that renders a Clerk `<SignIn>`/`<SignUp>` card.
 *
 * `ClerkLoading`/`ClerkLoaded` are Clerk's own supported primitives for this —
 * they read the SDK's readiness from context rather than from a timer, so the
 * loader disappears the moment the form can render and adds no artificial
 * delay. Exactly one of the two branches is ever mounted, so there is never a
 * duplicate form and never a hydration mismatch from guessing readiness on the
 * server.
 */
export function ClerkFormGate({
  context = "sign-in",
  children,
  loaderClassName,
}: {
  context?: AuthLoaderContext;
  children: ReactNode;
  loaderClassName?: string;
}) {
  return (
    <>
      <ClerkLoading>
        <BundleenAuthLoader context={context} className={loaderClassName} />
      </ClerkLoading>
      <ClerkLoaded>
        <div className="auth-crossfade w-full">{children}</div>
      </ClerkLoaded>
    </>
  );
}
