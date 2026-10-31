import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import { BundleenCompanyIcon } from "@/components/brand/BundleenCompanyIcon";
import { LandingInteractions } from "@/components/marketing/LandingInteractions";

import "./landing.css";

export const metadata: Metadata = {
  title: "Bundleen — Home services, with your neighbors.",
  description:
    "Bundleen brings nearby homes into one service request so local providers can bid on grouped work. See how neighborhood services come together.",
};

const homeownerCta = "/get-started?role=homeowner";
const providerCta = "/get-started?role=provider";
const managerCta = "/community-onboarding";

const navigation = [
  { href: "#how-it-works", label: "How it works" },
  { href: "#services", label: "Services" },
  { href: "#hoa", label: "For HOAs" },
  { href: "#providers", label: "For providers" },
];

const services = [
  { icon: "leaf", title: "Lawn & garden", body: "Care for lawns and outdoor spaces." },
  {
    icon: "clean",
    title: "Home cleaning",
    body: "Cleaning for the spaces you use every day.",
  },
  {
    icon: "calendar",
    title: "Seasonal maintenance",
    body: "Home upkeep as the seasons change.",
  },
];

const steps = [
  {
    title: "Start with your address.",
    body: "Add your address during onboarding to see whether your home is in an active Bundleen neighborhood.",
  },
  {
    title: "Open or join a request.",
    body: "Eligible non-HOA homeowners can open or join a request. Nearby homes join before enrollment closes.",
  },
  {
    title: "Local providers bid.",
    body: "When the request opens for bidding, local providers submit bids for the grouped work.",
  },
  {
    title: "A provider is selected.",
    body: "Your community’s authorized manager selects the provider. Participating homes then follow the service schedule and visits.",
  },
];

const questions = [
  {
    question: "Do I need to be part of an HOA?",
    answer:
      "No. Eligible homeowners who are not part of an HOA can open or join requests. HOA residents join optional work through requests opened by their HOA manager.",
  },
  {
    question: "Is Bundleen available at my address?",
    answer:
      "Add your address during onboarding to check neighborhood eligibility. Creating an account does not guarantee coverage or provider bids.",
  },
  {
    question: "Who chooses the service provider?",
    answer:
      "Your community’s authorized manager selects the provider after bidding. Participating homes then follow the service schedule.",
  },
  {
    question: "Will I get a lower price?",
    answer:
      "Grouped work creates an opportunity for better pricing. Actual bids depend on the work, participating homes and service availability. A lower price or discount is not guaranteed.",
  },
];

function Arrow({ diagonal = false }: { diagonal?: boolean }) {
  return (
    <svg aria-hidden="true" focusable="false">
      <use href={diagonal ? "#landing-arrow-up" : "#landing-arrow"} />
    </svg>
  );
}

/** Server-rendered marketing content; the menu is the only client behavior. */
export default function HomePage() {
  return (
    <div className="landing-shell">
      <Link className="skip-link" href="#main">Skip to content</Link>

      <svg className="icon-definitions" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
        <defs>
          <symbol id="landing-leaf" viewBox="0 0 32 32">
            <path d="M26 5C13 4 5 10 7 19c2 9 18 7 19-14ZM6 27l14-15M13 20v-7M13 20h7" />
          </symbol>
          <symbol id="landing-clean" viewBox="0 0 32 32">
            <path d="m8 28 6-15h8l3 15ZM14 13V7h8v6M14 7h10M18 7V4h6M5 9v6M2 12h6M27 15v6M24 18h6" />
          </symbol>
          <symbol id="landing-calendar" viewBox="0 0 32 32">
            <rect x="5" y="7" width="22" height="21" rx="3" />
            <path d="M10 4v6M22 4v6M5 14h22m-17 6 4 4 8-7" />
          </symbol>
          <symbol id="landing-arrow" viewBox="0 0 24 24">
            <path d="M4 12h15m-6-6 6 6-6 6" />
          </symbol>
          <symbol id="landing-arrow-up" viewBox="0 0 24 24">
            <path d="M6 18 18 6M6 6h12v12" />
          </symbol>
        </defs>
      </svg>

      <header className="site-header">
        <div className="shell header-inner">
          <Link className="brand" href="/" aria-label="Bundleen home">
            <BundleenCompanyIcon size={35} />
            <span>Bundleen</span>
          </Link>
          <nav className="desktop-nav" aria-label="Main navigation">
            {navigation.map((item) => <Link href={item.href} key={item.href}>{item.label}</Link>)}
          </nav>
          <div className="header-actions">
            <Link className="sign-in" href="/sign-in">Sign in</Link>
            <Link className="button header-cta" href="#start">Get started <Arrow /></Link>
            <button
              className="menu-button"
              type="button"
              aria-controls="mobile-menu"
              aria-expanded="false"
              aria-label="Open menu"
              data-menu-button=""
            >
              <span />
              <span />
            </button>
          </div>
        </div>
        <nav
          className="mobile-menu shell"
          id="mobile-menu"
          aria-label="Mobile navigation"
          data-mobile-menu=""
          hidden
        >
          {navigation.map((item) => <Link href={item.href} key={item.href}>{item.label}</Link>)}
          <Link href="/sign-in">Sign in</Link>
        </nav>
      </header>

      <main id="main" tabIndex={-1}>
        <section className="hero shell" aria-labelledby="hero-title">
          <div className="hero-copy">
            <p className="eyebrow"><span className="little-line" aria-hidden="true" /> A neighborhood approach</p>
            <h1 id="hero-title">Home services, <em>with your neighbors.</em></h1>
            <p className="hero-description">
              Bring nearby homes into one service request. Local providers bid on the grouped work,
              creating an opportunity for better pricing.
            </p>
            <div className="hero-actions">
              <Link className="button primary" href="#start">Get started <Arrow /></Link>
              <Link className="quiet-link" href="#how-it-works">See how it works <Arrow diagonal /></Link>
            </div>
            <p className="hero-footnote">Availability varies by neighborhood.</p>
          </div>
          <figure className="hero-scene">
            <Image
              src="/marketing/homepage-v5/neighborhood-hero.png"
              width={1536}
              height={1024}
              alt="Illustrative scene of a homeowner and a service professional outside a home."
              priority
              sizes="(max-width: 899px) 100vw, (max-width: 1279px) 900px, (max-width: 1440px) 65.5vw, 944px"
            />
          </figure>
          <Link className="hero-scroll" href="#services">
            <span>Explore service examples</span><span aria-hidden="true">↓</span>
          </Link>
        </section>

        <section className="services shell" id="services" aria-labelledby="services-title">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Service examples</p>
              <h2 id="services-title">Start with what<br />{" "}your home needs.</h2>
            </div>
            <p>A few ways neighbors can bring similar needs together.</p>
          </div>
          <ul className="service-list" role="list">
            {services.map((service) => (
              <li className="service" key={service.title}>
                <svg className="service-icon" aria-hidden="true" focusable="false">
                  <use href={`#landing-${service.icon}`} />
                </svg>
                <div><h3>{service.title}</h3><p>{service.body}</p></div>
              </li>
            ))}
          </ul>
          <p className="availability">Examples only. Services vary by neighborhood and local providers.</p>
        </section>

        <section className="shared-story shell" aria-labelledby="shared-title">
          <figure className="garden-scene">
            <Image
              src="/marketing/homepage-v5/garden-care.png"
              width={1536}
              height={1024}
              alt="Illustrative scene of a service professional tending a home garden."
              sizes="(max-width: 760px) 100vw, (max-width: 1279px) 50vw, (max-width: 1440px) 49vw, 705px"
            />
          </figure>
          <div className="story-copy">
            <p className="eyebrow">The neighborhood advantage</p>
            <h2 id="shared-title">More homes.<br />{" "}<em>One shared request.</em></h2>
            <p>When nearby homes need the same service, they can join one request.</p>
            <p>
              More work in one place can mean less travel for providers and simpler planning for the
              group. That creates an opportunity for better pricing. Discounts are not guaranteed.
            </p>
            <Link className="quiet-link" href="#how-it-works">See how it works <Arrow /></Link>
          </div>
        </section>

        <section className="process-section" id="how-it-works" aria-labelledby="process-title">
          <div className="shell">
            <div className="process-heading">
              <p className="eyebrow">How it works</p>
              <h2 id="process-title">From your home<br />{" "}to a shared plan.</h2>
            </div>
            <ol className="process-list" role="list">
              {steps.map((step, index) => (
                <li key={step.title}>
                  <span className="step-number">0{index + 1} <span aria-hidden="true">—</span></span>
                  <h3>{step.title}</h3>
                  <p>{step.body}</p>
                </li>
              ))}
            </ol>
            <p className="process-note">
              <strong>Part of an HOA?</strong> Your HOA manager opens the requests. Residents join
              optional work through their community.
            </p>
          </div>
        </section>

        <section className="audiences shell" aria-labelledby="audiences-title">
          <div className="audience-intro">
            <p className="eyebrow">For HOA managers and providers</p>
            <h2 id="audiences-title">Bring local<br />{" "}<em>work together.</em></h2>
          </div>
          <div className="audience-list">
            <article id="hoa">
              <p className="eyebrow">For HOA managers</p>
              <h3>Plan services<br />{" "}for your community.</h3>
              <p>
                Open community requests and gather resident interest in optional work. Select a
                provider after bidding, then follow scheduling and visits.
              </p>
              <Link className="quiet-link" href={managerCta}>Get started for my HOA <Arrow diagonal /></Link>
            </article>
            <article id="providers">
              <p className="eyebrow">For local service providers</p>
              <h3>More nearby homes.<br />{" "}One service request.</h3>
              <p>
                Bid on grouped service requests from nearby homes. Review the shared need and put
                your business forward for the work.
              </p>
              <Link className="quiet-link" href={providerCta}>Get started as a provider <Arrow diagonal /></Link>
            </article>
          </div>
        </section>

        <section className="faq-section shell" aria-labelledby="faq-title">
          <div>
            <p className="eyebrow">Before you begin</p>
            <h2 id="faq-title">Questions,<br />{" "}answered.</h2>
          </div>
          <div className="faq-list">
            {questions.map(({ question, answer }) => (
              <details key={question}>
                <summary>{question}<span aria-hidden="true">+</span></summary>
                <p>{answer}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="start-section shell" id="start" aria-labelledby="start-title">
          <div className="start-copy">
            <p className="eyebrow">For your next home service</p>
            <h2 id="start-title">Start with your<br />{" "}<em>neighborhood.</em></h2>
            <p>Bring your next home service into a shared request.</p>
          </div>
          <div className="start-actions">
            <Link className="button primary" href={homeownerCta}>I’m a homeowner <Arrow /></Link>
            <p className="coverage-helper">
              Your address is checked during onboarding. Availability varies by neighborhood.
            </p>
            <Link className="quiet-link" href={providerCta}>I’m a service provider <Arrow diagonal /></Link>
            <Link className="quiet-link hoa-entry" href={managerCta}>I manage an HOA <Arrow diagonal /></Link>
          </div>
        </section>
      </main>

      <footer className="site-footer shell">
        <div className="footer-top">
          <Link className="brand" href="/" aria-label="Bundleen home">
            <BundleenCompanyIcon size={32} />
            <span>Bundleen</span>
          </Link>
          <p>Home services, with your neighbors.</p>
          <nav aria-label="Footer">
            <Link href="#how-it-works">How it works</Link>
            <Link href="#hoa">For HOAs</Link>
            <Link href="#providers">For providers</Link>
          </nav>
        </div>
        <div className="footer-support">
          <nav aria-label="Help">
            <Link href="/help/how-bidding-works">How bidding works</Link>
            <Link href="/help/hoa-onboarding">Getting set up</Link>
            <Link href="/help/provider-verification">Provider verification</Link>
          </nav>
          <nav aria-label="Contact">
            <a href="mailto:hello@bundleen.com">hello@bundleen.com</a>
            <a href="mailto:support@bundleen.com">support@bundleen.com</a>
          </nav>
        </div>
        <div className="footer-note">
          <span>© 2026 Bundleen Corp.</span>
          <span>AI-generated scenes are illustrative and do not show actual customers.</span>
        </div>
      </footer>

      <LandingInteractions />
    </div>
  );
}
