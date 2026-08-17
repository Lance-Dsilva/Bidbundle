import { SignIn } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import { AuthShowcase } from "@/components/auth/AuthShowcase";
import { db } from "@/lib/server/db";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ invitationId: string }> };

export default async function HoaInvitationSignInPage({ params }: PageProps) {
  const { invitationId } = await params;
  const { userId } = await auth();
  if (userId) redirect(`/hoa/accept/${invitationId}`);

  const invitation = await db.communityInvitation.findUnique({
    where: { id: invitationId },
    select: {
      status: true,
      expiresAt: true,
      community: { select: { name: true, type: true, status: true } },
    },
  });
  const usable =
    invitation?.status === "pending" &&
    invitation.community.type === "hoa" &&
    invitation.community.status === "active" &&
    (!invitation.expiresAt || invitation.expiresAt > new Date());

  return (
    <div className="signup-layout bg-white">
      <AuthShowcase
        testimonial={{
          quote: "Sign in with the exact email address that received this HOA invitation.",
          name: invitation?.community.name ?? "Bundleen HOA",
          location: "Invitation-only community",
          initials: "HOA",
        }}
      />
      <main className="relative flex min-w-0 items-center justify-center overflow-y-auto bg-[#f7f4ee] px-5 py-10 lg:px-12">
        {usable ? (
          <div className="w-full max-w-md">
            <p className="mb-3 text-center text-[11px] font-bold uppercase tracking-[0.16em] text-[#0f8f83]">
              Continue your HOA invitation
            </p>
            <SignIn
              path={`/hoa/invitation-sign-in/${invitationId}`}
              routing="path"
              withSignUp={false}
              transferable={false}
              forceRedirectUrl={`/hoa/accept/${invitationId}`}
              fallbackRedirectUrl={`/hoa/accept/${invitationId}`}
              appearance={{
                variables: {
                  colorPrimary: "#0f8f83",
                  colorForeground: "#1f2937",
                  colorBackground: "#ffffff",
                  borderRadius: "1rem",
                },
                elements: {
                  rootBox: "relative w-full",
                  cardBox: "w-full shadow-none",
                  card: "border border-[#d8e7e3] shadow-[0_24px_60px_rgba(31,26,20,0.10)]",
                  footerAction: "hidden",
                },
              }}
            />
          </div>
        ) : (
          <section className="w-full max-w-md rounded-2xl border border-[#e4e7ec] bg-white p-8 text-center shadow-xl">
            <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[#fff3e8] text-xl text-[#b45309]">!</span>
            <h1 className="mt-5 text-2xl font-bold text-[#1f2937]">Invitation unavailable</h1>
            <p className="mt-2 text-sm leading-6 text-[#667085]">
              This link was accepted, revoked, or expired. Ask the HOA manager to send a new invitation.
            </p>
          </section>
        )}
      </main>
    </div>
  );
}
