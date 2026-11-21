import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/server/auth";
import { getPublicRequest } from "@/lib/server/public-request-sharing";
import { claimSharedEnrollmentFlow, getSharedEnrollmentOffer, getSharedEnrollmentReturnPath } from "@/lib/server/shared-enrollment";
import { SHARED_ENROLLMENT_COOKIE } from "@/lib/server/shared-enrollment-http";
import { SharedEnrollment } from "@/components/sharing/SharedEnrollment";
import { StartSharedEnrollment } from "@/components/sharing/StartSharedEnrollment";
import { HoaWorkflowError } from "@/lib/server/hoa";
export const dynamic = "force-dynamic";
export default async function SharedEnrollmentPage({ params }: { params: Promise<{ communitySlug: string; requestToken: string }> }) {
 const {communitySlug,requestToken}=await params;
 const request=await getPublicRequest(communitySlug,requestToken);if(!request)notFound();
 const token=(await cookies()).get(SHARED_ENROLLMENT_COOKIE)?.value;
 if(!token)return <main className="mx-auto max-w-xl px-5 py-12"><h1 className="text-2xl font-semibold">Continue to your community service</h1><StartSharedEnrollment communityToken={communitySlug} requestToken={requestToken}/></main>;
 const user=await requireRole(["homeowner"],`${request.path}/join`);
 try{
  if(await getSharedEnrollmentReturnPath(token)!==`${request.path}/join`)throw new HoaWorkflowError("Open this service link again to start its enrollment.",409);
  const state=await claimSharedEnrollmentFlow(user.id,token);
  if(state.requestPath!==request.path)throw new HoaWorkflowError("Open this service link again to start its enrollment.",409);
  const offer=state.stage==="card"?await getSharedEnrollmentOffer(user.id,token):undefined;
  return <main className="mx-auto max-w-xl px-5 py-12"><SharedEnrollment token={token} state={state} offer={offer}/></main>;
 }catch(error){
  if(!(error instanceof HoaWorkflowError))throw error;
  return <main className="mx-auto max-w-xl space-y-5 px-5 py-12"><h1 className="text-2xl font-semibold">Continue enrollment</h1><p role="status">{error.message}</p><StartSharedEnrollment communityToken={communitySlug} requestToken={requestToken}/><Link href={request.path} className="block underline">Back to this service</Link></main>;
 }
}
