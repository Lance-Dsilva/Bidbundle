import { SignIn } from "@clerk/nextjs";

import { AuthShowcase } from "@/components/auth/AuthShowcase";

export default function SignInPage() {
  return (
    <div className="signup-layout bg-white">
      <AuthShowcase
        testimonial={{
          quote:
            "As a plumber, Bundleen sends me bundled jobs from the same neighborhood. Less driving, better margins.",
          name: "James Kowalski",
          location: "Service Provider",
          initials: "JK",
        }}
      />

      <main
        className="relative flex min-w-0 items-center justify-center overflow-x-hidden overflow-y-auto px-5 py-10 lg:px-12"
        style={{ background: "linear-gradient(180deg, #FAF6F0 0%, #F1ECE2 100%)" }}
      >
        <div
          className="pointer-events-none absolute right-[-8%] top-[12%] h-[260px] w-[260px] rounded-full opacity-70"
          style={{
            background:
              "radial-gradient(circle, rgba(224,135,88,0.16) 0%, transparent 68%)",
          }}
        />
        <SignIn
          path="/sign-in"
          routing="path"
          signUpUrl="/get-started"
          fallbackRedirectUrl="/auth/continue"
          appearance={{
            variables: {
              colorPrimary: "#0f8f83",
              colorForeground: "#1f2937",
              colorBackground: "#ffffff",
              borderRadius: "1rem",
            },
            elements: {
              rootBox: "relative w-full max-w-md",
              cardBox: "w-full shadow-none",
              card: "border border-[#e4e7ec] shadow-[0_24px_60px_rgba(31,26,20,0.10)]",
            },
          }}
        />
      </main>
    </div>
  );
}
