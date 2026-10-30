import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Homepage design-system guards.
 *
 * The refinement pass replaced a stylesheet full of one-off values with a token
 * block. These assertions protect the two things that actually broke before —
 * text small enough to be unreadable, and a hero headline wide enough to push
 * its own column past the viewport — plus the rules the page must not lose:
 * a two-column service grid on mobile, content that paints without JavaScript,
 * and motion that respects `prefers-reduced-motion`.
 */

const ROOT = resolve(import.meta.dirname, "..");
const CSS = readFileSync(resolve(ROOT, "src/app/landing.css"), "utf8");
const PAGE = readFileSync(resolve(ROOT, "src/app/page.tsx"), "utf8");

/** Declarations with the token block and comments stripped out. */
function declarations(): string[] {
  return CSS.replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/[;{}]/)
    .map((line) => line.trim())
    .filter(Boolean);
}

describe("type scale", () => {
  it("declares one scale rather than ad-hoc sizes", () => {
    for (const token of [
      "--ld-text-2xs",
      "--ld-text-xs",
      "--ld-text-sm",
      "--ld-text-base",
      "--ld-text-md",
      "--ld-text-lg",
      "--ld-text-xl",
      "--ld-h1",
      "--ld-h2",
      "--ld-h3",
    ]) {
      expect(CSS).toContain(`${token}:`);
    }
  });

  it("never sets a rem font-size below the 11px readability floor", () => {
    // The mockups previously ran down to 0.52rem (~8px), which is where text
    // stops being information and becomes texture.
    const tooSmall = declarations()
      .filter((line) => /^font-size:\s*[\d.]+rem$/.test(line))
      .map((line) => Number(/([\d.]+)rem/.exec(line)![1]))
      .filter((rem) => rem < 0.6875);
    expect(tooSmall).toEqual([]);
  });

  it("caps the hero headline so it cannot outgrow its column", () => {
    // "neighborhood," is the widest single token in the headline. At 390px the
    // old `clamp(2.65rem, 13.3vw, 4.1rem)` resolved to ~52px and overflowed the
    // container, dragging the whole copy column off-screen behind the shell's
    // overflow guard.
    const mobileH1 = /--ld-h1:\s*clamp\(([^)]+)\)/g;
    const clamps = [...CSS.matchAll(mobileH1)].map((match) => match[1]!);
    expect(clamps.length).toBeGreaterThanOrEqual(2);

    for (const clamp of clamps) {
      const vw = Number(/([\d.]+)vw/.exec(clamp)?.[1] ?? "0");
      const max = Number(/([\d.]+)rem\s*\)?\s*$/.exec(clamp.trim())?.[1] ?? "99");
      expect(vw).toBeLessThanOrEqual(8.5);
      expect(max).toBeLessThanOrEqual(3.5);
    }
  });

  it("lets long words break rather than widen a grid column", () => {
    expect(CSS).toContain("overflow-wrap: break-word");
  });
});

describe("component consistency", () => {
  it("shares one radius, elevation, icon, and control scale", () => {
    for (const token of [
      "--ld-r-sm",
      "--ld-r-md",
      "--ld-r-lg",
      "--ld-r-xl",
      "--ld-r-pill",
      "--ld-shadow-sm",
      "--ld-shadow-md",
      "--ld-shadow-lg",
      "--ld-icon-sm",
      "--ld-icon-md",
      "--ld-icon-lg",
      "--ld-btn-h",
      "--ld-btn-h-sm",
    ]) {
      expect(CSS).toContain(`${token}:`);
    }
  });

  it("uses standard font weights only", () => {
    // The previous pass used 620/650/680/720/750/760/780/820/850, which render
    // as arbitrary synthetic weights and read inconsistently.
    const weights = declarations()
      .filter((line) => /^font-weight:\s*\d+$/.test(line))
      .map((line) => Number(/(\d+)/.exec(line)![1]));
    expect(weights.length).toBeGreaterThan(0);
    for (const weight of weights) {
      expect([400, 500, 600, 700, 800]).toContain(weight);
    }
  });

  it("keeps every interactive control at a usable touch height", () => {
    expect(CSS).toContain("--ld-btn-h: 52px");
    expect(CSS).toContain("--ld-btn-h-sm: 44px");
  });
});

describe("responsive behaviour", () => {
  it("collapses every multi-column grid to one column by the tablet width", () => {
    const tablet = CSS.slice(
      CSS.indexOf("@media (max-width: 850px)"),
      CSS.indexOf("@media (max-width: 640px)"),
    );
    for (const selector of [".ld-steps", ".ld-benefit-columns", ".ld-who-grid"]) {
      expect(tablet, `${selector} still has more than one column`).toMatch(
        new RegExp(`\\${selector}\\s*\\{[^}]*grid-template-columns:\\s*minmax\\(0, 1fr\\)`),
      );
    }
    // The who-it's-for rows drop their label column rather than squeezing it.
    expect(tablet).toMatch(/\.ld-who-list > div\s*\{[^}]*minmax\(0, 1fr\)/);
  });

  it("stacks the hero side by side only where there is room for it", () => {
    const laptop = CSS.slice(
      CSS.indexOf("@media (max-width: 1180px)"),
      CSS.indexOf("@media (max-width: 850px)"),
    );
    expect(laptop).toMatch(/\.ld-hero-grid\s*\{[^}]*minmax\(0, 1fr\)/);
  });

  it("keeps the primary CTA reachable at the smallest width", () => {
    // It used to be `display: none` below 390px, leaving the header with
    // nothing but a hamburger.
    const smallest = CSS.slice(CSS.indexOf("@media (max-width: 400px)"));
    expect(smallest).not.toMatch(/\.ld-auth-link-sign-up\s*\{[^}]*display:\s*none/);
  });

  it("guards the page against horizontal scroll", () => {
    expect(CSS).toMatch(/\.landing-shell\s*\{[\s\S]*?overflow-x:\s*hidden/);
  });
});

describe("progressive enhancement and motion", () => {
  it("paints every section without waiting for the reveal observer", () => {
    // `LandingInteractions` adds `.ld-is-visible` on scroll, but the base
    // state is already visible, so content is never hidden behind JavaScript.
    expect(CSS).toMatch(
      /\.ld-reveal-up,\s*\n\.ld-reveal-scale\s*\{\s*opacity:\s*1;\s*transform:\s*none/,
    );
  });

  it("disables animation, transition, and hover lift under reduced motion", () => {
    const reduced = CSS.slice(CSS.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(reduced).toContain("animation: none !important");
    expect(reduced).toContain("transition: none !important");
    expect(reduced).toMatch(/\.ld-btn:hover[\s\S]*transform:\s*none/);
  });

  it("keeps a visible focus ring on every interactive element", () => {
    expect(CSS).toMatch(/a:focus-visible[\s\S]*?outline:\s*3px solid/);
  });
});

describe("approved homepage content", () => {
  it("does not reintroduce the excluded one-time-job messaging", () => {
    for (const removed of ["Post a Request", "Neighbors Join", "one-time job"]) {
      expect(PAGE).not.toContain(removed);
    }
  });

  it("routes manager interest to staff onboarding and keeps provider signup distinct", () => {
    expect(PAGE).toContain('const managerCta = "/community-onboarding"');
    expect(PAGE).toContain('const providerCta = "/get-started?role=provider"');
  });
});
