"use client";

import type { ViewerContext } from "@/lib/community-types";

/**
 * The name-and-role block in the top-right identity area.
 *
 * The label comes from the server every time — `Homeowner`, `Neighborhood
 * manager`, `HOA manager`, `HOA team`, or `Service provider` with its account
 * status — so a Bundleen admin's change shows up here on the next revalidation
 * without a fresh sign-in.
 *
 * While the context is still loading it shows the name the server already
 * rendered the page with and no role at all, rather than guessing a label it
 * would then have to correct.
 */
export function ViewerIdentity({
  context,
  fallbackName,
  compact = false,
}: {
  context: ViewerContext | null;
  fallbackName: string;
  compact?: boolean;
}) {
  const name = context?.fullName || fallbackName;
  const label = context ? roleLine(context) : null;

  return (
    <div className="min-w-0">
      <strong className="block truncate">{name}</strong>
      {label && (
        <span className="block truncate" style={compact ? { fontSize: 11 } : undefined}>
          {label}
        </span>
      )}
    </div>
  );
}

/**
 * One line: the scoped label, plus a provider's account status when it is
 * something the provider needs to act on. An `Active` provider is the ordinary
 * case and does not need a badge.
 */
export function roleLine(context: ViewerContext): string {
  if (context.role !== "provider") return context.roleLabel;

  const status = context.providerStatus;
  if (status === "pending") return "Service provider · Pending review";
  if (status === "suspended") return "Service provider · Suspended";
  return "Service provider";
}
