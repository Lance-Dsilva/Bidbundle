import { auth } from "@clerk/nextjs/server";
import { SignIn } from "@clerk/nextjs";
import { redirect } from "next/navigation";

import { AuthShowcase } from "@/components/auth/AuthShowcase";

export default async function HoaManagerSignInPage() {
  const { userId } = await auth();
  if (userId) redirect("/auth/continue");

  return (
    <div className="signup-layout bg-white">
      <AuthShowcase
        testimonial={{
          quote: "Keep residents informed, coordinate recurring services, and build stronger HOA bundles.",
          name: "Bundleen HOA",
          location: "Community operations",
          initials: "HOA",
        }}
      />
      <main
        className="relative flex min-w-0 items-center justify-center overflow-x-hidden overflow-y-auto px-5 py-10 lg:px-12"
        style={{ background: "linear-gradient(180deg, #F4FBF8 0%, #EDF5F2 100%)" }}
      >
        <div className="w-full max-w-md">
          <p className="mb-3 text-center text-[11px] font-bold uppercase tracking-[0.16em] text-[#0f8f83]">
            HOA manager portal
          </p>
          <SignIn
            path="/hoa/sign-in"
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
                card: "border border-[#d8e7e3] shadow-[0_24px_60px_rgba(31,26,20,0.10)]",
                footerAction: "hidden",
              },
            }}
          />
          <p className="mt-4 text-center text-xs leading-5 text-[#64748b]">
            HOA manager accounts are invitation-only. Residents use the link emailed by their manager.
          </p>
        </div>
      </main>
    </div>
  );
}
