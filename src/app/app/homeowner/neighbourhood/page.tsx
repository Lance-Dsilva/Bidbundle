import { NeighbourhoodWorkspace } from "@/components/homeowner/NeighbourhoodWorkspace";
import { requireRole } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

/**
 * The non-HOA neighbourhood: neighbours' requests, group enrolment, bid
 * comparison, and — for the one assigned manager — the lifecycle controls.
 *
 * The role gate here only decides who may load the page. Everything the page
 * can *do* is re-derived per request inside `/api/homeowner/neighbourhood` and
 * the lifecycle endpoints, from live membership and staff-assignment rows.
 * Being able to open this page grants nothing.
 */
export default async function HomeownerNeighbourhoodPage() {
  await requireRole(["homeowner"], "/app/homeowner/neighbourhood");

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6">
      <NeighbourhoodWorkspace />
    </div>
  );
}
