"use client";

import { SignOutButton } from "@clerk/nextjs";

/** Ends the Clerk session and returns to the public site. */
export function AdminSignOutButton() {
  return (
    <SignOutButton redirectUrl="/">
      <button
        type="button"
        className="w-full rounded-xl border py-3 text-center text-[13px] font-semibold transition"
        style={{ borderColor: "var(--line)", color: "var(--danger-600)" }}
      >
        Sign out
      </button>
    </SignOutButton>
  );
}
