type Testimonial = {
  quote: string;
  name: string;
  location: string;
  initials: string;
};

const defaultTestimonial: Testimonial = {
  quote: "We saved $420 on landscaping by joining our block's group bid. Took two minutes to set up.",
  name: "Maria",
  location: "Austin, TX",
  initials: "MC",
};

const stats = [
  { value: "2,400+", label: "Members" },
  { value: "$310", label: "Average Savings", accent: true },
  { value: "40%", label: "Average Discount", accent: true },
];

export function AuthShowcase({ testimonial = defaultTestimonial }: { testimonial?: Testimonial }) {
  return (
    <div
      className="relative flex flex-col overflow-hidden lg:h-full"
      style={{
        background:
          "radial-gradient(circle at top left, #17324D 0%, transparent 45%), radial-gradient(circle at bottom right, #0F9D8A22 0%, transparent 45%), linear-gradient(180deg, #102A43 0%, #0A1F33 100%)",
      }}
    >
      <div className="pointer-events-none absolute inset-0 dot-grid opacity-55" />
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div
          className="absolute"
          style={{ width: 600, height: 600, background: "#35B7A5", filter: "blur(160px)", opacity: 0.18, right: -150, top: 40 }}
        />
      </div>

      <div className="relative flex flex-col px-6 py-8 lg:h-full lg:justify-between lg:px-12 lg:py-10">
        {/* Logo */}
        <div className="spring-in flex items-center gap-3" style={{ animationDelay: "0ms" }}>
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-amber-400 to-amber-600 shadow-lg">
            <span className="font-display text-[15px] font-bold italic text-white">B</span>
          </div>
          <span className="font-display text-[17px] font-semibold italic text-white">Bundleen</span>
        </div>

        <div className="max-w-md pt-8 pb-4 lg:pt-14 lg:pb-8">
          {/* Headline */}
          <h2 className="spring-in auth-headline break-words text-white" style={{ animationDelay: "100ms" }}>
            One request.
            <br />
            One neighbourhood.
            <br />
            <span style={{ color: "#f59e0b" }}>Better prices.</span>
          </h2>

          <p className="spring-in mt-4 text-[14px] leading-[1.75] text-white/50" style={{ animationDelay: "180ms" }}>
            Join thousands of homeowners, service providers, and HOA admins
            getting better prices through collective power.
          </p>

          {/* Illustration: connected homes, bundle forming */}
          <div className="spring-in relative mt-7 h-[180px]" style={{ animationDelay: "260ms" }}>
            <svg className="absolute inset-0 h-full w-full" viewBox="0 0 400 180" aria-hidden="true">
              <path pathLength={1} d="M60 60 C110 30, 150 40, 195 90" fill="none" stroke="#35B7A5" strokeWidth="2" strokeDasharray=".02 .025" strokeLinecap="round" style={{ animation: "ldRouteMove 7s linear infinite" }} />
              <path pathLength={1} d="M340 50 C290 24, 250 44, 210 88" fill="none" stroke="#35B7A5" strokeWidth="2" strokeDasharray=".02 .025" strokeLinecap="round" style={{ animation: "ldRouteMove 7s linear infinite" }} />
            </svg>
            <img
              src="/creative/illustrations/house-hero.svg"
              alt="Connected neighborhood homes"
              className="absolute bottom-0 left-1/2 w-[190px] -translate-x-1/2"
              style={{ animation: "ldHouseBreath 6s ease-in-out infinite" }}
            />
            <div
              className="absolute left-2 top-6 flex h-11 w-11 items-center justify-center rounded-full text-[11px] font-bold text-white"
              style={{ background: "linear-gradient(135deg,#0F9D8A,#087264)", border: "3px solid #102A43", animation: "ldNeighborFloat 4.8s ease-in-out infinite" }}
            >
              SM
            </div>
            <div
              className="absolute right-4 top-2 flex h-11 w-11 items-center justify-center rounded-full text-[11px] font-bold text-white"
              style={{ background: "linear-gradient(135deg,#F5A623,#B86E00)", border: "3px solid #102A43", animation: "ldNeighborFloat 4.8s ease-in-out infinite", animationDelay: "-1.6s" }}
            >
              AJ
            </div>
            <div
              className="absolute right-0 top-16 rounded-2xl px-3 py-2 text-[11px]"
              style={{ background: "rgba(255,255,255,.94)", boxShadow: "0 10px 24px rgba(16,42,67,.2)" }}
            >
              <strong className="block text-[12px] text-[#102A43]">Bundle forming</strong>
              <span className="text-[#667085]">Providers coming</span>
            </div>
          </div>

          {/* Stats + checklist + divider: desktop only */}
          <div className="hidden lg:block">
            <div className="spring-in my-7 h-px bg-gradient-to-r from-white/10 via-white/6 to-transparent" style={{ animationDelay: "340ms" }} />

            <div className="spring-in grid grid-cols-3 gap-3" style={{ animationDelay: "400ms" }}>
              {stats.map((stat) => (
                <div
                  key={stat.label}
                  className="rounded-[22px] border px-3 py-4 text-center backdrop-blur-sm"
                  style={{
                    borderColor: "rgba(255,255,255,0.08)",
                    background: "linear-gradient(180deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.04) 100%)",
                    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.03)",
                  }}
                >
                  <p className="text-[10px] uppercase tracking-[0.15em] text-white/35">{stat.label}</p>
                  <p className="mt-1.5 text-[1.8rem] font-bold leading-none" style={{ color: stat.accent ? "#f59e0b" : "#ffffff" }}>
                    {stat.value}
                  </p>
                </div>
              ))}
            </div>

            <ul className="spring-in mt-6 space-y-3" style={{ animationDelay: "460ms" }}>
              {[
                "Group pricing beats solo quotes every time",
                "AI-powered category & neighbor matching",
                "Transparent bids from verified providers",
              ].map((item) => (
                <li key={item} className="flex items-center gap-3 text-[13px] text-white/50">
                  <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-amber-500/20">
                    <svg className="h-2.5 w-2.5 text-amber-400" fill="none" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="2.5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="m2 6 2.5 2.5 5-5" />
                    </svg>
                  </span>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Testimonial: glass card, desktop only */}
        <div
          className="spring-in hidden rounded-[24px] border p-5 lg:block"
          style={{
            animationDelay: "540ms",
            borderColor: "rgba(255,255,255,0.14)",
            background: "rgba(255,255,255,0.08)",
            backdropFilter: "blur(20px)",
            WebkitBackdropFilter: "blur(20px)",
            boxShadow: "0 20px 50px rgba(0,0,0,.25)",
          }}
        >
          <div className="mb-3 flex gap-1">
            {[1, 2, 3, 4, 5].map((i) => (
              <span key={i} className="text-[16px] text-amber-400">★</span>
            ))}
          </div>
          <p className="text-[13px] leading-[1.7] text-white/70 italic">
            &ldquo;{testimonial.quote}&rdquo;
          </p>
          <div className="mt-4 flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full text-[11px] font-bold text-white" style={{ background: "linear-gradient(135deg,#0F9D8A,#35B7A5)" }}>
              {testimonial.initials}
            </div>
            <div>
              <p className="text-[12px] font-semibold text-white/90">{testimonial.name}</p>
              <p className="text-[11px] text-white/45">{testimonial.location}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
