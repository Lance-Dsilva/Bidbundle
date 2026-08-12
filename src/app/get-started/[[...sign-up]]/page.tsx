import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import { AuthShowcase } from "@/components/auth/AuthShowcase";
import { NamedSignUp } from "@/components/auth/NamedSignUp";
import { db } from "@/lib/server/db";
import { DASHBOARD_BY_ROLE, isAppRole } from "@/lib/validation/auth";

export default async function SignUpPage() {
  const { userId } = await auth();
  let alreadyVerified = false;

  if (userId) {
    // A Clerk session can exist even when the Bundleen profile save previously
    // failed. Completed users go to their dashboard; incomplete users restart
    // the same visible onboarding flow instead of being dropped into a second,
    // older role/location form.
    const profile = await db.user.findUnique({
      where: { clerkUserId: userId },
      select: { role: true },
    });
    if (profile && isAppRole(profile.role)) redirect(DASHBOARD_BY_ROLE[profile.role]);
    alreadyVerified = true;
  }

  return (
    <div className="flex min-h-screen">
      <AuthShowcase
        testimonial={{
          quote:
            "We saved $420 on landscaping by joining our block's group bid. It took two minutes to set up.",
          name: "Maria",
          location: "Austin, TX",
          initials: "MC",
        }}
      />

      <main
        className="relative flex flex-1 items-center justify-center overflow-y-auto px-5 py-10"
        style={{ background: "linear-gradient(180deg, #FAF6F0 0%, #F1ECE2 100%)" }}
      >
        <div
          className="pointer-events-none absolute bottom-[10%] left-[-6%] h-[220px] w-[220px] rounded-full opacity-60"
          style={{
            background:
              "radial-gradient(circle, rgba(122,154,126,0.14) 0%, transparent 68%)",
          }}
        />
        <NamedSignUp alreadyVerified={alreadyVerified} />
      </main>
    </div>
  );
}
