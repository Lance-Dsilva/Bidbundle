import type { ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";

import { BundleenCompanyIcon } from "@/components/brand/BundleenCompanyIcon";
import { LandingInteractions } from "./LandingInteractions";
import { PricingExample } from "./PricingExample";

import "@/app/landing.css";

type Action = { href: string; label: string };
type Step = { title: string; body: string };
type Benefit = Step & { icon: "leaf" | "clean" | "calendar" };
type AudienceLandingProps = {
  audience: "hoa" | "residents" | "providers";
  eyebrow: string;
  title: ReactNode;
  description: string;
  action: Action;
  entryGuidance?: ReactNode;
  pricingExample?: boolean;
  benefitsTitle: ReactNode;
  benefits: Benefit[];
  story: { title: ReactNode; paragraphs: string[]; plannedTerms: string };
  steps: Step[];
  questions: { question: string; answer: string }[];
  start: { title: ReactNode; body: string };
};

const navigation = [
  { href: "/", label: "For HOA boards" },
  { href: "/residents", label: "For residents" },
  { href: "/providers", label: "For providers" },
  { href: "/sign-in", label: "Sign in" },
];

function Arrow({ diagonal = false }: { diagonal?: boolean }) {
  return <svg aria-hidden="true" focusable="false"><use href={diagonal ? "#landing-arrow-up" : "#landing-arrow"} /></svg>;
}

function MarketingHeader({ action }: { action: Action }) {
  return (
    <header className="site-header">
      <div className="shell header-inner">
        <Link className="brand" href="/" aria-label="Bundleen home"><BundleenCompanyIcon size={35} /><span>Bundleen</span></Link>
        <nav className="desktop-nav" aria-label="Main navigation">
          {navigation.map((item) => <Link href={item.href} key={item.href}>{item.label}</Link>)}
        </nav>
        <div className="header-actions">
          <Link className="button header-cta" href={action.href}>{action.label} <Arrow /></Link>
          <button className="menu-button" type="button" aria-controls="mobile-menu" aria-expanded="false" aria-label="Open menu" data-menu-button=""><span /><span /></button>
        </div>
      </div>
      <nav className="mobile-menu shell" id="mobile-menu" aria-label="Mobile navigation" data-mobile-menu="" hidden>
        {navigation.map((item) => <Link href={item.href} key={item.href}>{item.label}</Link>)}
      </nav>
    </header>
  );
}

function MarketingFooter() {
  return (
    <footer className="site-footer shell">
      <div className="footer-top">
        <Link className="brand" href="/" aria-label="Bundleen home"><BundleenCompanyIcon size={32} /><span>Bundleen</span></Link>
        <p>Home services, with your neighbors.</p>
        <nav aria-label="Footer">
          {navigation.map((item) => <Link href={item.href} key={item.href}>{item.label}</Link>)}
        </nav>
      </div>
      <div className="footer-support">
        <nav aria-label="Help">
          <Link href="/help/how-bidding-works">How bidding works</Link>
          <Link href="/help/hoa-onboarding">Getting set up</Link>
          <Link href="/help/provider-verification">Provider verification</Link>
        </nav>
        <nav aria-label="Contact"><a href="mailto:hello@bundleen.com">hello@bundleen.com</a><a href="mailto:support@bundleen.com">support@bundleen.com</a></nav>
      </div>
      <div className="footer-note"><span>© 2026 Bundleen Corp.</span><span>AI-generated scenes are illustrative and do not show actual customers.</span></div>
    </footer>
  );
}

/** Shared public-page structure; every conversion action serves this audience. */
export function AudienceLanding(props: AudienceLandingProps) {
  return (
    <div className={`landing-shell audience-${props.audience}`}>
      <Link className="skip-link" href="#main">Skip to content</Link>
      <svg className="icon-definitions" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
        <defs>
          <symbol id="landing-leaf" viewBox="0 0 32 32"><path d="M26 5C13 4 5 10 7 19c2 9 18 7 19-14ZM6 27l14-15M13 20v-7M13 20h7" /></symbol>
          <symbol id="landing-clean" viewBox="0 0 32 32"><path d="m8 28 6-15h8l3 15ZM14 13V7h8v6M14 7h10M18 7V4h6M5 9v6M2 12h6M27 15v6M24 18h6" /></symbol>
          <symbol id="landing-calendar" viewBox="0 0 32 32"><rect x="5" y="7" width="22" height="21" rx="3" /><path d="M10 4v6M22 4v6M5 14h22m-17 6 4 4 8-7" /></symbol>
          <symbol id="landing-arrow" viewBox="0 0 24 24"><path d="M4 12h15m-6-6 6 6-6 6" /></symbol>
          <symbol id="landing-arrow-up" viewBox="0 0 24 24"><path d="M6 18 18 6M6 6h12v12" /></symbol>
        </defs>
      </svg>
      <MarketingHeader action={props.action} />
      <main id="main" tabIndex={-1}>
        <section className="hero shell" aria-labelledby="hero-title">
          <div className="hero-copy">
            <p className="eyebrow"><span className="little-line" aria-hidden="true" /> {props.eyebrow}</p>
            <h1 id="hero-title">{props.title}</h1>
            <p className="hero-description">{props.description}</p>
            {props.pricingExample && <PricingExample />}
            <div className="hero-actions">
              <Link className="button primary" href={props.action.href}>{props.action.label} <Arrow /></Link>
              <Link className="quiet-link" href="#how-it-works">See how it works <Arrow diagonal /></Link>
            </div>
            {props.entryGuidance && <div className="hero-footnote">{props.entryGuidance}</div>}
          </div>
          <figure className="hero-scene">
            <Image src="/marketing/homepage-v5/neighborhood-hero.png" width={1536} height={1024} alt="Illustrative scene of a homeowner and a service professional outside a home." priority sizes="(max-width: 899px) 100vw, (max-width: 1279px) 900px, (max-width: 1440px) 65.5vw, 944px" />
          </figure>
          <Link className="hero-scroll" href="#benefits"><span>Explore the benefits</span><span aria-hidden="true">↓</span></Link>
        </section>

        <section className="services shell" id="benefits" aria-labelledby="benefits-title">
          <div className="section-heading"><div><p className="eyebrow">For {props.audience === "hoa" ? "HOA boards and managers" : props.audience === "providers" ? "local service providers" : "your home and community"}</p><h2 id="benefits-title">{props.benefitsTitle}</h2></div></div>
          <ul className="service-list" role="list">
            {props.benefits.map((benefit) => <li className="service" key={benefit.title}><svg className="service-icon" aria-hidden="true" focusable="false"><use href={`#landing-${benefit.icon}`} /></svg><div><h3>{benefit.title}</h3><p>{benefit.body}</p></div></li>)}
          </ul>
        </section>

        <section className="shared-story shell" aria-labelledby="shared-title">
          <figure className="garden-scene"><Image src="/marketing/homepage-v5/garden-care.png" width={1536} height={1024} alt="Illustrative scene of a service professional tending a home garden." sizes="(max-width: 760px) 100vw, (max-width: 1279px) 50vw, (max-width: 1440px) 49vw, 705px" /></figure>
          <div className="story-copy">
            <p className="eyebrow">The community advantage</p>
            <h2 id="shared-title">{props.story.title}</h2>
            {props.story.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
            <div className="pilot-terms"><h3>Planned pilot terms</h3><p>{props.story.plannedTerms}</p></div>
          </div>
        </section>

        <section className="process-section" id="how-it-works" aria-labelledby="process-title">
          <div className="shell">
            <div className="process-heading"><p className="eyebrow">How it works</p><h2 id="process-title">A clear path<br />{" "}to a shared plan.</h2></div>
            <ol className="process-list" role="list">
              {props.steps.map((step, index) => <li key={step.title}><span className="step-number">0{index + 1} <span aria-hidden="true">—</span></span><h3>{step.title}</h3><p>{step.body}</p></li>)}
            </ol>
          </div>
        </section>

        <section className="faq-section shell" aria-labelledby="faq-title">
          <div><p className="eyebrow">Before you begin</p><h2 id="faq-title">Questions,<br />{" "}answered.</h2></div>
          <div className="faq-list">{props.questions.map(({ question, answer }) => <details key={question}><summary>{question}<span aria-hidden="true">+</span></summary><p>{answer}</p></details>)}</div>
        </section>

        <section className="start-section shell" id="start" aria-labelledby="start-title">
          <div className="start-copy"><p className="eyebrow">Your next step</p><h2 id="start-title">{props.start.title}</h2><p>{props.start.body}</p></div>
          <div className="start-actions"><Link className="button primary" href={props.action.href}>{props.action.label} <Arrow /></Link>{props.entryGuidance && <div className="coverage-helper">{props.entryGuidance}</div>}</div>
        </section>
      </main>
      <MarketingFooter />
      <LandingInteractions key={props.audience} />
    </div>
  );
}
