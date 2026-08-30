import { notFound } from "next/navigation";
import Link from "next/link";

import { AmenityDetailView } from "@/components/amenities/AmenityDetailView";
import { getAmenityDetail } from "@/lib/server/amenities";
import { scopeForAmenity } from "@/lib/server/amenity-auth";
import { requireRole } from "@/lib/server/auth";
import { HoaWorkflowError } from "@/lib/server/hoa";

export const dynamic = "force-dynamic";

/**
 * One amenity.
 *
 * The scope is resolved from the amenity row rather than a query parameter, so
 * a resident of another HOA who is handed this URL gets the same `notFound()`
 * as someone using an id that does not exist — the page never confirms that
 * another community's amenity is real.
 */
export default async function AmenityDetailPage({
  params,
}: {
  params: Promise<{ amenityId: string }>;
}) {
  const user = await requireRole(["homeowner"], "/app/homeowner/amenities");
  const { amenityId } = await params;

  try {
    const { scope } = await scopeForAmenity(user, amenityId, "view");
    const amenity = await getAmenityDetail(scope, amenityId);

    return (
      <div className="space-y-4">
        <Link
          className="inline-flex text-sm font-semibold text-[var(--teal-800,#0f6f63)]"
          href="/app/homeowner/amenities"
        >
          ← All amenities
        </Link>
        <AmenityDetailView amenity={amenity} />
      </div>
    );
  } catch (error) {
    if (error instanceof HoaWorkflowError) notFound();
    throw error;
  }
}
