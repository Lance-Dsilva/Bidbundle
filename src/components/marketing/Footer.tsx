import Link from "next/link";

const columns = [
  {
    heading: "Product",
    links: [
      { label: "How it works", href: "#how-it-works" },
      { label: "For Homeowners", href: "/get-started" },
      { label: "For Providers", href: "#for-providers" },
      { label: "For HOA Admins", href: "/get-started" },
      { label: "Group Savings", href: "#savings" },
    ],
  },
  {
    heading: "Platform",
    links: [
      { label: "Get started", href: "/get-started" },
      { label: "Sign in", href: "/sign-in" },
      { label: "Mobile app", href: "/get-started" },
      { label: "API", href: "/get-started" },
    ],
  },
  {
    heading: "Company",
    links: [
      { label: "About", href: "/get-started" },
      { label: "Blog", href: "/get-started" },
      { label: "Careers", href: "/get-started" },
      { label: "Contact", href: "/get-started" },
      { label: "Privacy", href: "/get-started" },
      { label: "Terms", href: "/get-started" },
    ],
  },
];

export function Footer() {
  return (
    <footer
      className="relative overflow-hidden"
      style={{ background: "#07111e" }}
    >
      <div className="h-px w-full bg-gradient-to-r from-transparent via-white/6 to-transparent" />

      <div className="mx-auto max-w-7xl px-6 py-16 lg:px-10 lg:py-20">
        <div className="grid grid-cols-1 gap-12 md:grid-cols-4">

          {/* Brand column */}
          <div className="md:col-span-1">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-amber-400 to-amber-600 shadow-lg">
                <span className="font-display text-sm font-bold italic text-white">B</span>
              </div>
              <span className="font-display text-[17px] font-semibold italic text-white">
                Bundleen
              </span>
            </div>
            <p className="mt-4 max-w-[200px] text-[13px] leading-relaxed text-white/38">
              Community-powered home services. Your neighbourhood. Your power. Your price.
            </p>

            {/* Badges */}
            <div className="mt-6 flex flex-col gap-2">
              <div className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/8 px-3 py-1.5">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                <span className="text-[11px] font-semibold text-emerald-400">Live in 80+ neighborhoods</span>
              </div>
              <div className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/20 bg-amber-500/8 px-3 py-1.5">
                <span className="font-display text-[12px] font-bold italic text-amber-400">4.8★</span>
                <span className="text-[11px] text-amber-400/70">avg provider rating</span>
              </div>
            </div>
          </div>

          {/* Nav columns */}
          {columns.map((col) => (
            <div key={col.heading}>
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-white/30">
                {col.heading}
              </p>
              <ul className="mt-4 space-y-3">
                {col.links.map((link) => (
                  <li key={link.label}>
                    <Link
                      href={link.href}
                      className="text-[13px] text-white/45 transition-colors hover:text-white"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Bottom bar */}
        <div className="mt-16 flex flex-col items-center justify-between gap-4 border-t border-white/6 pt-8 sm:flex-row">
          <p className="text-[12px] text-white/25">
            © 2026 Bundleen, Inc. All rights reserved.
          </p>
          <div className="flex items-center gap-5 text-[12px] text-white/30">
            <Link href="/get-started" className="transition-colors hover:text-white/60">
              Privacy Policy
            </Link>
            <Link href="/get-started" className="transition-colors hover:text-white/60">
              Terms of Service
            </Link>
            <Link href="/get-started" className="transition-colors hover:text-white/60">
              Cookie Policy
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
