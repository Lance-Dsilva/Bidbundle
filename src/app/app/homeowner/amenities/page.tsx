import { redirect } from "next/navigation";

import { AmenityCatalogList } from "@/components/amenities/AmenityCatalogList";
import { getAmenityCatalog } from "@/lib/server/amenities";
import {
  listResidentHoaCommunities,
  requireAmenityViewer,
} from "@/lib/server/amenity-auth";
import { requireRole } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

/**
 * The resident amenity catalog.
 *
 * Authorization is server-side and derived from live membership, exactly like
 * every other HOA surface: a homeowner with no active HOA membership is sent
 * back to their dashboard, and the catalog they do see is scoped to the one
 * community they belong to. Non-HOA neighbourhood residents never reach this
 * page, because `listResidentHoaCommunities` filters on `type: "hoa"`.
 */
export default async function HomeownerAmenitiesPage({
  searchParams,
}: {
  searchParams: Promise<{ community?: string }>;
}) {
  const user = await requireRole(["homeowner"], "/app/homeowner/amenities");
  const communities = await listResidentHoaCommunities(user.id);
  if (communities.length === 0) redirect("/app/homeowner/dashboard");

  const params = await searchParams;
  const chosen =
    communities.find((community) => community.id === params.community) ?? communities[0];

  const scope = await requireAmenityViewer(user, chosen.id);
  const catalog = await getAmenityCatalog(scope);

  return (
    <div className="space-y-6">
      <header>
        <span className="bb-eyebrow">{catalog.communityName}</span>
        <h1 className="bb-page-heading">Amenities</h1>
        <p className="bb-page-subtitle">
          Shared spaces in your HOA. Book what needs booking, drop in to the rest.
        </p>
      </header>

      <AmenityCatalogList catalog={catalog} />
    </div>
  );
}
