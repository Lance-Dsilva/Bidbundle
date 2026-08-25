import Link from "next/link";

import { LandingInteractions } from "@/components/marketing/LandingInteractions";

import "./landing.css";

type MarketingIconName =
  | "clipboard"
  | "sparkle"
  | "handshake"
  | "approve"
  | "lawn"
  | "cleaning"
  | "gutter"
  | "window"
  | "power"
  | "landscape"
  | "pool"
  | "snow"
  | "yard"
  | "pressure";

function MarketingIcon({ name }: { name: MarketingIconName }) {
  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: 1.8,
  };

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" {...common}>
      {name === "clipboard" && (
        <>
          <path d="M9 5.2H6.8A1.8 1.8 0 0 0 5 7v12a1.8 1.8 0 0 0 1.8 1.8h10.4A1.8 1.8 0 0 0 19 19V7a1.8 1.8 0 0 0-1.8-1.8H15" />
          <rect x="8.5" y="3.2" width="7" height="4" rx="1.4" />
          <path d="m8.2 12 1.2 1.2 2-2.2M13.5 12h2.5m-7.8 4.5 1.2 1.2 2-2.2m2.1 1h2.5" />
        </>
      )}
      {name === "sparkle" && (
        <>
          <path d="M12 2.8c.7 3.8 2.6 5.7 6.4 6.4-3.8.7-5.7 2.6-6.4 6.4-.7-3.8-2.6-5.7-6.4-6.4C9.4 8.5 11.3 6.6 12 2.8Z" />
          <path d="M18.8 15.2c.3 1.8 1.2 2.7 3 3-1.8.3-2.7 1.2-3 3-.3-1.8-1.2-2.7-3-3 1.8-.3 2.7-1.2 3-3ZM5 15.5l-1.8 1.8M5 18.8 3.2 17" />
        </>
      )}
      {name === "handshake" && (
        <>
          <path d="m4.2 13.5-2-2 4.2-4.2 2 2m7.2 0 2-2 4.2 4.2-2 2" />
          <path d="m8 9.6 2.2-2.2c.8-.8 2-.8 2.8 0l1 1 1.1 1.1 3.5 3.5a1.5 1.5 0 0 1-2.1 2.1l-2.8-2.8 2.2 2.2a1.5 1.5 0 0 1-2.1 2.1l-2.2-2.2 1.6 1.6a1.5 1.5 0 0 1-2.1 2.1L7 14l-1.6-1.6" />
          <path d="m9.8 9.8 1.4 1.4c.6.6 1.6.6 2.2 0l1.4-1.4" />
        </>
      )}
      {name === "approve" && (
        <>
          <path d="M3.5 12.5 9 18l11.5-12" />
          <path d="M19.4 11.2a8.2 8.2 0 1 1-4.8-6.7" opacity=".45" />
        </>
      )}
      {name === "lawn" && (
        <>
          <path d="M4 19.5h16M6 19.2c0-5 2.2-8.2 6-10.2-.1 4.7-2 8-6 10.2Z" />
          <path d="M11.5 19.2c.2-3.7 2.4-6.4 6.5-7.9-.1 3.8-2.3 6.4-6.5 7.9ZM12 9V4.5" />
        </>
      )}
      {name === "cleaning" && (
        <>
          <path d="M7.2 11.3 9 4.2h6l1.8 7.1M5 20h14l-1.5-8H6.5L5 20Z" />
          <path d="M9.2 15.5h5.6M12 4.2V2.5" />
        </>
      )}
      {name === "gutter" && (
        <>
          <path d="m3 9 9-5 9 5M5.2 9v3.4h13.6V9" />
          <path d="M7 12.4v2.2c0 2.8 1.6 4.6 4.5 5.4M17 12.4v6.8" />
        </>
      )}
      {name === "window" && (
        <>
          <rect x="4" y="3.5" width="16" height="17" rx="1.5" />
          <path d="M12 3.5v17M4 12h16M7 8l2-2m6 11 2-2" />
        </>
      )}
      {name === "power" && (
        <>
          <path d="M7.5 4.5h9v6.8a4.5 4.5 0 0 1-9 0V4.5Z" />
          <path d="M10 2v2.5M14 2v2.5M12 15.8V22M8.5 22h7" />
        </>
      )}
      {name === "landscape" && (
        <>
          <path d="M12 21V9M12 13c-4 0-6.5-2.2-7-6 4 0 6.5 2 7 6ZM12 16c4 0 6.5-2.2 7-6-4 0-6.5 2-7 6Z" />
          <path d="M5 21h14" />
        </>
      )}
      {name === "pool" && (
        <>
          <path d="M4 8.5h11a3 3 0 0 1 3 3v1.2M7 8.5V5.8A2.8 2.8 0 0 1 9.8 3" />
          <path d="M3 15.5c1.5 1.2 3 1.2 4.5 0s3-1.2 4.5 0 3 1.2 4.5 0 3-1.2 4.5 0M3 19c1.5 1.2 3 1.2 4.5 0s3-1.2 4.5 0 3 1.2 4.5 0 3-1.2 4.5 0" />
        </>
      )}
      {name === "snow" && (
        <>
          <path d="M12 2.8v18.4M4 7.4l16 9.2M4 16.6l16-9.2" />
          <path d="m9 5.2 3 2 3-2M9 18.8l3-2 3 2M5.4 10.7 8.7 11l-1.4 3M18.6 13.3l-3.3-.3 1.4-3" />
        </>
      )}
      {name === "yard" && (
        <>
          <path d="M4 19.5h16M7 19.5c0-3.8-1.4-6.6-4-8.3 4.7-.1 7.7 2.7 8.8 8.3M17 19.5c0-3 1.2-5.2 3.6-6.7-4-.1-6.5 2.1-7.5 6.7" />
          <path d="M12 13V4m-3 3 3-3 3 3" />
        </>
      )}
      {name === "pressure" && (
        <>
          <path d="M4 17.5h8.5a3.5 3.5 0 0 0 0-7H9.2" />
          <path d="m5.5 7.5 3.7 3-3.7 3M15.5 5.5l4-2M16.5 9l4.5-.2M15.5 12.5l4 2" />
        </>
      )}
    </svg>
  );
}

const steps: Array<{
  title: string;
  description: string;
  icon: MarketingIconName;
  note?: string;
}> = [
  {
    title: "Manager runs a quick survey",
    description:
      "Residents say which recurring services they need, how often, and what they pay today. Takes 3 minutes.",
    icon: "clipboard",
  },
  {
    title: "AI builds the bundle",
    description:
      "Once enough homes are in, Bundleen's AI analyzes costs, property sizes, and frequency — and drafts a professional request automatically.",
    icon: "sparkle",
    note: "Manager always reviews before anything is posted.",
  },
  {
    title: "Verified providers bid",
    description:
      "Only vetted, 4.0★+ providers in your area see the request. They compete on clear per-visit or per-sq-ft pricing.",
    icon: "handshake",
  },
  {
    title: "Manager approves, everyone saves",
    description:
      "Manager picks the best bid in one click. Residents are auto-enrolled and notified with their exact savings.",
    icon: "approve",
  },
];

const services: Array<{
  name: string;
  frequency: string;
  icon: MarketingIconName;
}> = [
  { name: "Lawn Care", frequency: "Weekly / bi-weekly", icon: "lawn" },
  { name: "House Cleaning", frequency: "Monthly / seasonal", icon: "cleaning" },
  { name: "Gutter Cleaning", frequency: "Semi-annual / annual", icon: "gutter" },
  { name: "Window Cleaning", frequency: "Quarterly", icon: "window" },
  { name: "Power Washing", frequency: "Annual", icon: "power" },
  { name: "Landscape Maintenance", frequency: "Seasonal", icon: "landscape" },
  { name: "Pool Maintenance", frequency: "Weekly / bi-weekly", icon: "pool" },
  { name: "Snow Removal", frequency: "Seasonal", icon: "snow" },
  { name: "Yard Cleanup", frequency: "Seasonal", icon: "yard" },
  { name: "Pressure Washing", frequency: "Regular", icon: "pressure" },
];

const managerCta = "/get-started?intent=community-manager";
const providerCta = "/get-started?role=provider";

export default function HomePage() {
  return (
    <div className="landing-shell">
      <header className="ld-header">
        <div className="ld-shell ld-header-inner">
          <Link className="ld-brand" href="/" aria-label="Bundleen home">
            <img src="/modern/icons/logo.svg" alt="" width={42} height={42} />
            <span>Bundleen</span>
          </Link>

          <nav className="ld-desktop-nav" aria-label="Primary navigation">
            <a href="#how-it-works">How it works</a>
            <a href="#services">Services</a>
            <a href="#managers">For Managers</a>
            <a href="#residents">For Residents</a>
            <a href="#providers">For Providers</a>
          </nav>

          <div className="ld-header-actions">
            <Link className="ld-auth-link ld-auth-link-sign-in" href="/sign-in">
              Log in
            </Link>
            <Link className="ld-auth-link ld-auth-link-sign-up" href={managerCta}>
              Get started
            </Link>
            <button
              className="ld-menu-button"
              type="button"
              aria-label="Open menu"
              aria-expanded="false"
              data-menu-button=""
            >
              <span />
              <span />
              <span />
            </button>
          </div>
        </div>

        <nav className="ld-mobile-menu" aria-label="Mobile navigation" data-mobile-menu="" hidden>
          <a href="#how-it-works">How it works</a>
          <a href="#services">Services</a>
          <a href="#managers">For Managers</a>
          <a href="#residents">For Residents</a>
          <a href="#providers">For Providers</a>
          <Link href="/sign-in">Log in</Link>
          <Link className="ld-mobile-menu-cta" href={managerCta}>Get started</Link>
        </nav>
      </header>

      <main id="home">
        <section className="ld-hero ld-section-pad" aria-labelledby="hero-title">
          <div className="ld-hero-glow ld-hero-glow-left" aria-hidden="true" />
          <div className="ld-hero-glow ld-hero-glow-right" aria-hidden="true" />
          <div className="ld-shell ld-hero-grid">
            <div className="ld-hero-copy ld-reveal-up">
              <div className="ld-eyebrow">
                <MarketingIcon name="sparkle" />
                <span>Built for HOA &amp; neighborhood managers</span>
              </div>

              <h1 id="hero-title">
                Your whole neighborhood, <span>one better price.</span>
              </h1>

              <p className="ld-hero-lede">
                Bundleen helps HOA and neighborhood managers bundle recurring home services — lawn care, cleaning,
                gutters and more — so every resident saves 20–35% without lifting a finger.
              </p>

              <div className="ld-hero-actions">
                <Link className="ld-btn ld-btn-primary" href={managerCta}>
                  I manage a community
                  <span aria-hidden="true">→</span>
                </Link>
                <a className="ld-btn ld-btn-secondary" href="#residents">
                  I&apos;m a resident
                </a>
              </div>

              <Link className="ld-provider-link" href={providerCta}>
                Are you a service provider? <span>Join the provider network →</span>
              </Link>

              <div className="ld-trust-row" aria-label="Platform highlights">
                <span><img src="/modern/icons/shield.svg" alt="" />Verified providers</span>
                <span><MarketingIcon name="approve" />Manager-controlled</span>
                <span><img src="/modern/icons/savings.svg" alt="" />Transparent savings</span>
              </div>
            </div>

            <div className="ld-dashboard-mock ld-reveal-scale" aria-label="Bundleen manager dashboard preview">
              <div className="ld-mock-topbar">
                <div className="ld-mock-brand">
                  <img src="/modern/icons/logo.svg" alt="" />
                  <span>Community overview</span>
                </div>
                <span className="ld-mock-avatar">AJ</span>
              </div>

              <div className="ld-mock-body">
                <aside className="ld-mock-sidebar" aria-hidden="true">
                  <span className="is-active"><i />Overview</span>
                  <span><i />Surveys</span>
                  <span><i />Bundles</span>
                  <span><i />Residents</span>
                </aside>

                <div className="ld-mock-main">
                  <div className="ld-mock-heading">
                    <div>
                      <small>GREENVIEW ESTATES</small>
                      <strong>Good morning, Alex</strong>
                    </div>
                    <span className="ld-mock-action">Review bundle</span>
                  </div>

                  <article className="ld-ai-alert">
                    <div className="ld-ai-alert-icon"><MarketingIcon name="sparkle" /></div>
                    <div>
                      <span>AI ALERT</span>
                      <strong>Lawn Care bundle ready</strong>
                      <p>7 residents interested · AI analysis complete</p>
                    </div>
                    <span className="ld-ready-pill">Ready</span>
                  </article>

                  <div className="ld-mock-metrics">
                    <article>
                      <span>Projected annual savings</span>
                      <strong>$6,720</strong>
                      <small>Across 7 homes</small>
                    </article>
                    <article>
                      <span>Survey response</span>
                      <strong>7 / 12</strong>
                      <div className="ld-response-bar"><i /></div>
                    </article>
                  </div>

                  <article className="ld-mock-bundle-row">
                    <span className="ld-lawn-symbol"><MarketingIcon name="lawn" /></span>
                    <div><strong>Bi-weekly lawn care</strong><small>3 verified bids received</small></div>
                    <div className="ld-mini-avatars"><span>7</span><small>homes</small></div>
                    <strong className="ld-mock-saving">24% less</strong>
                  </article>
                </div>
              </div>

              <div className="ld-floating-saving" aria-hidden="true">
                <span>Community savings</span>
                <strong>+$960</strong>
                <small>per home / year</small>
              </div>
            </div>
          </div>
        </section>

        <section className="ld-how-section ld-section-pad" id="how-it-works" aria-labelledby="how-title">
          <div className="ld-shell">
            <div className="ld-centered-heading ld-reveal-up">
              <span className="ld-section-kicker">A smarter path to community pricing</span>
              <h2 id="how-title">How Bundleen works</h2>
              <p>From resident input to an approved recurring-service plan—without adding work to a manager&apos;s day.</p>
            </div>

            <div className="ld-steps-grid">
              {steps.map((step, index) => (
                <article className="ld-step-card ld-reveal-up" key={step.title}>
                  <span className="ld-step-index">{index + 1}</span>
                  <div className="ld-step-icon"><MarketingIcon name={step.icon} /></div>
                  <h3>{step.title}</h3>
                  <p>{step.description}</p>
                  {step.note ? <small>{step.note}</small> : null}
                </article>
              ))}
            </div>

            {/* Illustrative placeholder metrics until verified production data is available. */}
            <div className="ld-proof-band ld-reveal-up" aria-label="Illustrative Bundleen outcomes">
              <article><strong>20–35%</strong><span>Average savings vs. individual rates</span></article>
              <article><strong>~3 weeks</strong><span>Survey to first service</span></article>
              <article><strong>1 click</strong><span>For a manager to approve a bundle</span></article>
              <article><strong>4.0★+</strong><span>Minimum provider rating</span></article>
            </div>

            <aside className="ld-example-callout ld-reveal-up">
              <span className="ld-example-label">Example</span>
              <p>7 homes · bi-weekly lawn care · was $400/mo each → bundled at $320/mo.</p>
              <strong>$960 saved per home per year.</strong>
            </aside>
          </div>
        </section>

        <section className="ld-services-section ld-section-pad" id="services" aria-labelledby="services-title">
          <div className="ld-shell">
            <div className="ld-centered-heading ld-reveal-up">
              <span className="ld-section-kicker">Built for repeatable work</span>
              <h2 id="services-title">Recurring services we bundle</h2>
              <p>Predictable, repeatable services are where bulk pricing actually works.</p>
            </div>

            <div className="ld-services-grid">
              {services.map((service) => (
                <article className="ld-service-card ld-reveal-up" key={service.name}>
                  <span className="ld-service-icon"><MarketingIcon name={service.icon} /></span>
                  <h3>{service.name}</h3>
                  <span className="ld-frequency-pill">{service.frequency}</span>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="ld-audiences-section ld-section-pad" aria-labelledby="audiences-title">
          <div className="ld-shell">
            <div className="ld-centered-heading ld-reveal-up">
              <span className="ld-section-kicker">One platform, aligned incentives</span>
              <h2 id="audiences-title">Built for the whole community</h2>
              <p>Managers stay in control, residents see the value, and providers gain efficient recurring work.</p>
            </div>

            <div className="ld-audience-grid">
              <article className="ld-audience-card ld-manager-card ld-reveal-up" id="managers">
                <div className="ld-audience-label">For HOA &amp; Neighborhood Managers</div>
                <h3>Deliver real savings. Do almost nothing.</h3>
                <ul>
                  <li>AI handles analysis, request writing, and bid ranking — you just approve</li>
                  <li>Filter providers by rating and verification; you keep governance</li>
                  <li>Live savings dashboard for your community</li>
                  <li>Fewer resident complaints, one platform for everything</li>
                </ul>

                <div className="ld-bid-preview" aria-label="AI-ranked bid comparison preview">
                  <div className="ld-bid-preview-head"><span>AI bid comparison</span><small>3 verified bids</small></div>
                  <div className="ld-preview-bid is-recommended"><span>GreenLine Lawn</span><b>$38 / visit</b><small>Recommended</small></div>
                  <div className="ld-preview-bid"><span>Oak &amp; Stone</span><b>$42 / visit</b><small>4.8 ★</small></div>
                  <div className="ld-preview-bid"><span>FreshCut Co.</span><b>$45 / visit</b><small>4.7 ★</small></div>
                </div>

                <Link className="ld-card-cta" href={managerCta}>Start a community survey <span>→</span></Link>
              </article>

              <article className="ld-audience-card ld-resident-card ld-reveal-up" id="residents">
                <div className="ld-audience-label">For Residents</div>
                <h3>Same services, 20–35% less.</h3>
                <ul>
                  <li>No research, no haggling — your manager and AI do it</li>
                  <li>Pre-vetted providers with ratings and guarantees</li>
                  <li>See exactly what you save vs. what you pay now</li>
                  <li>Auto-enrolled if you surveyed, 48-hour opt-out window</li>
                </ul>

                <div className="ld-phone-preview" aria-label="Resident bundle approval notification preview">
                  <div className="ld-phone-speaker" />
                  <div className="ld-notification-app"><img src="/modern/icons/logo.svg" alt="" /><span>Bundleen</span><small>now</small></div>
                  <strong>✓ Your Lawn Care Bundle is Approved</strong>
                  <p>Service begins May 12. You save <b>$960/year.</b></p>
                  <span className="ld-opt-out-pill">48-hour opt-out window</span>
                </div>

                <a
                  className="ld-card-cta"
                  href="mailto:?subject=Ask%20your%20manager%20about%20Bundleen&body=Bundleen%20helps%20communities%20save%20on%20recurring%20home%20services.%20Learn%20more%20at%20https%3A%2F%2Fbundleen.com"
                >
                  Ask your manager about Bundleen <span>→</span>
                </a>
              </article>

              <article className="ld-audience-card ld-provider-card ld-reveal-up" id="providers">
                <div className="ld-audience-label">For Service Providers</div>
                <h3>Guaranteed volume. Zero marketing.</h3>
                <ul>
                  <li>5–10 homes per contract, 8–12 month terms</li>
                  <li>All homes in one neighborhood — minimal travel</li>
                  <li>Pre-qualified leads, standardized per-visit / per-sq-ft pricing</li>
                </ul>

                <div className="ld-neighborhood-preview" aria-label="One provider serving a cluster of nearby homes">
                  <img src="/modern/illustrations/neighborhood.svg" alt="Seven homes grouped into one efficient service route" />
                  <div className="ld-route-line" aria-hidden="true"><i /><i /><i /><i /></div>
                  <div className="ld-provider-truck"><span>Bundle route</span><i /></div>
                </div>

                <Link className="ld-card-cta" href={providerCta}>Become a verified provider <span>→</span></Link>
              </article>
            </div>
          </div>
        </section>

        <section className="ld-final-cta ld-section-pad" aria-labelledby="final-cta-title">
          <div className="ld-shell">
            <div className="ld-final-cta-card ld-reveal-up">
              <div>
                <span className="ld-section-kicker">Bring your community together</span>
                <h2 id="final-cta-title">Better recurring services start with one quick survey.</h2>
                <p>See what your community needs, let AI organize the details, and approve the best value.</p>
              </div>
              <div className="ld-final-cta-actions">
                <Link className="ld-btn ld-btn-primary" href={managerCta}>I manage a community <span>→</span></Link>
                <a className="ld-btn ld-btn-secondary" href="mailto:hello@bundleen.com?subject=Bundleen%20community%20demo">Book a demo</a>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="ld-footer" aria-labelledby="footer-heading">
        <div className="ld-shell ld-footer-grid">
          <div className="ld-footer-brand-column">
            <Link className="ld-footer-brand" href="/" aria-label="Bundleen home">
              <img src="/modern/icons/logo.svg" alt="" width={48} height={48} />
              <span>Bundleen</span>
            </Link>
            <p id="footer-heading">Better home services and better prices, built around the power of your neighborhood.</p>
            <strong>Recurring home services, bundled by community.</strong>
          </div>

          <div className="ld-footer-column">
            <h3>Platform</h3>
            <a href="#how-it-works">How it works</a>
            <a href="#services">Recurring services</a>
            <a href="#managers">For managers</a>
            <a href="#residents">For residents</a>
            <a href="#providers">For providers</a>
          </div>

          <div className="ld-footer-column">
            <h3>Support</h3>
            <Link href="/help">Help center</Link>
            <Link href="/safety">Safety and trust</Link>
            <Link href="/faq">Frequently asked questions</Link>
            <a href="mailto:support@bundleen.com">Contact support</a>
          </div>

          <div className="ld-footer-column ld-footer-contact">
            <h3>Contact</h3>
            <a href="mailto:hello@bundleen.com"><img src="/modern/icons/mail.svg" alt="" /> hello@bundleen.com</a>
            <a href="mailto:support@bundleen.com"><img src="/modern/icons/mail.svg" alt="" /> support@bundleen.com</a>
            <span><img src="/modern/icons/map-pin.svg" alt="" /> Austin, Texas</span>
          </div>
        </div>

        <div className="ld-shell ld-footer-bottom">
          <span>© 2026 Bundleen Corp. All rights reserved.</span>
          <div className="ld-footer-legal">
            <Link href="/privacy">Privacy Policy</Link>
            <Link href="/terms">Terms of Service</Link>
            <Link href="/accessibility">Accessibility</Link>
          </div>
        </div>
      </footer>

      <LandingInteractions />
    </div>
  );
}
