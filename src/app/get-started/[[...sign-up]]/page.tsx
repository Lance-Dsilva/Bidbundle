import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import { AuthShowcase } from "@/components/auth/AuthShowcase";
import { NamedSignUp } from "@/components/auth/NamedSignUp";

export default async function SignUpPage() {
  // Once Clerk has created a complete session, skip mounting <SignUp /> again.
  // The prebuilt component otherwise briefly redirects signed-in users through
  // its Home URL before our onboarding redirect becomes visible.
  const { userId } = await auth();
  if (userId) redirect("/get-started/profile");

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
        <NamedSignUp />
      </main>
    </div>
  );
}
