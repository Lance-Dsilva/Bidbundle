import type { Metadata } from "next";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata: Metadata = { title: "Bundleen vendor invitation", robots: { index: false, follow: false, noarchive: true }, referrer: "no-referrer" };
import { notFound } from "next/navigation";
import { VendorBidProposal } from "@/components/vendors/VendorBidProposal";
import { getPublicBidSummary } from "@/lib/server/vendor-sourcing";
import { VendorSourcingError } from "@/lib/server/vendor-errors";
export default async function VendorBidPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  try { const summary = await getPublicBidSummary(token); if (!summary) notFound(); return <VendorBidProposal token={token} summary={summary} />; }
  catch (error) { if (error instanceof VendorSourcingError && error.status === 404) notFound(); if (error instanceof VendorSourcingError) return <main className="mx-auto max-w-xl px-5 py-16"><h1 className="text-2xl font-semibold">Proposal invitations are temporarily unavailable</h1><p className="mt-4">Please try this link again later or contact support@bundleen.com.</p></main>; throw error; }
}
