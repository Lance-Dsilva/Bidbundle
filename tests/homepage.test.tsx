// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

import HomePage from "@/app/page";

/**
 * The public homepage after the simplification pass.
 *
 * The previous page told the same story four times: a hero with an eyebrow, two
 * competing buttons, a provider link, a trust row and a dashboard mockup; four
 * step cards followed by a proof band and an example callout repeating them;
 * ten service cards; and three audience panels with their own mockups and CTAs.
 * These tests hold the shape of what replaced it — one CTA, three steps, three
 * benefits, and no numbers the product cannot yet stand behind.
 */

const ROOT = resolve(import.meta.dirname, "..");
const PAGE_SOURCE = readFileSync(resolve(ROOT, "src/app/page.tsx"), "utf8");
/** Stylesheet with comments stripped: prose about removed rules is not a rule. */
const CSS = readFileSync(resolve(ROOT, "src/app/landing.css"), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);

const MANAGER_CTA = "/get-started?intent=community-manager";
const PROVIDER_CTA = "/get-started?role=provider";

afterEach(cleanup);

describe("calls to action", () => {
  it("routes the manager CTA and the provider link to their existing destinations", () => {
    render(<HomePage />);

    const managerLinks = screen
      .getAllByRole("link")
      .filter((link) => link.getAttribute("href") === MANAGER_CTA);
    // Header, hero, and the closing section — one journey, three entry points.
    expect(managerLinks.length).toBeGreaterThanOrEqual(2);

    const providerLinks = screen
      .getAllByRole("link")
      .filter((link) => link.getAttribute("href") === PROVIDER_CTA);
    expect(providerLinks.length).toBeGreaterThanOrEqual(1);

    expect(screen.getAllByRole("link", { name: "Log in" }).length).toBeGreaterThanOrEqual(1);
  });

  it("gives the hero one action, not a cluster of competing ones", () => {
    render(<HomePage />);

    const hero = screen.getByRole("heading", { level: 1 }).closest("section")!;
    const buttons = within(hero)
      .getAllByRole("link")
      .filter((link) => link.className.includes("ld-btn"));
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveAttribute("href", MANAGER_CTA);

    // The provider path is present but visually secondary — a text link.
    const provider = within(hero).getByRole("link", { name: /Join as a provider/i });
    expect(provider.className).toContain("ld-text-link");
    expect(provider.className).not.toContain("ld-btn");
  });

  it("points residents at their own community rather than an open signup", () => {
    render(<HomePage />);
    const hero = screen.getByRole("heading", { level: 1 }).closest("section")!;
    expect(hero).toHaveTextContent(/Residents join through their own community/i);
    // No resident CTA competing with the manager's.
    expect(within(hero).queryByRole("link", { name: /I'?m a resident/i })).toBeNull();
  });
});

describe("navigation", () => {
  it("offers three in-page links, each targeting a section that exists", () => {
    render(<HomePage />);

    const desktopNav = screen.getByRole("navigation", { name: "Primary" });
    const links = within(desktopNav).getAllByRole("link");
    expect(links).toHaveLength(3);

    for (const link of links) {
      const id = link.getAttribute("href")!.slice(1);
      expect(document.getElementById(id), `#${id} has no section`).not.toBeNull();
    }
  });

  it("mirrors those links in the mobile menu alongside log in and the CTA", () => {
    const { container } = render(<HomePage />);
    // Queried the way `LandingInteractions` finds it, so the test breaks if the
    // hook the behaviour depends on is renamed.
    const mobileNav = container.querySelector<HTMLElement>("[data-mobile-menu]")!;
    const hrefs = [...mobileNav.querySelectorAll("a")].map((link) => link.getAttribute("href"));

    expect(hrefs).toEqual([
      "#how-it-works",
      "#who-its-for",
      "#services",
      "/sign-in",
      MANAGER_CTA,
    ]);
  });

  it("opens and closes the mobile menu, including with the keyboard", () => {
    const { container } = render(<HomePage />);
    const button = screen.getByRole("button", { name: "Open menu" });
    const menu = container.querySelector<HTMLElement>("[data-mobile-menu]")!;

    expect(menu).toHaveAttribute("hidden");
    expect(button).toHaveAttribute("aria-expanded", "false");
    // The control names the thing it controls, so a screen reader can follow.
    expect(button).toHaveAttribute("aria-controls", menu.id);

    fireEvent.click(button);
    expect(menu).not.toHaveAttribute("hidden");
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(button).toHaveAccessibleName("Close menu");

    // Escape closes it and hands focus back to the opener.
    fireEvent.keyDown(document, { key: "Escape" });
    expect(menu).toHaveAttribute("hidden");
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(document.activeElement).toBe(button);

    // Following a link closes it rather than leaving it over the destination.
    fireEvent.click(button);
    fireEvent.click(within(menu).getByText("Services"));
    expect(menu).toHaveAttribute("hidden");
  });
});

describe("structure and semantics", () => {
  it("has one h1 and no skipped heading levels", () => {
    render(<HomePage />);

    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);

    const levels = screen
      .getAllByRole("heading", { hidden: true })
      .map((heading) => Number(heading.tagName.slice(1)));
    let previous = 0;
    for (const level of levels) {
      expect(level - previous, `jumped from h${previous} to h${level}`).toBeLessThanOrEqual(1);
      previous = level;
    }
  });

  it("keeps the process to three steps and the benefits to three", () => {
    render(<HomePage />);

    const how = document.getElementById("how-it-works")!;
    expect(within(how).getAllByRole("listitem")).toHaveLength(3);

    const benefits = screen.getByRole("heading", { name: "Why communities use it" }).closest("section")!;
    expect(within(benefits).getAllByRole("heading", { level: 3 })).toHaveLength(3);
  });

  it("presents services as a short list of examples, not a card per service", () => {
    render(<HomePage />);

    const services = document.getElementById("services")!;
    const items = within(services).getAllByRole("listitem");
    expect(items.length).toBeLessThanOrEqual(6);
    expect(services).toHaveTextContent(/common examples, not a fixed list/i);
  });

  it("names every link and button", () => {
    render(<HomePage />);
    for (const element of [...screen.getAllByRole("link"), ...screen.getAllByRole("button")]) {
      expect(element).toHaveAccessibleName();
    }
  });

  it("separates decorative icons from meaningful artwork", () => {
    const { container } = render(<HomePage />);
    for (const svg of container.querySelectorAll("svg")) {
      expect(svg.getAttribute("aria-hidden")).toBe("true");
    }

    // Logos beside the visible brand name and the step icons are decorative.
    for (const img of container.querySelectorAll('img[alt=""]')) {
      expect(img.getAttribute("alt")).toBe("");
    }

    expect(
      screen.getByRole("img", {
        name: /local service team following one shared route between several homes/i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("img", {
        name: /community manager, resident, and local service professional/i,
      }),
    ).toBeInTheDocument();
  });

  it("uses original artwork to support rather than replace the written explanation", () => {
    render(<HomePage />);
    expect(
      screen.getByRole("img", {
        name: /local service team following one shared route between several homes/i,
      }),
    ).toHaveAttribute("src", expect.stringContaining("community-service-network.webp"));
    expect(screen.getByText(/When neighbors need the same service/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Providers offer on the whole group/i })).toBeInTheDocument();
  });
});

describe("claims removed with the redesign", () => {
  it("states no savings, timing, rating, price, or guarantee figures", () => {
    render(<HomePage />);
    const text = document.body.textContent ?? "";

    for (const claim of [
      "20–35%",
      "~3 weeks",
      "4.0★+",
      "$960",
      "$6,720",
      "$38",
      "24% less",
      "Guaranteed volume",
      "Zero marketing",
      "48-hour opt-out",
      "8–12 month",
    ]) {
      expect(text, `${claim} is still on the page`).not.toContain(claim);
    }

    // No bare percentage or dollar figure survives anywhere in the copy.
    expect(text).not.toMatch(/\d+\s?%/);
    expect(text).not.toMatch(/\$\d/);
  });

  it("drops the exaggerated and jargon phrasing the copy rules exclude", () => {
    render(<HomePage />);
    const text = (document.body.textContent ?? "").toLowerCase();
    for (const phrase of [
      "without lifting a finger",
      "do almost nothing",
      "pre-qualified",
      "auto-enrolled",
      "per-sq-ft",
      "ai analysis",
      "governance",
      "pipeline",
    ]) {
      expect(text, `"${phrase}" is still on the page`).not.toContain(phrase);
    }
  });

  it("does not sell AI as the product", () => {
    render(<HomePage />);
    // The value is coordinated purchasing; AI is not the pitch.
    expect(document.body.textContent).not.toMatch(/\bAI\b/);
  });

  it("removes the mockups, badges, and decorative sections rather than hiding them", () => {
    // Hidden decorative markup still ships to every visitor, so absence from
    // the source is the assertion, not absence from the rendered output.
    for (const marker of [
      "ld-dashboard-mock",
      "ld-floating-saving",
      "ld-proof-band",
      "ld-example-callout",
      "ld-service-card",
      "ld-audience-card",
      "ld-bid-preview",
      "ld-phone-preview",
      "ld-neighborhood-preview",
      "ld-trust-row",
      "ld-eyebrow",
      "ld-hero-glow",
    ]) {
      expect(PAGE_SOURCE, `${marker} is still rendered`).not.toContain(marker);
      expect(CSS, `${marker} still has styles`).not.toContain(marker);
    }
    // The float animation existed only for the savings badge.
    expect(CSS).not.toContain("ldFloat");
  });
});

describe("layout safety", () => {
  it("guards the page against horizontal scroll", () => {
    expect(CSS).toMatch(/\.landing-shell\s*\{[\s\S]*?overflow-x:\s*hidden/);
  });

  it("uses no fixed pixel width that could exceed a 390px viewport", () => {
    // Percentage and `min()` widths reflow; a hard `width: 420px` does not.
    const fixed = [...CSS.matchAll(/(?:^|[;{])\s*(?:min-)?width:\s*(\d+)px/g)]
      .map((match) => Number(match[1]))
      .filter((px) => px > 320);
    expect(fixed).toEqual([]);
  });

  it("keeps every in-page anchor clear of the sticky header", () => {
    for (const section of [".ld-how", ".ld-who", ".ld-services"]) {
      expect(CSS).toMatch(new RegExp(`\\${section}\\s*\\{[^}]*scroll-margin-top`));
    }
  });
});
