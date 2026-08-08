import Link from "next/link";
import type { CSSProperties } from "react";

import { LandingInteractions } from "@/components/marketing/LandingInteractions";

import "./landing.css";

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
            <a className="is-active" href="#home">Home</a>
            <Link href="/post-request">Post a Request</Link>
            <a href="#services">Services</a>
            <a href="#how-it-works">How It Works</a>
          </nav>

          <div className="ld-header-actions">
            <Link className="ld-auth-link ld-auth-link-sign-in" href="/sign-in">
              Sign in
            </Link>
            <Link className="ld-auth-link ld-auth-link-sign-up" href="/get-started">
              Sign up
            </Link>
            <button className="ld-menu-button" type="button" aria-label="Open menu" aria-expanded="false" data-menu-button="">
              <span /><span /><span />
            </button>
          </div>
        </div>

        <nav className="ld-mobile-menu" aria-label="Mobile navigation" data-mobile-menu="" hidden>
          <a href="#home">Home</a>
          <Link href="/post-request">Post a Request</Link>
          <a href="#services">Services</a>
          <a href="#how-it-works">How It Works</a>
        </nav>
      </header>

      <main id="home">
        <section className="ld-hero ld-section-pad">
          <div className="ld-hero-blob ld-hero-blob-a" aria-hidden="true" />
          <div className="ld-hero-blob ld-hero-blob-b" aria-hidden="true" />
          <div className="ld-shell ld-hero-grid">
            <div className="ld-hero-copy ld-reveal-up">
              <div className="ld-eyebrow">
                <img src="/modern/icons/neighbors.svg" alt="" width={20} height={20} />
                <span>Stronger together. Better savings.</span>
              </div>

              <h1>
                Better Home Services.<br />
                Better Prices.<br />
                <span className="accent">Better Together.</span>
              </h1>

              <p className="ld-hero-lede">
                Post one request, bundle with nearby neighbors, and unlock better group pricing from trusted local providers.
              </p>

              <div className="ld-hero-actions">
                <Link className="ld-btn ld-btn-primary" href="/post-request">
                  <img src="/modern/icons/plus.svg" alt="" width={19} height={19} />
                  Post a Request
                </Link>
                <button className="ld-btn ld-btn-secondary" type="button" data-scroll-to="#how-it-works">
                  <img src="/modern/icons/play.svg" alt="" width={19} height={19} />
                  See How It Works
                </button>
              </div>

              <div className="ld-trust-row" aria-label="Trust highlights">
                <div className="ld-trust-chip"><img src="/modern/icons/shield.svg" alt="" width={18} height={18} />Verified Providers</div>
                <div className="ld-trust-chip"><img src="/modern/icons/check.svg" alt="" width={18} height={18} />No Obligation</div>
                <div className="ld-trust-chip"><img src="/modern/icons/star.svg" alt="" width={18} height={18} />4.9 Homeowner Rating</div>
              </div>
            </div>

            <div className="ld-hero-visual ld-reveal-scale" aria-label="Animated neighborhood bundle preview">
              <div className="ld-visual-card ld-bundle-status ld-float-card ld-float-a">
                <div className="ld-status-icon">
                  <img src="/modern/icons/neighbors.svg" alt="" width={24} height={24} />
                </div>
                <div>
                  <strong>Bundle forming...</strong>
                  <span>5 neighbors joined</span>
                </div>
                <div className="ld-avatar-stack" aria-hidden="true">
                  <span>SM</span><span>AJ</span><span>PK</span><span>NB</span><span>+1</span>
                </div>
                <div className="ld-bundle-progress"><span style={{ "--progress": "100%" } as CSSProperties} /></div>
              </div>

              <img className="ld-neighborhood-art" src="/modern/illustrations/neighborhood.svg" alt="Connected homes forming a service bundle" />

              <div className="ld-neighbor-dot ld-neighbor-one" aria-hidden="true">SM</div>
              <div className="ld-neighbor-dot ld-neighbor-two" aria-hidden="true">AJ</div>
              <div className="ld-neighbor-dot ld-neighbor-three" aria-hidden="true">NB</div>

              <svg className="ld-connection-lines" viewBox="0 0 620 460" aria-hidden="true">
                <path d="M122 127 C215 74, 274 120, 324 194" />
                <path d="M489 92 C423 117, 386 149, 353 205" />
                <path d="M104 327 C194 296, 257 277, 317 248" />
              </svg>

              <div className="ld-visual-card ld-savings-card ld-float-card ld-float-b">
                <div className="ld-card-label">Save up to</div>
                <strong className="ld-savings-percent" data-count="25">0%</strong>
                <span>More neighbors, more savings</span>
              </div>

              <div className="ld-visual-card ld-live-bids ld-float-card ld-float-c">
                <div className="ld-live-bids-head">
                  <div>
                    <strong>3 Bids Received</strong>
                    <span>Best price so far</span>
                  </div>
                  <span className="ld-live-dot">Live</span>
                </div>
                <div className="ld-bid-row"><span className="ld-provider-mark ld-mark-a">F</span><div><strong>Flow Plumbing</strong><span>★ 4.8</span></div><b>$168</b></div>
                <div className="ld-bid-row"><span className="ld-provider-mark ld-mark-b">P</span><div><strong>ProFix Services</strong><span>★ 4.6</span></div><b>$182</b></div>
                <div className="ld-bid-row"><span className="ld-provider-mark ld-mark-c">A</span><div><strong>Austin Plumbing</strong><span>★ 4.7</span></div><b>$195</b></div>
                <Link href="/sign-in">View your bids <span>→</span></Link>
              </div>
            </div>
          </div>

          <div className="ld-shell ld-stats-grid ld-reveal-up" id="requests">
            <article className="ld-metric-card ld-metric-teal">
              <div className="ld-metric-icon"><img src="/modern/icons/neighbors.svg" alt="" width={31} height={31} /></div>
              <div className="ld-metric-number" data-count="24">0</div>
              <h2>Active Bundles</h2>
              <p>+6 this week</p>
              <svg className="ld-mini-chart" viewBox="0 0 220 42" aria-hidden="true"><path d="M4 34 C27 18, 39 33, 58 20 S92 27, 111 15 S145 24, 165 11 S194 17, 216 4" /></svg>
            </article>
            <article className="ld-metric-card ld-metric-amber">
              <div className="ld-metric-icon"><img src="/modern/icons/clipboard.svg" alt="" width={31} height={31} /></div>
              <div className="ld-metric-number" data-count="12">0</div>
              <h2>Your Requests</h2>
              <p>3 in progress</p>
              <div className="ld-metric-progress"><span style={{ width: "68%" }} /></div>
            </article>
            <article className="ld-metric-card ld-metric-teal">
              <div className="ld-metric-icon"><img src="/modern/icons/savings.svg" alt="" width={31} height={31} /></div>
              <div className="ld-metric-number currency" data-count="2540">$0</div>
              <h2>Total Saved</h2>
              <p>by your neighborhood</p>
              <svg className="ld-mini-chart" viewBox="0 0 220 42" aria-hidden="true"><path d="M4 34 C27 15, 41 25, 61 14 S93 19, 113 10 S149 18, 171 8 S198 13, 216 2" /></svg>
            </article>
            <article className="ld-metric-card ld-metric-navy">
              <div className="ld-metric-icon"><img src="/modern/icons/gavel.svg" alt="" width={31} height={31} /></div>
              <div className="ld-metric-number" data-count="98">0%</div>
              <h2>Satisfaction Rate</h2>
              <p>based on reviews</p>
              <div className="ld-bar-chart" aria-hidden="true"><span /><span /><span /><span /><span /><span /><span /></div>
            </article>
          </div>
        </section>

        <section className="ld-activity-section ld-section-pad" aria-labelledby="activity-title">
          <div className="ld-shell">
            <div className="ld-section-heading ld-reveal-up">
              <div>
                <span className="ld-section-kicker">Live near you</span>
                <h2 id="activity-title">Neighborhood activity</h2>
                <p>See bundles forming and bids arriving around your community.</p>
              </div>
              <Link className="ld-text-link" href="/sign-in">View your activity →</Link>
            </div>

            <div className="ld-activity-grid">
              <article className="ld-activity-card ld-reveal-up">
                <div className="ld-activity-icon ld-activity-blue"><img src="/modern/icons/cleaning.svg" alt="" width={30} height={30} /></div>
                <div className="ld-activity-main">
                  <div className="ld-activity-title-row"><h3>Driveway pressure washing</h3><span className="ld-status ld-status-amber">Bundle forming</span></div>
                  <p>6 neighbors joined · closes in 1 day</p>
                  <div className="ld-activity-progress"><span style={{ width: "72%" }} /></div>
                </div>
                <div className="ld-activity-saving"><span>Est. savings</span><strong>$120</strong><small>22% off</small></div>
              </article>

              <article className="ld-activity-card ld-reveal-up">
                <div className="ld-activity-icon ld-activity-teal"><img src="/modern/icons/plumbing.svg" alt="" width={30} height={30} /></div>
                <div className="ld-activity-main">
                  <div className="ld-activity-title-row"><h3>Kitchen faucet installation</h3><span className="ld-status ld-status-purple">Bid received</span></div>
                  <p>3 bids received · Greenview Estates</p>
                  <div className="ld-activity-progress ld-activity-progress-purple"><span style={{ width: "88%" }} /></div>
                </div>
                <div className="ld-activity-saving"><span>Best bid</span><strong>$98</strong><small>Save $52</small></div>
              </article>
            </div>
          </div>
        </section>

        <section className="ld-how-section ld-section-pad" id="how-it-works" aria-labelledby="how-title">
          <div className="ld-shell">
            <div className="ld-section-heading ld-reveal-up">
              <div>
                <span className="ld-section-kicker">Simple by design</span>
                <h2 id="how-title">How Bundleen works</h2>
                <p>One request becomes a better neighborhood deal in four clear steps.</p>
              </div>
            </div>

            <div className="ld-steps-grid">
              <article className="ld-step-card ld-reveal-up"><span className="ld-step-index">1</span><div className="ld-step-art"><img src="/modern/illustrations/request.svg" alt="" /></div><h3>Post a request</h3><p>Tell us what home service you need.</p></article>
              <article className="ld-step-card ld-reveal-up"><span className="ld-step-index">2</span><div className="ld-step-art"><img src="/modern/illustrations/join.svg" alt="" /></div><h3>Neighbors join</h3><p>Nearby homeowners join the same bundle.</p></article>
              <article className="ld-step-card ld-reveal-up"><span className="ld-step-index">3</span><div className="ld-step-art"><img src="/modern/illustrations/bids.svg" alt="" /></div><h3>Providers compete</h3><p>Trusted providers submit group bids.</p></article>
              <article className="ld-step-card ld-reveal-up"><span className="ld-step-index">4</span><div className="ld-step-art"><img src="/modern/illustrations/save.svg" alt="" /></div><h3>Choose and save</h3><p>Pick the best value for everyone.</p></article>
            </div>
          </div>
        </section>

        <section className="ld-services-section ld-section-pad" id="services" aria-labelledby="services-title">
          <div className="ld-shell">
            <div className="ld-section-heading ld-reveal-up">
              <div>
                <span className="ld-section-kicker">Popular services</span>
                <h2 id="services-title">Start with what your home needs</h2>
              </div>
              <Link className="ld-text-link" href="/get-started">View all services →</Link>
            </div>
            <div className="ld-services-grid">
              <Link href="/get-started" className="ld-service-card ld-reveal-up"><span className="ld-service-art ld-service-teal"><img src="/modern/icons/cleaning.svg" alt="" /></span><strong>Cleaning</strong><small>Home, office</small></Link>
              <Link href="/get-started" className="ld-service-card ld-reveal-up"><span className="ld-service-art ld-service-blue"><img src="/modern/icons/plumbing.svg" alt="" /></span><strong>Plumbing</strong><small>Fix, install</small></Link>
              <Link href="/get-started" className="ld-service-card ld-reveal-up"><span className="ld-service-art ld-service-amber"><img src="/modern/icons/electrical.svg" alt="" /></span><strong>Electrical</strong><small>Repair, install</small></Link>
              <Link href="/get-started" className="ld-service-card ld-reveal-up"><span className="ld-service-art ld-service-purple"><img src="/modern/icons/painting.svg" alt="" /></span><strong>Painting</strong><small>Interior, exterior</small></Link>
            </div>
          </div>
        </section>

        <section className="ld-contact-cta ld-section-pad" id="contact" aria-labelledby="contact-cta-title">
          <div className="ld-shell">
            <div className="ld-contact-cta-card ld-reveal-up">
              <div className="ld-contact-cta-copy">
                <span className="ld-section-kicker">Ready when you are</span>
                <h2 id="contact-cta-title">Turn one home-service need into a better neighborhood deal.</h2>
                <p>Post your request, invite nearby homeowners, and compare competitive bids from trusted local providers.</p>
              </div>
              <div className="ld-contact-cta-actions">
                <Link className="ld-btn ld-btn-primary" href="/post-request"><img src="/modern/icons/plus.svg" alt="" width={19} height={19} /> Post a Request</Link>
                <a className="ld-btn ld-btn-secondary" href="mailto:hello@bundleen.com"><img src="/modern/icons/mail.svg" alt="" width={19} height={19} /> Contact Us</a>
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
          </div>

          <div className="ld-footer-column">
            <h3>Platform</h3>
            <a href="#how-it-works">How it works</a>
            <Link href="/get-started">Homeowners</Link>
            <Link href="/get-started">Service providers</Link>
            <Link href="/get-started">HOA communities</Link>
          </div>

          <div className="ld-footer-column">
            <h3>Support</h3>
            <Link href="/help">Help center</Link>
            <Link href="/safety">Safety and trust</Link>
            <Link href="/faq">Frequently asked questions</Link>
            <a href="#contact">Contact us</a>
          </div>

          <div className="ld-footer-column ld-footer-contact">
            <h3>Contact</h3>
            <a href="mailto:hello@bundleen.com"><img src="/modern/icons/mail.svg" alt="" /> hello@bundleen.com</a>
            <a href="mailto:support@bundleen.com"><img src="/modern/icons/mail.svg" alt="" /> support@bundleen.com</a>
            <a href="tel:+15125550148"><img src="/modern/icons/phone.svg" alt="" /> +1 (512) 555-0148</a>
            <span><img src="/modern/icons/map-pin.svg" alt="" /> Austin, Texas</span>
            <small>Mon–Fri · 9:00 AM–6:00 PM CT</small>
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
        <div className="ld-shell ld-footer-demo-note">Demo contact details — replace them before publishing.</div>
      </footer>

      <nav className="ld-mobile-bottom-nav" aria-label="Mobile app navigation">
        <Link className="is-active" href="/"><img src="/modern/icons/home.svg" alt="" /><span>Home</span></Link>
        <Link href="/sign-in"><img src="/modern/icons/chat.svg" alt="" /><span>Chat</span></Link>
        <Link href="/sign-in"><img src="/modern/icons/clipboard.svg" alt="" /><span>Bids</span></Link>
        <Link href="/sign-in"><img src="/modern/icons/profile.svg" alt="" /><span>Profile</span></Link>
      </nav>

      <LandingInteractions />
    </div>
  );
}
