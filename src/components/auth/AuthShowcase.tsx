type Testimonial = {
  quote: string;
  name: string;
  location: string;
  initials: string;
};

type AuthShowcaseProps = {
  testimonial?: Testimonial;
};

const benefits = [
  {
    icon: "/creative/icons/users.svg",
    text: "Group pricing beats solo quotes",
  },
  {
    icon: "/modern/icons/shield.svg",
    text: "Trusted, verified service providers",
  },
  {
    icon: "/bundleen/icons/sparkle.svg",
    text: "Transparent bids you can compare",
  },
];

/** The light signup story panel shown in the supplied desktop references. */
export function AuthShowcase(_props: AuthShowcaseProps) {
  return (
    <aside className="auth-showcase relative hidden min-h-screen overflow-hidden lg:flex lg:w-[38%] lg:shrink-0 lg:flex-col">
      <div className="pointer-events-none absolute inset-0 auth-showcase-glow" />
      <div className="relative z-10 flex min-h-screen flex-col px-[clamp(38px,5vw,58px)] py-12">
        <div className="flex items-center gap-3">
          <img src="/modern/icons/logo.svg" alt="" className="h-9 w-9" />
          <span className="text-[22px] font-extrabold tracking-[-0.035em] text-[#0f1e32]">
            Bundleen
          </span>
        </div>

        <div className="mt-[70px] max-w-[470px]">
          <h2 className="text-[clamp(36px,3.15vw,49px)] font-extrabold leading-[1.08] tracking-[-0.045em] text-[#0c192c]">
            One request.
            <br />
            One neighbourhood.
            <br />
            <span className="text-[#13965f]">Better prices.</span>
          </h2>
          <p className="mt-7 max-w-[425px] text-[17px] leading-[1.75] text-[#647089]">
            Join thousands of homeowners, service providers, and HOA admins getting better prices
            through collective power.
          </p>
        </div>

        <div className="relative mt-6 h-[245px] max-w-[500px]" aria-label="Neighbors forming a service bundle">
          <svg className="absolute inset-x-5 top-4 h-[115px] w-[calc(100%-40px)]" viewBox="0 0 460 115" fill="none" aria-hidden="true">
            <path d="M40 58C91 12 157 20 204 77" stroke="#149768" strokeWidth="1.7" strokeDasharray="3 4" />
            <path d="M220 36C273 3 341 18 400 62" stroke="#149768" strokeWidth="1.7" strokeDasharray="3 4" />
            <path d="M40 59v22M220 36v38M400 62v23" stroke="#d8ede4" strokeWidth="2" />
          </svg>

          {[
            { initials: "SM", left: "6%", top: 34 },
            { initials: "AJ", left: "48%", top: 0 },
            { initials: "MC", right: "4%", top: 44 },
          ].map((avatar) => (
            <span
              key={avatar.initials}
              className="absolute z-20 flex h-11 w-11 items-center justify-center rounded-full border-2 border-[#16966a] bg-white text-[11px] font-bold text-[#0d6f50] shadow-sm"
              style={{ left: avatar.left, right: avatar.right, top: avatar.top }}
            >
              {avatar.initials}
            </span>
          ))}

          <div className="absolute inset-x-2 bottom-0 h-[178px]">
            <img
              src="/modern/illustrations/neighborhood.svg"
              alt="Neighborhood homes"
              className="absolute bottom-[-5px] left-1/2 z-10 w-[445px] max-w-full -translate-x-1/2"
            />
            <div className="absolute bottom-0 left-[8%] h-[76px] w-[110px] rounded-[55%_45%_10%_10%] bg-[#dcedd8]/75" />
            <div className="absolute bottom-0 right-[7%] h-[68px] w-[120px] rounded-[45%_55%_10%_10%] bg-[#dcedd8]/75" />
          </div>

          <div className="absolute bottom-[-5px] right-[1%] z-20 flex items-center gap-3 rounded-2xl border border-[#d9e4e0] bg-white px-4 py-3 shadow-[0_10px_28px_rgba(15,74,54,.09)]">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#e9f7f1]">
              <img src="/creative/icons/users.svg" alt="" className="h-5 w-5" />
            </span>
            <span>
              <strong className="block text-[12px] font-semibold text-[#087a51]">Bundle forming</strong>
              <span className="text-[11px] text-[#7a8499]">Providers coming</span>
            </span>
          </div>
        </div>

        <ul className="mt-auto space-y-4 pb-3">
          {benefits.map((benefit) => (
            <li key={benefit.text} className="flex items-center gap-4 text-[16px] font-medium text-[#1e2a3c]">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-[#8ed0b6] bg-white/70">
                <img src={benefit.icon} alt="" className="h-6 w-6" />
              </span>
              {benefit.text}
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}
