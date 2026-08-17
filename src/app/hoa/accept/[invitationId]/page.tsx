import { auth, currentUser } from "@clerk/nextjs/server";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AuthShowcase } from "@/components/auth/AuthShowcase";
import { acceptHoaInvitation, HoaWorkflowError } from "@/lib/server/hoa";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ invitationId: string }> };

export default async function AcceptHoaInvitationPage({ params }: PageProps) {
  const { invitationId } = await params;
  const { userId } = await auth();
  if (!userId) redirect(`/hoa/invitation-sign-in/${invitationId}`);

  const identity = await currentUser();
  const primaryEmail = identity?.emailAddresses.find(
    (item) => item.id === identity.primaryEmailAddressId,
  );
  let error: string | null = null;

  if (!identity || !primaryEmail) {
    error = "We could not read the verified email for this account.";
  } else {
    try {
      const destination = await acceptHoaInvitation({
        invitationId,
        clerkUserId: identity.id,
        email: primaryEmail.emailAddress,
        emailVerified: primaryEmail.verification?.status === "verified",
        fullName:
          identity.fullName ||
          [identity.firstName, identity.lastName].filter(Boolean).join(" ") ||
          primaryEmail.emailAddress.split("@")[0],
      });
      redirect(destination === "manager" ? "/app/hoa/dashboard" : "/app/homeowner/community");
    } catch (caught) {
      // Next's redirect throws an internal control-flow value that must not be
      // converted into an error card.
      if (typeof caught === "object" && caught !== null && "digest" in caught) throw caught;
      if (caught instanceof HoaWorkflowError) {
        error = caught.message;
      } else {
        console.error("[hoa] invitation acceptance failed", {
          name: caught instanceof Error ? caught.name : "UnknownError",
        });
        error = "We could not accept this invitation. Please try again.";
      }
    }
  }

  return (
    <div className="signup-layout bg-white">
      <AuthShowcase />
      <main className="flex flex-1 items-center justify-center bg-[#f7f4ee] px-5 py-10">
        <section className="w-full max-w-md rounded-2xl border border-[#e4e7ec] bg-white p-8 text-center shadow-xl">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[#fff3e8] text-xl text-[#b45309]">!</span>
          <h1 className="mt-5 text-2xl font-bold text-[#1f2937]">Invitation needs attention</h1>
          <p className="mt-2 text-sm leading-6 text-[#667085]">{error}</p>
          <Link className="mt-6 inline-flex h-11 items-center rounded-xl bg-[#0f8f83] px-6 text-sm font-semibold text-white" href={`/hoa/join/${invitationId}`}>
            Return to invitation
          </Link>
        </section>
      </main>
    </div>
  );
}
