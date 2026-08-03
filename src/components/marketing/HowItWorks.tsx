import Link from "next/link";

const steps = [
  {
    n: "01",
    title: "Describe what you need",
    body: "Tell BidBundle the service you need in plain language. AI detects the category and surfaces nearby neighbors with the same request — instantly.",
    color: "#2563eb",
    tag: "AI-powered",
    icon: (
      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.6">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09Z" />
      </svg>
    ),
  },
  {
    n: "02",
    title: "Get grouped automatically",
    body: "Neighbors on the same request form a buying group. Providers quote the whole block at once — bulk demand means dramatically better pricing.",
    color: "#d97706",
    tag: "Instant",
    icon: (
      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.6">
        <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 0 0 3.741-.479 3 3 0 0 0-4.682-2.72m.94 3.198.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0 1 12 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 0 1 6 18.719m12 0a5.971 5.971 0 0 0-.941-3.197m0 0A5.995 5.995 0 0 0 12 12.75a5.995 5.995 0 0 0-5.058 2.772m0 0a3 3 0 0 0-4.681 2.72 8.986 8.986 0 0 0 3.74.477m.94-3.197a5.971 5.971 0 0 0-.94 3.197M15 6.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm6 3a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Zm-13.5 0a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Z" />
      </svg>
    ),
  },
  {
    n: "03",
    title: "Compare bids, confirm",
    body: "Providers submit transparent bids. You see every offer ranked by value and rating. Pick who you trust, confirm in one click.",
    color: "#0e7b56",
    tag: "Transparent",
    icon: (
      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.6">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
      </svg>
    ),
  },
];

const roles = [
  {
    role: "Homeowner",
    abbr: "H",
    bg: "#2563eb",
    headline: "Save more by sticking together",
    body: "Join neighbors on shared bids and watch your savings compound over time.",
    perks: ["Group pricing on every service", "AI category & group detection", "End-to-end bid tracking", "Chat with verified neighbors"],
  },
  {
    role: "Service Provider",
    abbr: "P",
    bg: "#d97706",
    headline: "Win bulk jobs, grow faster",
    body: "Real-time group job alerts, competitive bidding, and a verified reputation engine.",
    perks: ["Live group job notifications", "Competitive bulk bidding", "Verified review system", "Direct homeowner chat"],
  },
  {
    role: "HOA Admin",
    abbr: "A",
    bg: "#152033",
    headline: "Manage community savings",
    body: "Oversee eligibility, monitor participation, and report savings to your board.",
    perks: ["Approve HOA eligibility", "Community-wide analytics", "Savings & bid reports", "Activity audit log"],
  },
];

const neighborhoods = [
  "Oakwood Heights", "Lakeview Park", "Maplewood Commons", "Cedar Ridge",
  "Riverside District", "Hillcrest HOA", "Sunview Estates", "Birchwood",
];

export function HowItWorks() {
  return (
    <>
      {/* ── Social proof bar ── */}
      <section className="border-b border-divider px-6 py-5 lg:px-10" style={{ background: "#f8fafc" }}>
        <div className="mx-auto max-w-7xl">
          <div className="flex flex-col items-center gap-4 md:flex-row md:items-center md:justify-between">
            <p className="text-[12px] font-semibold uppercase tracking-[0.18em] text-muted">
              Trusted across 80+ neighborhoods
            </p>
            <div className="flex flex-wrap items-center justify-center gap-2 md:justify-end">
              {neighborhoods.map((name) => (
                <span
                  key={name}
                  className="rounded-full border border-divider bg-white px-3 py-1 text-[11px] font-medium text-muted shadow-sm"
                >
                  {name}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── How it works ── */}
      <section id="how-it-works" className="px-6 pb-0 pt-20 lg:px-10 lg:pt-28" style={{ background: "#f8fafc" }}>
        <div className="mx-auto max-w-7xl">
          <div data-reveal className="flex flex-col items-center text-center">
            <span className="inline-flex items-center gap-2 rounded-full border border-foreground/10 bg-white px-4 py-1.5 text-[11px] font-bold uppercase tracking-[0.2em] text-muted shadow-sm">
              How it works
            </span>
            <h2 className="mt-5 max-w-2xl font-display text-[2rem] font-bold italic leading-tight tracking-tightest text-foreground lg:text-[2.6rem]">
              Group demand gives neighbors
              <br className="hidden sm:block" /> better pricing.
            </h2>
            <p className="mt-4 max-w-lg text-[15px] leading-relaxed text-muted">
              Three steps. No solo negotiating. No middlemen.
              Just better prices because your neighbors need the same thing.
            </p>
          </div>

          {/* Steps — clean numbered cards with connecting line */}
          <div className="relative mt-14">
            {/* Connecting line on desktop */}
            <div
              className="absolute left-[2.75rem] top-8 hidden h-[calc(100%-4rem)] w-px lg:block"
              style={{ background: "linear-gradient(to bottom, #e5e0d8 0%, #e5e0d8 85%, transparent 100%)" }}
            />

            <div className="space-y-4">
              {steps.map((step, i) => (
                <div
                  key={step.n}
                  data-reveal
                  data-delay={String(i + 1) as "1" | "2" | "3"}
                  className="group relative flex gap-5 lg:gap-8"
                >
                  {/* Number circle */}
                  <div className="relative flex shrink-0 flex-col items-center">
                    <div
                      className="relative z-10 flex h-11 w-11 items-center justify-center rounded-full border-2 border-white font-display text-[13px] font-bold italic shadow-sm transition-transform duration-300 group-hover:scale-110"
                      style={{ background: `linear-gradient(135deg, ${step.color}18, ${step.color}10)`, color: step.color, borderColor: `${step.color}30` }}
                    >
                      {step.n}
                    </div>
                  </div>

                  {/* Content card */}
                  <div className="flex-1 rounded-2xl border border-divider bg-white p-6 shadow-card transition-all duration-300 hover:-translate-y-0.5 hover:shadow-card-hover lg:flex lg:items-center lg:gap-8">
                    <div
                      className="mb-4 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition-transform duration-300 group-hover:scale-105 lg:mb-0"
                      style={{ background: `${step.color}10`, color: step.color }}
                    >
                      {step.icon}
                    </div>

                    <div className="flex-1">
                      <div className="flex items-center gap-3">
                        <h3 className="text-[16px] font-semibold tracking-tight text-foreground">
                          {step.title}
                        </h3>
                        <span
                          className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide"
                          style={{ background: `${step.color}10`, color: step.color }}
                        >
                          {step.tag}
                        </span>
                      </div>
                      <p className="mt-1.5 text-[13px] leading-[1.7] text-muted">{step.body}</p>
                    </div>

                    <div className="mt-4 hidden shrink-0 lg:mt-0 lg:block">
                      <svg className="h-5 w-5 text-muted/30 transition-colors group-hover:text-muted/60" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="m9 18 6-6-6-6" />
                      </svg>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Savings bar */}
          <div
            data-reveal
            className="mt-8 flex flex-col items-center justify-between gap-5 rounded-3xl px-8 py-7 sm:flex-row"
            style={{ background: "linear-gradient(135deg, #0d1b2e 0%, #152033 50%, #1e2f48 100%)" }}
          >
            <div>
              <p className="font-display text-[1.5rem] font-bold italic text-white">
                Up to 40% off vs. solo quotes
              </p>
              <p className="mt-1 text-[13px] text-white/42">
                Real savings on plumbing, landscaping, cleaning, exterior work, and more.
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-6">
              {[
                { v: "$310", l: "Avg. saved", amber: true },
                { v: "14", l: "Neighbors / bid", amber: false },
                { v: "40%", l: "Typical discount", amber: false },
              ].map((s, i) => (
                <div key={s.l} className={`text-center ${i > 0 ? "border-l border-white/10 pl-6" : ""}`}>
                  <p className="font-display text-[1.7rem] font-bold italic" style={{ color: s.amber ? "#f59e0b" : "#ffffff" }}>
                    {s.v}
                  </p>
                  <p className="mt-0.5 text-[10px] uppercase tracking-wider text-white/35">{s.l}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Role showcase ── */}
      <section id="for-providers" className="px-6 py-20 lg:px-10 lg:py-28" style={{ background: "#f8fafc" }}>
        <div className="mx-auto max-w-7xl">
          <div data-reveal className="mx-auto max-w-xl text-center">
            <span className="inline-flex items-center gap-2 rounded-full border border-foreground/10 bg-white px-4 py-1.5 text-[11px] font-bold uppercase tracking-[0.2em] text-muted shadow-sm">
              Built for everyone
            </span>
            <h2 className="mt-5 font-display text-[2rem] font-bold italic leading-tight tracking-tightest text-foreground lg:text-[2.4rem]">
              One platform, three roles
            </h2>
          </div>

          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {roles.map((r, i) => (
              <div
                key={r.role}
                data-reveal="scale"
                data-delay={String(i + 1) as "1" | "2" | "3"}
                className="group relative overflow-hidden rounded-3xl border border-divider bg-white p-7 shadow-card transition-all duration-300 hover:-translate-y-1 hover:shadow-card-hover"
              >
                <div className="flex items-center gap-3">
                  <div
                    className="flex h-11 w-11 items-center justify-center rounded-2xl font-display text-sm font-bold italic text-white shadow-sm"
                    style={{ background: r.bg }}
                  >
                    {r.abbr}
                  </div>
                  <p className="text-[15px] font-semibold text-foreground">{r.role}</p>
                </div>
                <p className="mt-4 font-display text-[1.1rem] font-bold italic leading-snug tracking-tight text-foreground">
                  {r.headline}
                </p>
                <p className="mt-2 text-[13px] leading-[1.65] text-muted">{r.body}</p>
                <ul className="mt-5 space-y-2.5">
                  {r.perks.map((perk) => (
                    <li key={perk} className="flex items-center gap-2.5 text-[13px] text-foreground">
                      <span
                        className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full"
                        style={{ background: `${r.bg}14`, color: r.bg }}
                      >
                        <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="2.5">
                          <path strokeLinecap="round" strokeLinejoin="round" d="m2 6 2.5 2.5 5-5" />
                        </svg>
                      </span>
                      {perk}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Stats band ── */}
      <section id="savings" style={{ background: "#0d1b2e" }}>
        <div className="mx-auto max-w-7xl px-6 py-16 lg:px-10">
          <div data-reveal className="grid grid-cols-2 overflow-hidden rounded-3xl bg-white/4 ring-1 ring-white/8 md:grid-cols-4">
            {[
              { value: "2,400+", label: "Homeowners", amber: false },
              { value: "$750K", label: "Total saved", amber: true },
              { value: "47", label: "Verified providers", amber: false },
              { value: "4.8★", label: "Average rating", amber: false },
            ].map((stat, i) => (
              <div
                key={stat.label}
                className={`flex flex-col items-center justify-center gap-1 px-6 py-10 text-center ${i > 0 ? "border-l border-white/8" : ""}`}
              >
                <p
                  className="font-display text-[2.2rem] font-bold italic leading-none"
                  style={{ color: stat.amber ? "#f59e0b" : "#ffffff" }}
                >
                  {stat.value}
                </p>
                <p className="mt-1 text-[11px] uppercase tracking-widest text-white/35">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Pre-footer CTA ── */}
      <section style={{ background: "#07111e" }}>
        <div className="mx-auto max-w-7xl px-6 py-24 text-center lg:px-10">
          <div data-reveal>
            <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-white/35">
              Ready to start saving?
            </p>
            <h2 className="mt-4 font-display text-[2.4rem] font-bold italic leading-tight tracking-tightest text-white lg:text-[3.2rem]">
              Stop overpaying for<br />
              <span style={{ color: "#f59e0b" }}>home services alone.</span>
            </h2>
            <p className="mx-auto mt-5 max-w-lg text-[16px] leading-relaxed text-white/48">
              Join 2,400+ homeowners who use collective buying power to
              get group pricing from verified providers — in minutes.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row">
              <Link
                href="/get-started"
                className="inline-flex h-14 items-center gap-2 rounded-2xl bg-amber-500 px-9 text-[15px] font-bold text-white shadow-2xl shadow-amber-900/30 transition-all hover:bg-amber-400 hover:-translate-y-0.5"
              >
                Get started free
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m9 18 6-6-6-6" />
                </svg>
              </Link>
              <a
                href="#how-it-works"
                className="inline-flex h-14 items-center gap-2 rounded-2xl border border-white/12 px-9 text-[15px] font-medium text-white/60 transition-all hover:border-white/20 hover:text-white"
              >
                See how it works
              </a>
            </div>
            <p className="mt-5 text-[12px] text-white/25">
              Free to join · No credit card required · Cancel anytime
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
