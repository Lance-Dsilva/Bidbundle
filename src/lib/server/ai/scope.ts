import "server-only";

import { db } from "@/lib/server/db";
import { HoaWorkflowError, requireActiveResident, requireManagedHoa } from "@/lib/server/hoa";
import type { SessionUser } from "@/lib/server/auth";
import type { AppRole } from "@/lib/validation/auth";
import { AiToolError } from "@/lib/server/ai/errors";

/**
 * What a tool is allowed to do, derived once per request from the verified
 * session — never from anything the model or the conversation says. Every
 * tool re-checks against the database using this scope; nothing here is a
 * cached permission a tool can skip re-deriving.
 */
export type AiCallerScope = {
  userId: string;
  role: AppRole;
  isAdmin: boolean;
};

export function buildCallerScope(user: SessionUser): AiCallerScope {
  return {
    userId: user.id,
    role: user.role,
    isAdmin: user.role === "admin" && user.adminAccessLevel !== null,
  };
}

export function requireAdmin(scope: AiCallerScope, toolName: string): void {
  if (!scope.isAdmin) {
    throw new AiToolError(`${toolName} is limited to Bundleen admins.`, 403);
  }
}

export function requireProvider(scope: AiCallerScope, toolName: string): void {
  if (scope.role !== "provider") {
    throw new AiToolError(`${toolName} is limited to provider accounts.`, 403);
  }
}

export function rejectProvider(scope: AiCallerScope, toolName: string): void {
  if (scope.role === "provider") {
    throw new AiToolError(`${toolName} is not available to provider accounts.`, 403);
  }
}

export type CommunityAccess = {
  communityId: string;
  name: string;
  /** True for a Bundleen admin or an active `hoa_manager` of this community. */
  isManagerOrAdmin: boolean;
};

/**
 * Resolves and authorizes access to one HOA community, or throws.
 *
 * Reuses the same manager/resident checks the mutation endpoints already use
 * (`requireManagedHoa`/`requireActiveResident` in `lib/server/hoa.ts`) so the
 * assistant can never see a wider boundary than the rest of the product.
 */
export async function resolveCommunityAccess(
  scope: AiCallerScope,
  communityId: string,
): Promise<CommunityAccess> {
  if (scope.role === "provider") {
    throw new AiToolError("Provider accounts do not have community-level access.", 403);
  }

  if (scope.isAdmin) {
    const community = await db.community.findUnique({
      where: { id: communityId },
      select: { id: true, name: true },
    });
    if (!community) throw new AiToolError("That community does not exist.", 404);
    return { communityId, name: community.name, isManagerOrAdmin: true };
  }

  try {
    const community = await requireManagedHoa(scope.userId, communityId);
    return { communityId, name: community.name, isManagerOrAdmin: true };
  } catch (error) {
    if (!(error instanceof HoaWorkflowError)) throw error;
  }

  try {
    const membership = await requireActiveResident(scope.userId, communityId);
    const community = await db.community.findUnique({
      where: { id: communityId },
      select: { name: true },
    });
    void membership;
    return { communityId, name: community?.name ?? "your community", isManagerOrAdmin: false };
  } catch (error) {
    if (error instanceof HoaWorkflowError) {
      throw new AiToolError("You do not have access to that community.", 403);
    }
    throw error;
  }
}

/** Where a human can view this community in-app, given their role and access level. */
export function communityHref(
  role: AiCallerScope["role"],
  isManagerOrAdmin: boolean,
  communityId: string,
  section?: "requests",
): string {
  if (role === "admin") return `/app/admin/communities/${communityId}`;
  if (isManagerOrAdmin) return section === "requests" ? "/app/hoa/dashboard#requests" : "/app/hoa/dashboard";
  return section === "requests" ? "/app/homeowner/bids" : "/app/homeowner/community";
}

/** Active unit ids for a resident (non-manager) caller within one community. */
export async function residentUnitIds(userId: string, communityId: string): Promise<string[]> {
  const memberships = await db.communityMembership.findMany({
    where: { userId, communityId, status: "active" },
    select: { unitId: true },
  });
  return memberships.map((m) => m.unitId).filter((id): id is string => id !== null);
}
