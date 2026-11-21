import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getPublicCommunity } from "@/lib/server/public-request-sharing";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Community services | Bundleen", robots: { index: false, follow: false }, referrer: "no-referrer" };
export default async function CommunitySharePage({ params }: { params: Promise<{ communitySlug: string }> }) {
  const { communitySlug } = await params;
  const community = await getPublicCommunity(communitySlug);
  if (!community) notFound();
  return <main className="mx-auto max-w-3xl px-5 py-12"><p className="text-sm font-semibold text-teal-700">Bundleen community services</p><h1 className="mt-3 text-3xl font-bold">{community.name}</h1><p className="mt-3 text-slate-600">Explore services your community manager has shared. Neighbors’ names and addresses stay private.</p><div className="mt-8 grid gap-4">{community.requests.map(request => <Link key={request.path} href={request.path} className="rounded-2xl border p-6"><h2 className="text-xl font-semibold">{request.service}</h2><p className="mt-2">{request.joinedHomes} homes joined{request.minimumHomes ? ` · ${request.minimumHomes} needed` : ""}</p><span className="mt-4 inline-block font-semibold text-teal-700">View service →</span></Link>)}</div>{community.requests.length === 0 && <p className="mt-8">No open services are being shared right now.</p>}</main>;
}
