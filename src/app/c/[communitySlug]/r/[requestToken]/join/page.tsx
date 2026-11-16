import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireRole } from "@/lib/server/auth";
import { getPublicRequest, resolveSharedEnrollment } from "@/lib/server/public-request-sharing";
export const dynamic = "force-dynamic";
export default async function SharedEnrollmentPage({ params }: { params: Promise<{ communitySlug: string; requestToken: string }> }) {
  const { communitySlug, requestToken } = await params;
  const request = await getPublicRequest(communitySlug, requestToken);
  if (!request) notFound();
  const user = await requireRole(["homeowner"], `${request.path}/join`);
  const destination = await resolveSharedEnrollment(user.id, communitySlug, requestToken);
  if (destination) redirect(destination);
  return <main className="mx-auto max-w-xl px-5 py-12"><h1 className="text-2xl font-semibold">Confirm your community home</h1><p className="mt-4">To join this service, your account must be matched to an active home on the community roster. Confirm your address in your profile and use your HOA invitation, or ask your community manager to check your access.</p><div className="mt-6 flex flex-wrap gap-4"><Link href="/app/homeowner/profile" className="rounded-xl bg-teal-700 px-5 py-3 font-semibold text-white">Review my address</Link><Link href={`${request.path}/join`} className="rounded-xl border px-5 py-3">Check access again</Link><Link href={request.path} className="rounded-xl border px-5 py-3">Back to service</Link></div></main>;
}
