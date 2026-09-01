import { SignUp } from "@clerk/nextjs";

import { AuthShowcase } from "@/components/auth/AuthShowcase";
import { ClerkFormGate } from "@/components/auth/ClerkFormGate";
import { db } from "@/lib/server/db";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ grantId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AdminInvitationPage({ params, searchParams }: PageProps) {
  const [{ grantId }, query] = await Promise.all([params, searchParams]);
  const clerkTicket = query.__clerk_ticket;
  const hasInvitationTicket =
    typeof clerkTicket === "string" ? clerkTicket.length > 0 : Boolean(clerkTicket?.[0]);
  const grant = await db.adminAccessGrant.findUnique({
    where: { id: grantId },
    select: { email: true, inviteeName: true, level: true, status: true, invitationExpiresAt: true },
  });
  const usable =
    hasInvitationTicket &&
    grant?.level === "admin" &&
    grant.status === "pending" &&
    (!grant.invitationExpiresAt || grant.invitationExpiresAt > new Date());

  return (
    <div className="signup-layout bg-white">
      <AuthShowcase
        testimonial={{
          quote: "Private operations access for authorized Bundleen staff.",
          name: "Bundleen",
          location: "Internal portal",
          initials: "B",
        }}
      />
      <main
        className="relative flex min-w-0 items-center justify-center overflow-y-auto px-5 py-10 lg:px-12"
        style={{ background: "linear-gradient(180deg, #FAF6F0 0%, #F1ECE2 100%)" }}
      >
        {usable ? (
          <div className="w-full max-w-md">
            <p className="mb-3 text-center text-[11px] font-bold uppercase tracking-[0.16em] text-[#0f8f83]">
              Bundleen staff invitation{grant.inviteeName ? ` · ${grant.inviteeName}` : ""}
            </p>
            <ClerkFormGate context="invitation">
              <SignUp
                path={`/admin/join/${grantId}`}
                routing="path"
                signInUrl="/admin/sign-in"
                forceRedirectUrl="/auth/continue"
                fallbackRedirectUrl="/auth/continue"
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
            </ClerkFormGate>
          </div>
        ) : (
          <section className="w-full max-w-md rounded-2xl border border-[#e4e7ec] bg-white p-8 text-center shadow-xl">
            <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[#fff3e8] text-xl text-[#b45309]">!</span>
            <h1 className="mt-5 text-2xl font-bold text-[#1f2937]">Invitation unavailable</h1>
            <p className="mt-2 text-sm leading-6 text-[#667085]">
              This staff invitation is invalid, revoked, or expired. Ask the Bundleen primary owner to send a new invitation.
            </p>
          </section>
        )}
      </main>
    </div>
  );
}
