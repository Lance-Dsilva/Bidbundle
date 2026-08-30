import { redirect } from "next/navigation";

/**
 * Retired: the HOA-only provider workspace.
 *
 * The marketplace is no longer split by community type. `/app/provider/job-feed`
 * shows every eligible opportunity — HOA and neighbourhood alike, each labelled
 * — `/app/provider/bids` shows the quotes, `/app/provider/schedule` shows the
 * day plans for work that was won, and coverage is managed on the profile.
 *
 * This page stayed titled "HOA jobs" while the endpoint behind it began
 * returning neighbourhood work too, which would have shown a neighbour's
 * request under an HOA heading. Redirecting is better than leaving a second,
 * mislabelled copy of a screen that already exists.
 */
export default function RetiredProviderHoaPage() {
  redirect("/app/provider/job-feed");
}
