import { redirect } from "next/navigation";

import { AmenityManagerWorkspace } from "@/components/hoa/AmenityManagerWorkspace";
import { getManagerAmenityWorkspace } from "@/lib/server/amenities";
import {
  listManagedHoaCommunities,
  requireAmenityManager,
} from "@/lib/server/amenity-auth";
import { requireHoaManager } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

/**
 * "Amenities & spaces" for the invitation-only HOA manager dashboard.
 *
 * `requireHoaManager` proves a live, scoped assignment exists at all;
 * `requireAmenityManager` then proves it exists *for the community being
 * opened*. A manager of one HOA who edits the query string gets a 403 from the
 * second check, not a different HOA's calendar.
 */
export default async function HoaAmenitiesPage({
  searchParams,
}: {
  searchParams: Promise<{ community?: string }>;
}) {
  const user = await requireHoaManager("/app/hoa/amenities");
  const communities = await listManagedHoaCommunities(user.id);
  if (communities.length === 0) redirect("/app/hoa/dashboard");

  const params = await searchParams;
  const chosen =
    communities.find((community) => community.id === params.community) ?? communities[0];

  const scope = await requireAmenityManager(user, chosen.id);
  const workspace = await getManagerAmenityWorkspace(scope);

  return (
    <div className="space-y-6">
      <header>
        <span className="bb-eyebrow">{workspace.communityName}</span>
        <h1 className="bb-page-heading">Amenities &amp; spaces</h1>
        <p className="bb-page-subtitle">
          Configure shared spaces, run the booking calendar, handle resident
          reports, and message the people affected.
        </p>
      </header>

      <AmenityManagerWorkspace workspace={workspace} />
    </div>
  );
}
