import { StartSharedEnrollment } from "@/components/sharing/StartSharedEnrollment";
import type { Metadata } from "next";
import Link from "next/link";
import { PriceLadder } from "@/components/ui/PriceLadder";
import { notFound } from "next/navigation";
import { getPublicRequest } from "@/lib/server/public-request-sharing";
export const dynamic = "force-dynamic";
type Props = { params: Promise<{ communitySlug: string; requestToken: string }> };
export const metadata: Metadata = {
  title: "Join your neighbors | Bundleen", description: "Explore a shared community service on Bundleen.",
  robots: { index: false, follow: false }, referrer: "no-referrer",
  openGraph: { title: "A service for your community", description: "See how many homes have joined. Resident names and addresses stay private.", images: ["/icons/icon-512.png"] },
};
export default async function RequestSharePage({ params }: Props) {
  const { communitySlug, requestToken } = await params;
  const request = await getPublicRequest(communitySlug, requestToken);
  if (!request) notFound();
  return <main className="mx-auto max-w-2xl px-5 py-12"><Link href={`/c/${communitySlug}`} className="text-sm font-semibold text-teal-700">← Community services</Link><p className="mt-8 text-sm font-semibold uppercase tracking-wide text-teal-700">Better together</p><h1 className="mt-3 text-4xl font-bold">{request.service} for your community</h1><p className="mt-5 text-lg">{request.joinedHomes} homes joined{request.minimumHomes ? ` · ${request.minimumHomes} homes needed` : ""}</p>{request.enrollmentClosesAt && <p className="mt-3">Enrollment deadline: {new Date(request.enrollmentClosesAt).toLocaleDateString("en-US", { dateStyle: "long", timeZone: "America/Chicago" })}</p>}
    <p className="mt-4 text-slate-600">{request.providerName ? `Awarded provider: ${request.providerName}` : `${request.verifiedBidders} verified ${request.verifiedBidders === 1 ? "provider" : "providers"} bidding`}</p>
    {request.priceLadder && <div className="mt-6"><PriceLadder tiers={request.priceLadder.tiers} joinedHomes={request.joinedHomes} guaranteedPerHomeCents={request.priceLadder.guaranteedPerHomeCents} /></div>}
    <section className="mt-8 rounded-2xl bg-teal-50 p-6"><h2 className="text-lg font-semibold">Review the details before joining</h2><p className="mt-2">Your home must be on the community roster. Pricing and enrollment details are available in your resident workspace.</p><StartSharedEnrollment communityToken={communitySlug} requestToken={requestToken} /></section>
    <p className="mt-6 text-sm text-slate-600">This page shows totals only. It does not list residents, home addresses or private service instructions.</p>
  </main>;
}
