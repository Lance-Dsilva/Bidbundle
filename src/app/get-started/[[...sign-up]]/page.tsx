import { SignUp } from "@clerk/nextjs";

import { AuthShowcase } from "@/components/auth/AuthShowcase";

export default function SignUpPage() {
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
        <SignUp
          path="/get-started"
          routing="path"
          signInUrl="/sign-in"
          forceRedirectUrl="/get-started/profile"
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
