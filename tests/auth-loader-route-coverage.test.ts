import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Source-level guard for the auth transition.
 *
 * The rendered behaviour is covered by `bundleen-auth-loader.test.tsx`; what a
 * unit test cannot check is whether someone adds a *new* Clerk entry point and
 * forgets the loader, leaving a blank panel behind exactly where the task said
 * one must never appear. These assertions fail in that case.
 */

const ROOT = resolve(import.meta.dirname, "..");

function read(relativePath: string): string {
  return readFileSync(resolve(ROOT, relativePath), "utf8");
}

/** Every route that renders a Clerk `<SignIn>`/`<SignUp>` card. */
const CLERK_FORM_ROUTES = [
  "src/app/sign-in/[[...sign-in]]/page.tsx",
  "src/app/admin/sign-in/[[...sign-in]]/page.tsx",
  "src/app/hoa/sign-in/[[...sign-in]]/page.tsx",
  "src/app/hoa/join/[invitationId]/[[...sign-up]]/page.tsx",
  "src/app/hoa/invitation-sign-in/[invitationId]/[[...sign-in]]/page.tsx",
] as const;

/** Handoffs with no Clerk card, covered by a route-level `loading.tsx`. */
const HANDOFF_LOADING_ROUTES = [
  "src/app/auth/continue/loading.tsx",
  "src/app/hoa/accept/[invitationId]/loading.tsx",
] as const;

describe("branded auth loader coverage", () => {
  it.each(CLERK_FORM_ROUTES)("%s gates its Clerk form behind the loader", (path) => {
    const source = read(path);
    expect(source).toContain("ClerkFormGate");
    // The gate must wrap the form, not sit beside it.
    const gateIndex = source.indexOf("<ClerkFormGate");
    const formIndex = Math.max(source.indexOf("<SignIn"), source.indexOf("<SignUp"));
    expect(gateIndex).toBeGreaterThanOrEqual(0);
    expect(formIndex).toBeGreaterThan(gateIndex);
  });

  it.each(HANDOFF_LOADING_ROUTES)("%s renders the branded loader", (path) => {
    expect(read(path)).toContain("BundleenAuthLoader");
  });

  it("uses the loader for the sign-up account step and the profile handoff", () => {
    const signUp = read("src/components/auth/NamedSignUp.tsx");
    expect(signUp).toContain("BundleenAuthLoader");
    expect(signUp).toContain("ClerkFormGate");
    // The old grey skeleton must not come back alongside it.
    expect(signUp).not.toContain("animate-pulse");

    const profile = read("src/app/get-started/profile/page.tsx");
    expect(profile).toContain("BundleenAuthLoader");
    expect(profile).not.toContain("animate-pulse");
  });

  it("uses Clerk's own readiness primitives, not a guessed timer", () => {
    const gate = read("src/components/auth/ClerkFormGate.tsx");
    expect(gate).toContain("ClerkLoading");
    expect(gate).toContain("ClerkLoaded");
    // Exactly one branch mounts at a time, so no duplicate form can render:
    // the gate renders `children`, never a Clerk form of its own. (The doc
    // comment names the components in prose, hence the import check rather
    // than a text search.)
    expect(gate).not.toMatch(/^import .*\b(SignIn|SignUp)\b.*from "@clerk\/nextjs"/m);
    expect(gate).toContain("{children}");
  });

  it("keeps the existing signed-in redirects, so no route can loop", () => {
    // Each of these pages redirects an already-signed-in visitor away instead
    // of rendering a second form for a session that already exists.
    expect(read("src/app/admin/sign-in/[[...sign-in]]/page.tsx")).toContain(
      'redirect("/auth/continue")',
    );
    expect(read("src/app/hoa/sign-in/[[...sign-in]]/page.tsx")).toContain(
      'redirect("/auth/continue")',
    );
    expect(read("src/app/hoa/invitation-sign-in/[invitationId]/[[...sign-in]]/page.tsx")).toContain(
      "redirect(`/hoa/accept/${invitationId}`)",
    );
  });

  it("still renders the invalid-invitation branch outside the loader", () => {
    // An expired invitation is a resolved answer, not a wait: it must show the
    // explanation immediately rather than spinning behind the loader.
    for (const path of [
      "src/app/hoa/join/[invitationId]/[[...sign-up]]/page.tsx",
      "src/app/hoa/invitation-sign-in/[invitationId]/[[...sign-in]]/page.tsx",
    ]) {
      const source = read(path);
      expect(source).toContain("Invitation unavailable");
      const unavailableIndex = source.indexOf("Invitation unavailable");
      expect(source.indexOf("</ClerkFormGate>")).toBeLessThan(unavailableIndex);
    }
  });
});
