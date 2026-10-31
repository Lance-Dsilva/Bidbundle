import "server-only";

import { matchAvailableNeighborhood } from "@/lib/geo";
import { db } from "@/lib/server/db";
import type { CoverageStatus, OnboardingCoverageInput } from "@/lib/validation/onboarding-coverage";
import { MAX_HOMEOWNERS_PER_NEIGHBORHOOD } from "@/lib/validation/profile";

/**
 * Whether an existing neighborhood has a place at this point right now.
 * Uses the same active circles, pending/active occupancy and exact Haversine
 * matcher as authenticated placement. This read neither reserves a slot nor
 * predicts formation of a new local group after account creation.
 */
export async function getOnboardingCoverage(point: OnboardingCoverageInput): Promise<CoverageStatus> {
  const candidates = await db.community.findMany({
    where: { type: "neighborhood", status: "active" },
    select: {
      id: true,
      centerLatitude: true,
      centerLongitude: true,
      radiusMiles: true,
      _count: {
        select: { memberships: { where: { status: { in: ["active", "pending"] } } } },
      },
    },
  });
  const match = matchAvailableNeighborhood(
    point,
    candidates.map((candidate) => ({ ...candidate, currentHomeowners: candidate._count.memberships })),
    MAX_HOMEOWNERS_PER_NEIGHBORHOOD,
  );
  // Return the coarse advisory result, never circle coordinates, IDs or counts.
  return match ? "available" : "unavailable";
}
