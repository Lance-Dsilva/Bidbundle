import { auth } from "@clerk/nextjs/server";
import { SignIn } from "@clerk/nextjs";
import { redirect } from "next/navigation";

import { AuthShowcase } from "@/components/auth/AuthShowcase";

export default async function AdminSignInPage() {
  const { userId } = await auth();
  if (userId) redirect("/auth/continue");

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
        className="relative flex min-w-0 items-center justify-center overflow-x-hidden overflow-y-auto px-5 py-10 lg:px-12"
        style={{ background: "linear-gradient(180deg, #FAF6F0 0%, #F1ECE2 100%)" }}
      >
        <div className="w-full max-w-md">
          <p className="mb-3 text-center text-[11px] font-bold uppercase tracking-[0.16em]" style={{ color: "var(--teal-800)" }}>
            Authorized staff only
          </p>
          <SignIn
            path="/admin/sign-in"
            routing="path"
            withSignUp={false}
            transferable={false}
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
                card: "border border-[#e4e7ec] shadow-[0_24px_60px_rgba(31,26,20,0.10)]",
                footerAction: "hidden",
              },
            }}
          />
          <p className="mt-4 text-center text-[11px]" style={{ color: "var(--muted)" }}>
            There is no public admin registration. Access is granted by the Bundleen primary owner.
          </p>
        </div>
      </main>
    </div>
  );
}
