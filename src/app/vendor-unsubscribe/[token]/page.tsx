import type { Metadata } from "next";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata: Metadata = { title: "Bundleen vendor invitation", robots: { index: false, follow: false, noarchive: true }, referrer: "no-referrer" };
import { VendorUnsubscribe } from "@/components/vendors/VendorUnsubscribe";
export default async function VendorUnsubscribePage({ params }: { params: Promise<{ token: string }> }) { return <VendorUnsubscribe token={(await params).token} />; }
