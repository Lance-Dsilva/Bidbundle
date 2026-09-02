import Link from "next/link";

import { BundleenCompanyIcon } from "@/components/brand/BundleenCompanyIcon";
import { LandingInteractions } from "@/components/marketing/LandingInteractions";

import "./landing.css";

/**
 * The public homepage.
 *
 * One story, told once: neighbors with the same need become a single request,
 * local providers offer on the grouped work, and the community's manager picks
 * one. Everything that did not serve that story — the dashboard mockup, the
 * proof band, ten service cards, three audience sales panels with their own
 * mockups and CTAs — is gone rather than shrunk.
 *
 * Every number this page used to state (savings percentages, timelines, star
 * ratings, per-visit prices, contract sizes) was illustrative, and one of them
 * carried a code comment saying so. None of it is repeated here: where there is
 * no evidence, the page says what is true qualitatively instead.
 */

const managerCta = "/get-started?intent=community-manager";
const providerCta = "/get-started?role=provider";

/** Three links, each pointing at a section that exists. */
const navigation = [
  { href: "#how-it-works", label: "How it works" },
  { href: "#who-its-for", label: "Who it's for" },
  { href: "#services", label: "Services" },
];

const steps = [
  {
    title: "Residents say what they need",
    body: "Everyone shares which recurring service they want and how often they want it.",
  },
  {
    title: "Providers offer on the whole group",
    body: "Bundleen combines the homes into one request that local providers can offer on.",
  },
  {
    title: "You choose, and everyone follows along",
    body: "Compare the offers, pick one, and the community can see the schedule and each visit.",
  },
];

const benefits = [
  {
    title: "Better pricing from grouped work",
    body: "One request covering many nearby homes is worth more to a provider than one house at a time.",
  },
  {
    title: "Offers you can actually compare",
    body: "Every offer arrives in the same shape, so choosing one is a decision rather than an investigation.",
  },
  {
    title: "Less coordination for the community",
    body: "The request, the offers, the schedule, and what happened on each visit all live in one place.",
  },
];

const audiences = [
  {
    who: "Managers",
    body: "Organize the community's recurring services and choose the provider.",
  },
  {
    who: "Residents",
    body: "See the price, the schedule, and the progress of each visit.",
  },
  {
    who: "Providers",
    body: "Find grouped jobs close together, with less travel between homes.",
  },
];

const serviceExamples = [
  "Lawn care",
  "Cleaning",
  "Pool care",
  "Landscaping",
  "Gutters",
  "Seasonal maintenance",
];

/** A single house glyph, repeated to show a group. Decorative. */
function HouseGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        d="M3.5 10.6 12 4l8.5 6.6V20a.9.9 0 0 1-.9.9h-4.4v-5.6H8.8v5.6H4.4a.9.9 0 0 1-.9-.9Z"
        fill="currentColor"
      />
    </svg>
  );
}

/**
 * The one hero visual.
 *
 * Deliberately built from real HTML text rather than a fixed-viewBox SVG or a
 * scaled-down product screenshot: the labels reflow and stay at the page's own
 * type sizes at every width, so nothing here becomes texture on a phone the way
 * the old 11px dashboard mockup did. The three offer bars differ in length to
 * show that offers differ — they carry no prices, because Bundleen has no
 * published pricing evidence to quote.
 */
function GroupRequestFigure() {
  return (
    <figure className="ld-flow" aria-label="How one community request works">
      <div className="ld-flow-stage">
        <div className="ld-flow-homes" aria-hidden="true">
          <HouseGlyph />
          <HouseGlyph />
          <HouseGlyph />
          <HouseGlyph />
          <HouseGlyph />
        </div>
        <p className="ld-flow-label">Homes that want the same service</p>
      </div>

      <div className="ld-flow-arrow" aria-hidden="true" />

      <div className="ld-flow-stage">
        <div className="ld-flow-request">One community request</div>
        <p className="ld-flow-label">Combined into a single job</p>
      </div>

      <div className="ld-flow-arrow" aria-hidden="true" />

      <div className="ld-flow-stage">
        <ul className="ld-flow-offers">
          <li><span aria-hidden="true" style={{ width: "58%" }} />Offer</li>
          <li className="is-chosen">
            <span aria-hidden="true" style={{ width: "42%" }} />Offer
            <b>Chosen</b>
          </li>
          <li><span aria-hidden="true" style={{ width: "72%" }} />Offer</li>
        </ul>
        <p className="ld-flow-label">Providers compete, you pick one</p>
      </div>
    </figure>
  );
}

export default function HomePage() {
  return (
    <div className="landing-shell">
      <header className="ld-header">
        <div className="ld-shell ld-header-inner">
          <Link className="ld-brand" href="/" aria-label="Bundleen home">
            <BundleenCompanyIcon size={36} />
            <span>Bundleen</span>
          </Link>

          <nav className="ld-desktop-nav" aria-label="Primary">
            {navigation.map((item) => (
              <a href={item.href} key={item.href}>
                {item.label}
              </a>
            ))}
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
              aria-controls="mobile-menu"
              data-menu-button=""
            >
              <span />
              <span />
              <span />
            </button>
          </div>
        </div>

        <nav
          className="ld-mobile-menu"
          id="mobile-menu"
          aria-label="Mobile"
          data-mobile-menu=""
          hidden
        >
          {navigation.map((item) => (
            <a href={item.href} key={item.href}>
              {item.label}
            </a>
          ))}
          <Link href="/sign-in">Log in</Link>
          <Link className="ld-mobile-menu-cta" href={managerCta}>
            Get started
          </Link>
        </nav>
      </header>

      <main id="home">
        {/* ── Hero ───────────────────────────────────────────────────────── */}
        <section className="ld-hero ld-section-pad" aria-labelledby="hero-title">
          <div className="ld-shell ld-hero-grid">
            <div className="ld-hero-copy">
              <h1 id="hero-title">
                Group your community&apos;s home services into <span>one request</span>.
              </h1>

              <p className="ld-hero-lede">
                When neighbors need the same service, Bundleen combines them into one request.
                Local providers offer on the grouped work, and you choose the one that suits your
                community.
              </p>

              <div className="ld-hero-actions">
                <Link className="ld-btn ld-btn-primary" href={managerCta}>
                  Set up your community
                  <span aria-hidden="true">→</span>
                </Link>
              </div>

              <p className="ld-hero-aside">
                Residents join through their own community — ask your manager about Bundleen.{" "}
                <Link className="ld-text-link" href={providerCta}>
                  Run a service business? Join as a provider
                </Link>
              </p>
            </div>

            <GroupRequestFigure />
          </div>
        </section>

        {/* ── Three steps ────────────────────────────────────────────────── */}
        <section className="ld-how ld-section-pad" id="how-it-works" aria-labelledby="how-title">
          <div className="ld-shell">
            <h2 id="how-title">How it works</h2>

            <ol className="ld-steps">
              {steps.map((step, index) => (
                <li key={step.title}>
                  <span className="ld-step-number" aria-hidden="true">
                    {index + 1}
                  </span>
                  <h3>{step.title}</h3>
                  <p>{step.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* ── Benefits ───────────────────────────────────────────────────── */}
        <section className="ld-benefits ld-section-pad" aria-labelledby="benefits-title">
          <div className="ld-shell">
            <h2 id="benefits-title">Why communities use it</h2>

            <div className="ld-benefit-columns">
              {benefits.map((benefit) => (
                <div key={benefit.title}>
                  <h3>{benefit.title}</h3>
                  <p>{benefit.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Who it's for ───────────────────────────────────────────────── */}
        <section className="ld-who ld-section-pad" id="who-its-for" aria-labelledby="who-title">
          <div className="ld-shell">
            <h2 id="who-title">Who it&apos;s for</h2>

            <dl className="ld-who-list">
              {audiences.map((audience) => (
                <div key={audience.who}>
                  <dt>{audience.who}</dt>
                  <dd>{audience.body}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* ── Service examples ───────────────────────────────────────────── */}
        <section className="ld-services ld-section-pad" id="services" aria-labelledby="services-title">
          <div className="ld-shell">
            <h2 id="services-title">Services communities book again and again</h2>
            <p className="ld-lead">
              Grouping works best for work that repeats. These are common examples, not a fixed
              list.
            </p>

            <ul className="ld-service-list">
              {serviceExamples.map((service) => (
                <li key={service}>{service}</li>
              ))}
            </ul>
          </div>
        </section>

        {/* ── Final CTA ──────────────────────────────────────────────────── */}
        <section className="ld-final ld-section-pad" aria-labelledby="final-title">
          <div className="ld-shell ld-final-inner">
            <h2 id="final-title">Bring your community&apos;s services together.</h2>
            <div className="ld-final-actions">
              <Link className="ld-btn ld-btn-primary" href={managerCta}>
                Set up your community
                <span aria-hidden="true">→</span>
              </Link>
              <Link className="ld-text-link" href={providerCta}>
                Join as a provider
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="ld-footer">
        <div className="ld-shell ld-footer-grid">
          <div className="ld-footer-brand-column">
            <Link className="ld-footer-brand" href="/" aria-label="Bundleen home">
              <BundleenCompanyIcon size={36} />
              <span>Bundleen</span>
            </Link>
            <p>Recurring home services, grouped by community.</p>
          </div>

          <nav className="ld-footer-column" aria-label="Product">
            <h2>Product</h2>
            <a href="#how-it-works">How it works</a>
            <a href="#who-its-for">Who it&apos;s for</a>
            <a href="#services">Services</a>
          </nav>

          {/* Only destinations that exist. `/help`, `/privacy`, `/terms`,
              `/safety`, `/faq`, and `/accessibility` had no route behind them
              and answered 404 — see the completion notes. */}
          <nav className="ld-footer-column" aria-label="Help">
            <h2>Help</h2>
            <Link href="/help/how-bidding-works">How bidding works</Link>
            <Link href="/help/hoa-onboarding">Getting set up</Link>
            <Link href="/help/provider-verification">Provider verification</Link>
          </nav>

          <div className="ld-footer-column">
            <h2>Contact</h2>
            <a href="mailto:hello@bundleen.com">hello@bundleen.com</a>
            <a href="mailto:support@bundleen.com">support@bundleen.com</a>
            <span>Austin, Texas</span>
          </div>
        </div>

        <div className="ld-shell ld-footer-bottom">
          <span>© 2026 Bundleen Corp.</span>
          <Link href="/sign-in">Log in</Link>
        </div>
      </footer>

      <LandingInteractions />
    </div>
  );
}
