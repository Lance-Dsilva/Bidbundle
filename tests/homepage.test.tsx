// @vitest-environment jsdom
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";

import HomePage, { metadata as hoaMetadata } from "@/app/page";
import ResidentsPage, { metadata as residentMetadata } from "@/app/residents/page";
import ProvidersPage, { metadata as providerMetadata } from "@/app/providers/page";
import { installMatchMediaStub } from "./stubs/match-media";

const ROOT = resolve(import.meta.dirname, "..");
const NAVIGATION = [
  ["For residents", "/residents"],
  ["For providers", "/providers"],
  ["Sign in", "/sign-in"],
] as const;
const AUDIENCES = [
  { name: "HOA", Page: HomePage, heading: "Better prices. Stronger communities.", action: "Bring Bundleen to your community", href: "/community-onboarding" },
  { name: "resident", Page: ResidentsPage, heading: "Your neighbors. Your next service.", action: "Open my community", href: "/app/homeowner/community" },
  { name: "provider", Page: ProvidersPage, heading: "Nearby homes. Better routes.", action: "Apply as a provider", href: "/get-started?role=provider" },
] as const;

function mobileMenu() {
  const button = screen.getByRole("button", { name: /^(Open|Close) menu$/ });
  const menu = document.getElementById(button.getAttribute("aria-controls")!)!;
  expect(menu).not.toBeNull();
  return { button, menu };
}

function section(id: string) {
  const element = document.getElementById(id);
  expect(element, `Missing destination #${id}`).not.toBeNull();
  return element!;
}

let media: ReturnType<typeof installMatchMediaStub>;
beforeEach(() => { media = installMatchMediaStub(false); });
afterEach(cleanup);

describe("audience-specific entry points", () => {
  it.each(AUDIENCES)("gives the $name page one audience's conversion destination", ({ Page, heading, action, href }) => {
    render(<Page />);
    const hero = screen.getByRole("heading", { level: 1, name: heading }).closest("section")!;
    expect(within(hero).getByRole("link", { name: action })).toHaveAttribute("href", href);
    expect(within(hero).getByRole("link", { name: "See how it works" })).toHaveAttribute("href", "#how-it-works");
    const start = section("start");
    const bottomLinks = within(start).getAllByRole("link");
    expect(bottomLinks).toHaveLength(1);
    expect(bottomLinks[0]).toHaveAccessibleName(action);
    expect(bottomLinks[0]).toHaveAttribute("href", href);
    expect(within(screen.getByRole("banner")).getByRole("link", { name: action })).toHaveAttribute("href", href);
    for (const other of AUDIENCES.filter((audience) => audience.action !== action)) {
      expect(within(screen.getByRole("main")).queryByRole("link", { name: other.action })).not.toBeInTheDocument();
    }
    expect(hero).not.toHaveTextContent(/prepaid|refund|guarantee|revenue sharing|10%/i);
    expect(start).not.toHaveTextContent(/prepaid|refund|guarantee|revenue sharing|10%/i);
  });

  it("introduces the HOA offer without a homeowner-address entry point", () => {
    render(<HomePage />);
    const hero = screen.getByRole("heading", { level: 1 }).closest("section")!;
    expect(hero).toHaveTextContent("For HOA boards and community managers");
    expect(hero).toHaveTextContent("at no cost to your HOA");
    expect(hero).not.toHaveTextContent(/start with your address|address check/i);
    expect(screen.getByRole("main")).not.toHaveTextContent(/I’m a homeowner|I’m a service provider|I manage an HOA/);
  });

  it("distinguishes existing resident access from joining through an emailed invitation", () => {
    render(<ResidentsPage />);
    for (const target of [screen.getByRole("heading", { level: 1 }).closest("section")!, section("start")]) {
      expect(target).toHaveTextContent("Already joined through your HOA? Open your community.");
      expect(target).toHaveTextContent("New here? Open the invitation link in your HOA’s email to join the right community.");
      expect(within(target).getByRole("link", { name: "Open my community" })).toHaveAttribute("href", "/app/homeowner/community");
    }
    expect(screen.getByRole("main")).not.toHaveTextContent(/start with your address|find communities near|search communities/i);
    const pricingBenefit = screen.getByRole("heading", { name: "A clear shared price" }).parentElement!;
    expect(pricingBenefit).toHaveTextContent("Compare provider bids and see the agreed price on your community’s request.");
    expect(pricingBenefit).not.toHaveTextContent(/price before (?:committing|joining)/i);
    expect(document.querySelector("form,input,select")).toBeNull();
  });

  it("keeps provider applications on the supported route and avoids resident pricing promises", () => {
    render(<ProvidersPage />);
    expect(screen.getAllByRole("link", { name: "Apply as a provider" }).every((link) => link.getAttribute("href") === "/get-started?role=provider")).toBe(true);
    expect(screen.queryByText("Example · Pool cleaning")).not.toBeInTheDocument();
    expect(screen.getByRole("main")).not.toHaveTextContent(/prepaid jobs|guaranteed work|guaranteed volume/i);
    expect(screen.getByRole("main")).toHaveTextContent("creating a profile alone does not establish verification");
  });

  it("publishes distinct, audience-specific metadata", () => {
    const metadata = [hoaMetadata, residentMetadata, providerMetadata];
    expect(new Set(metadata.map((item) => item.title)).size).toBe(3);
    expect(new Set(metadata.map((item) => item.description)).size).toBe(3);
    expect(hoaMetadata.title).toMatch(/HOAs/);
    expect(hoaMetadata.description).toMatch(/HOA|association/);
    expect(residentMetadata.title).toMatch(/residents/);
    expect(residentMetadata.description).toMatch(/invitation/);
    expect(providerMetadata.title).toMatch(/providers/);
    expect(providerMetadata.description).toMatch(/Apply|provider/);
  });
});

describe("qualified examples and planned terms", () => {
  it.each(AUDIENCES.slice(0, 2))("retains the complete illustrative pricing example on the $name page", ({ Page }) => {
    render(<Page />);
    const hero = screen.getByRole("heading", { level: 1 }).closest("section")!;
    const example = within(hero).getByText("Example · Pool cleaning").parentElement!;
    const solo = within(example).getByText("On your own").parentElement!;
    const group = within(example).getByText("With 20 homes").parentElement!;
    expect(within(solo).getByText("$180")).toBeInTheDocument();
    expect(within(group).getByText("$150")).toBeInTheDocument();
    for (const price of [solo, group]) expect(within(price).getByText("/month per home")).toBeInTheDocument();
    expect(example).toHaveTextContent("Save $30/month per home — about 17% in this example.");
    expect(example).toHaveTextContent("Illustrative request: 20 homes joined · 4 competing provider bids.");
    expect(example).toHaveTextContent("Example pricing. Your community’s price is set by real provider bids.");
    expect(screen.getAllByText("Example pricing. Your community’s price is set by real provider bids.")).toHaveLength(1);
    expect(document.body).not.toHaveTextContent(/not guaranteed|opportunity for better pricing/i);
  });

  it.each(AUDIENCES)("labels unavailable payment/guarantee/share terms as planned on the $name page", ({ Page, name }) => {
    render(<Page />);
    const terms = screen.getByRole("heading", { name: "Planned pilot terms" }).parentElement!;
    expect(terms).toHaveTextContent(/planned/);
    expect(terms).toHaveTextContent(/before|will be/);
    if (name === "HOA") expect(terms).toHaveTextContent(/Reserve-fund revenue sharing is planned/);
    if (name === "resident") expect(terms).toHaveTextContent(/payments after completed visits and a redo-or-refund policy are planned/);
    if (name === "provider") expect(terms).toHaveTextContent(/planned with no lead fees and a 10% platform fee only on paid work/);
  });

  it.each(AUDIENCES)("makes no fabricated numeric proof or operational promises on the $name page", ({ Page }) => {
    render(<Page />);
    const example = screen.queryByText("Example · Pool cleaning")?.parentElement;
    const planned = screen.getByRole("heading", { name: "Planned pilot terms" }).parentElement!;
    const text = (document.body.textContent ?? "").replace(example?.textContent ?? "", "").replace(planned.textContent!, "");
    expect(text).not.toMatch(/\d+\s?%|\$\d|\d(?:\.\d)?\s?[★⭐]/);
    for (const phrase of ["guaranteed volume", "zero marketing", "48-hour opt-out", "without lifting a finger", "do almost nothing", "pre-qualified", "auto-enrolled", "background-checked", "vetted providers", "guaranteed savings", "prepaid jobs", "book now", "join for free"]) {
      expect(text.toLowerCase()).not.toContain(phrase);
    }
  });
});

describe("audience content and progressive rendering", () => {
  it.each(AUDIENCES)("uses ordered service steps and native FAQ disclosures on the $name page", ({ Page }) => {
    const { container } = render(<Page />);
    const process = section("how-it-works");
    const list = within(process).getByRole("list");
    expect(list.tagName).toBe("OL");
    expect(within(list).getAllByRole("listitem")).toHaveLength(4);
    const disclosures = [...container.querySelectorAll("details")];
    expect(disclosures).toHaveLength(4);
    for (const disclosure of disclosures) {
      expect(disclosure.querySelector("summary")?.textContent?.trim().length).toBeGreaterThan(5);
      expect(disclosure.querySelector("p")?.textContent?.trim().length).toBeGreaterThan(40);
      expect(disclosure).not.toHaveAttribute("open");
    }
    const benefits = section("benefits");
    expect(within(benefits).getAllByRole("listitem")).toHaveLength(3);
    expect(benefits.querySelector("a,button,input,select,[role='button'],[tabindex]")).toBeNull();
  });

  it.each(AUDIENCES)("renders the $name page without client effects or reveal observers", ({ Page }) => {
    const server = document.createElement("div");
    server.innerHTML = renderToStaticMarkup(<Page />);
    for (const id of ["benefits", "how-it-works", "start"]) {
      const target = server.querySelector(`#${id}`)!;
      expect(target).not.toBeNull();
      expect(target.closest('[hidden],[aria-hidden="true"]')).toBeNull();
      expect(target.textContent!.length).toBeGreaterThan(40);
    }
    expect(server.querySelector('main[hidden],section[hidden],article[hidden],[data-reveal]')).toBeNull();
    expect(server.querySelector("dialog,[role='dialog'],[data-preview-path],form,input,select")).toBeNull();
    expect(server.textContent).not.toMatch(/Homepage design proposal|Design preview|Back to the preview|preview ends here/i);
  });
});

describe("navigation and mobile menu", () => {
  it("uses the three shared destinations in desktop/mobile navigation and valid fragment targets", () => {
    const { container } = render(<HomePage />);
    const mobile = mobileMenu().menu;
    expect(mobile.tagName).toBe("NAV");
    expect(mobile).toHaveAttribute("aria-label", "Mobile navigation");
    for (const navigation of [screen.getByRole("navigation", { name: "Main navigation" }), mobile]) {
      expect(within(navigation).getAllByRole("link", { hidden: true })).toHaveLength(3);
      for (const [label, href] of NAVIGATION) {
        expect(within(navigation).getByRole("link", { name: label, hidden: true })).toHaveAttribute("href", href);
      }
    }
    expect(mobileMenu().menu).toHaveAttribute("hidden");
    for (const link of container.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')) {
      const href = link.getAttribute("href")!;
      expect(href.length).toBeGreaterThan(1);
      expect(document.getElementById(href.slice(1)), `${href} has no destination`).not.toBeNull();
    }
  });

  it("toggles visibility, expanded state and accessible control name", () => {
    render(<HomePage />);
    const { button, menu } = mobileMenu();
    expect(button).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(button).toHaveAccessibleName("Close menu");
    expect(menu).not.toHaveAttribute("hidden");
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(button).toHaveAccessibleName("Open menu");
    expect(menu).toHaveAttribute("hidden");
  });

  it("keeps the menu closed when crossing desktop width and returning to phone width", () => {
    render(<HomePage />);
    const { button, menu } = mobileMenu();
    fireEvent.click(button);
    media.setMatches(true);
    expect(menu).toHaveAttribute("hidden");
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(button).toHaveAccessibleName("Open menu");
    media.setMatches(false);
    expect(menu).toHaveAttribute("hidden");
  });

  it("Escape closes an open menu and returns focus to its opener", () => {
    render(<HomePage />);
    const { button, menu } = mobileMenu();
    fireEvent.click(button);
    within(menu).getByRole("link", { name: "For residents" }).focus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(menu).toHaveAttribute("hidden");
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(button).toHaveAccessibleName("Open menu");
    expect(button).toHaveFocus();
  });

  it.each(["For residents", "Sign in"])("following %s closes the menu", (name) => {
    render(<HomePage />);
    const { button, menu } = mobileMenu();
    fireEvent.click(button);
    menu.addEventListener("click", (event) => event.preventDefault(), { once: true });
    fireEvent.click(within(menu).getByRole("link", { name }));
    expect(menu).toHaveAttribute("hidden");
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(button).toHaveAccessibleName("Open menu");
  });

  it("resets and rebinds one set of controls when the shared page changes audience", () => {
    // Calling these pure server page functions keeps AudienceLanding mounted
    // while changing its audience props, matching the component-reuse risk.
    const view = render(HomePage());
    const original = mobileMenu();
    fireEvent.click(original.button);
    expect(original.menu).not.toHaveAttribute("hidden");
    for (const page of [ResidentsPage, ProvidersPage, HomePage]) {
      view.rerender(page());
      const current = mobileMenu();
      expect(current.button).toBe(original.button);
      expect(current.menu).toBe(original.menu);
      expect(current.menu).toHaveAttribute("hidden");
      expect(current.button).toHaveAttribute("aria-expanded", "false");
      expect(current.button).toHaveAccessibleName("Open menu");
      fireEvent.click(current.button);
      expect(current.menu).not.toHaveAttribute("hidden");
      expect(current.button).toHaveAttribute("aria-expanded", "true");
    }
    view.unmount();
    // Detached controls must no longer retain the imperative listeners.
    fireEvent.click(original.button);
    expect(original.button).toHaveAttribute("aria-expanded", "true");
  });
});

describe("semantics and original scenes", () => {
  it.each(AUDIENCES)("gives the $name page one h1, valid heading order and named controls", ({ Page }) => {
    const { container } = render(<Page />);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    const main = screen.getByRole("main");
    expect(screen.getByRole("link", { name: "Skip to content" })).toHaveAttribute("href", `#${main.id}`);
    let previous = 0;
    for (const heading of screen.getAllByRole("heading", { hidden: true })) {
      const level = Number(heading.tagName.slice(1));
      expect(level - previous, `jumped from h${previous} to h${level}`).toBeLessThanOrEqual(1);
      previous = level;
    }
    for (const element of [...screen.getAllByRole("link", { hidden: true }), ...screen.getAllByRole("button", { hidden: true })]) expect(element).toHaveAccessibleName();
    for (const svg of container.querySelectorAll("svg")) expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(main).not.toHaveTextContent(/\bAI\b/i);
    expect(screen.getByRole("banner")).not.toHaveTextContent(/\bAI\b/i);
    expect(screen.getByRole("contentinfo")).toHaveTextContent("AI-generated scenes are illustrative and do not show actual customers.");
  });

  it("retains the approved original images, proportions and informative alternatives", () => {
    render(<HomePage />);
    const scenes = [
      ["Illustrative scene of a homeowner and a service professional outside a home.", "b62085be7b325c21453530b020a9adddf1d600f1506a6b2c1f1a7cba713815a3"],
      ["Illustrative scene of a service professional tending a home garden.", "73aa62e2cbfbddae1afddcc1bf4027ff34828e794c10c18f98d51cde7e01e876"],
    ];
    for (const [name, hash] of scenes) {
      const image = screen.getByRole("img", { name });
      const imageUrl = new URL(image.getAttribute("src")!, "http://localhost");
      const src = imageUrl.pathname === "/_next/image" ? imageUrl.searchParams.get("url")! : imageUrl.pathname;
      expect(src).toMatch(/^\/(?!\/)/);
      expect(createHash("sha256").update(readFileSync(resolve(ROOT, "public", src.slice(1)))).digest("hex")).toBe(hash);
      expect(image).toHaveAttribute("width", "1536");
      expect(image).toHaveAttribute("height", "1024");
      expect(image.closest("figure")?.querySelector("figcaption")).toBeNull();
    }
  });
});
