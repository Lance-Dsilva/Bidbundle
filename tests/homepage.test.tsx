// @vitest-environment jsdom
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";

import HomePage, { metadata } from "@/app/page";
import { installMatchMediaStub } from "./stubs/match-media";

/** Approved V5 content and real application journeys, independent of CSS classes. */
const ROOT = resolve(import.meta.dirname, "..");
const HOMEOWNER_CTA = "/get-started?role=homeowner";
const PROVIDER_CTA = "/get-started?role=provider";
const MANAGER_CTA = "/community-onboarding";
const NAVIGATION = [
  ["How it works", "#how-it-works"],
  ["Services", "#services"],
  ["For HOAs", "#hoa"],
  ["For providers", "#providers"],
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

describe("V5 homepage copy and product boundaries", () => {
  it("leads with the complete approved message and pricing opportunity", () => {
    render(<HomePage />);
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading).toHaveTextContent(/^Home services, with your neighbors\.$/);
    const hero = heading.closest("section")!;
    expect(hero).toHaveTextContent("A neighborhood approach");
    expect(hero).toHaveTextContent("Bring nearby homes into one service request. Local providers bid on the grouped work, creating an opportunity for better pricing.");
    expect(hero).toHaveTextContent("Availability varies by neighborhood.");
    expect(within(hero).getByRole("link", { name: "Get started" })).toHaveAttribute("href", "#start");
    expect(within(hero).getByRole("link", { name: "See how it works" })).toHaveAttribute("href", "#how-it-works");
    expect(within(hero).getByRole("link", { name: /Explore service examples/ })).toHaveAttribute("href", "#services");
  });

  it("retains every complete section heading with readable word separation", () => {
    render(<HomePage />);
    for (const title of [
      "Start with what your home needs.",
      "More homes. One shared request.",
      "From your home to a shared plan.",
      "Bring local work together.",
      "Plan services for your community.",
      "More nearby homes. One service request.",
      "Questions, answered.",
      "Start with your neighborhood.",
    ]) {
      expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
    }
  });

  it("keeps the approved shared-request explanation and discount qualification", () => {
    render(<HomePage />);
    const story = screen.getByRole("heading", { name: "More homes. One shared request." }).closest("section")!;
    expect(story).toHaveTextContent("When nearby homes need the same service, they can join one request.");
    expect(story).toHaveTextContent("More work in one place can mean less travel for providers and simpler planning for the group. That creates an opportunity for better pricing. Discounts are not guaranteed.");
  });

  it("explains four ordered stages with eligibility and authorized-manager selection", () => {
    render(<HomePage />);
    const process = section("how-it-works");
    const list = within(process).getByRole("list");
    expect(list.tagName).toBe("OL");
    const stages = within(list).getAllByRole("listitem");
    expect(stages).toHaveLength(4);
    const expected = [
      ["Start with your address.", "Add your address during onboarding to see whether your home is in an active Bundleen neighborhood."],
      ["Open or join a request.", "Eligible non-HOA homeowners can open or join a request. Nearby homes join before enrollment closes."],
      ["Local providers bid.", "When the request opens for bidding, local providers submit bids for the grouped work."],
      ["A provider is selected.", "Your community’s authorized manager selects the provider. Participating homes then follow the service schedule and visits."],
    ];
    for (const [index, [title, body]] of expected.entries()) {
      expect(within(stages[index]!).getByRole("heading", { name: title })).toBeInTheDocument();
      expect(stages[index]).toHaveTextContent(body!);
    }
    expect(process).toHaveTextContent("Part of an HOA?");
    expect(process).toHaveTextContent("Your HOA manager opens the requests. Residents join optional work through their community.");
  });

  it("presents the three services as qualified static examples", () => {
    render(<HomePage />);
    const services = section("services");
    expect(within(services).getByRole("heading", { name: "Start with what your home needs." })).toBeInTheDocument();
    expect(services).toHaveTextContent("A few ways neighbors can bring similar needs together.");
    const rows = within(services).getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    const expected = [
      ["Lawn & garden", "Care for lawns and outdoor spaces."],
      ["Home cleaning", "Cleaning for the spaces you use every day."],
      ["Seasonal maintenance", "Home upkeep as the seasons change."],
    ];
    for (const [index, [title, description]] of expected.entries()) {
      expect(within(rows[index]!).getByRole("heading", { name: title })).toBeInTheDocument();
      expect(rows[index]).toHaveTextContent(description!);
      expect(rows[index]!.querySelector("a,button,input,select,[role='button'],[tabindex]")).toBeNull();
    }
    expect(services).toHaveTextContent("Examples only. Services vary by neighborhood and local providers.");
  });

  it("retains the distinct HOA and provider explanations", () => {
    render(<HomePage />);
    expect(section("hoa")).toHaveTextContent("Open community requests and gather resident interest in optional work. Select a provider after bidding, then follow scheduling and visits.");
    expect(section("providers")).toHaveTextContent("Bid on grouped service requests from nearby homes. Review the shared need and put your business forward for the work.");
  });

  it("keeps all four FAQ answers as native disclosures with exact qualifications", () => {
    const { container } = render(<HomePage />);
    const answers = [
      ["Do I need to be part of an HOA?", "No. Eligible homeowners who are not part of an HOA can open or join requests. HOA residents join optional work through requests opened by their HOA manager."],
      ["Is Bundleen available at my address?", "Add your address during onboarding to check neighborhood eligibility. Creating an account does not guarantee coverage or provider bids."],
      ["Who chooses the service provider?", "Your community’s authorized manager selects the provider after bidding. Participating homes then follow the service schedule."],
      ["Will I get a lower price?", "Grouped work creates an opportunity for better pricing. Actual bids depend on the work, participating homes and service availability. A lower price or discount is not guaranteed."],
    ];
    const disclosures = [...container.querySelectorAll("details")];
    expect(disclosures).toHaveLength(answers.length);
    for (const [index, [question, answer]] of answers.entries()) {
      const disclosure = disclosures[index]!;
      expect(disclosure.querySelector("summary")).toHaveTextContent(question!);
      expect(disclosure.querySelector("p")).toHaveTextContent(answer!);
      expect(disclosure).not.toHaveAttribute("open");
    }
  });

  it("keeps coverage information next to the homeowner entry", () => {
    render(<HomePage />);
    const start = section("start");
    expect(start).toHaveTextContent("Start with your neighborhood.");
    expect(start).toHaveTextContent("Bring your next home service into a shared request.");
    const homeowner = within(start).getByRole("link", { name: "I’m a homeowner" });
    expect(homeowner.parentElement).toHaveTextContent("Your address is checked during onboarding. Availability varies by neighborhood.");
  });

  it("publishes page-specific V5 metadata", () => {
    expect(metadata.title).toBe("Bundleen — Home services, with your neighbors.");
    expect(metadata.description).toBe("Bundleen brings nearby homes into one service request so local providers can bid on grouped work. See how neighborhood services come together.");
  });
});

describe("real application entry routes", () => {
  it("takes header and hero Get started to the real local start section", () => {
    render(<HomePage />);
    const header = screen.getByRole("banner");
    expect(within(header).getByRole("link", { name: "Get started" })).toHaveAttribute("href", "#start");
    section("start");
  });

  it("routes homeowner, provider, HOA and sign-in actions to their supported destinations", () => {
    render(<HomePage />);
    for (const [name, destination] of [
      ["I’m a homeowner", HOMEOWNER_CTA],
      ["I’m a service provider", PROVIDER_CTA],
      ["Get started as a provider", PROVIDER_CTA],
      ["I manage an HOA", MANAGER_CTA],
      ["Get started for my HOA", MANAGER_CTA],
    ]) {
      expect(screen.getByRole("link", { name })).toHaveAttribute("href", destination);
    }
    const signin = screen.getAllByRole("link", { name: "Sign in", hidden: true });
    expect(signin.length).toBeGreaterThanOrEqual(2);
    for (const link of signin) expect(link).toHaveAttribute("href", "/sign-in");
  });

  it("ships no design-preview dialogs, labels, fake account forms or address lookup", () => {
    const { container } = render(<HomePage />);
    expect(container.querySelector("dialog,[role='dialog'],[data-preview-path],form,input,select")).toBeNull();
    expect(document.body).not.toHaveTextContent(/Homepage design proposal|Design preview|Back to the preview|preview ends here/i);
  });
});

describe("navigation and mobile menu", () => {
  it("has all four approved navigation destinations and valid fragment targets", () => {
    const { container } = render(<HomePage />);
    const desktop = screen.getByRole("navigation", { name: /^(Main navigation|Primary)$/ });
    expect(within(desktop).getAllByRole("link")).toHaveLength(4);
    for (const [name, href] of NAVIGATION) {
      expect(within(desktop).getByRole("link", { name })).toHaveAttribute("href", href);
    }
    for (const link of container.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')) {
      const href = link.getAttribute("href")!;
      expect(href.length).toBeGreaterThan(1);
      expect(document.getElementById(href.slice(1)), `${href} has no destination`).not.toBeNull();
    }
  });

  it("mirrors the four sections and sign-in inside the hidden mobile menu", () => {
    render(<HomePage />);
    const { menu } = mobileMenu();
    expect(menu).toHaveAttribute("hidden");
    for (const [name, href] of [...NAVIGATION, ["Sign in", "/sign-in"]]) {
      expect(within(menu).getByRole("link", { name, hidden: true })).toHaveAttribute("href", href);
    }
  });

  it("toggles menu visibility, expanded state and accessible control name", () => {
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

  it("closes a menu when returning to desktop and keeps it closed on the next phone visit", () => {
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
    within(menu).getByRole("link", { name: "Services" }).focus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(menu).toHaveAttribute("hidden");
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(button).toHaveAccessibleName("Open menu");
    expect(button).toHaveFocus();
  });

  it.each(["Services", "Sign in"])("following %s closes the menu", (name) => {
    render(<HomePage />);
    const { button, menu } = mobileMenu();
    fireEvent.click(button);
    // Avoid jsdom navigation while preserving the actual bubbling click handler.
    menu.addEventListener("click", (event) => event.preventDefault(), { once: true });
    fireEvent.click(within(menu).getByRole("link", { name }));
    expect(menu).toHaveAttribute("hidden");
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(button).toHaveAccessibleName("Open menu");
  });
});

describe("semantics, original scenes and honest claims", () => {
  it("has one h1, a named main destination, and no skipped heading levels", () => {
    render(<HomePage />);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    const main = screen.getByRole("main");
    expect(screen.getByRole("link", { name: "Skip to content" })).toHaveAttribute("href", `#${main.id}`);
    let previous = 0;
    for (const heading of screen.getAllByRole("heading", { hidden: true })) {
      const level = Number(heading.tagName.slice(1));
      expect(level - previous, `jumped from h${previous} to h${level}`).toBeLessThanOrEqual(1);
      previous = level;
    }
  });

  it("names all links/buttons and excludes decorative SVGs from accessibility", () => {
    const { container } = render(<HomePage />);
    for (const element of [...screen.getAllByRole("link", { hidden: true }), ...screen.getAllByRole("button", { hidden: true })]) {
      expect(element).toHaveAccessibleName();
    }
    for (const svg of container.querySelectorAll("svg")) expect(svg).toHaveAttribute("aria-hidden", "true");
  });

  it("uses the exact approved original images, informative alternatives and disclosure", () => {
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
      const bytes = readFileSync(resolve(ROOT, "public", src.slice(1)));
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(hash);
      expect(image).toHaveAttribute("width", "1536");
      expect(image).toHaveAttribute("height", "1024");
      expect(image.closest("figure")?.querySelector("figcaption")).toBeNull();
    }
    expect(screen.getByRole("contentinfo")).toHaveTextContent("AI-generated scenes are illustrative and do not show actual customers.");
  });

  it("renders the full page without client effects or reveal observers", () => {
    const html = renderToStaticMarkup(<HomePage />);
    const server = document.createElement("div");
    server.innerHTML = html;
    for (const id of ["how-it-works", "services", "hoa", "providers", "start"]) {
      const target = server.querySelector(`#${id}`)!;
      expect(target).not.toBeNull();
      expect(target.closest('[hidden],[aria-hidden="true"]')).toBeNull();
      expect(target.textContent!.length).toBeGreaterThan(40);
    }
    expect(server.querySelector('main[hidden],section[hidden],article[hidden],[data-reveal]')).toBeNull();
  });

  it("makes no unsupported price, timing, review, qualification or revenue claims", () => {
    render(<HomePage />);
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/\d+\s?%|\$\d|\d(?:\.\d)?\s?[★⭐]/);
    for (const phrase of ["guaranteed volume", "zero marketing", "48-hour opt-out", "without lifting a finger", "do almost nothing", "pre-qualified", "auto-enrolled", "background-checked", "vetted providers", "guaranteed savings", "book now", "join for free"]) {
      expect(text.toLowerCase()).not.toContain(phrase);
    }
  });

  it("keeps AI out of the product pitch while retaining the required scene disclosure", () => {
    render(<HomePage />);
    expect(screen.getByRole("main")).not.toHaveTextContent(/\bAI\b/i);
    expect(screen.getByRole("banner")).not.toHaveTextContent(/\bAI\b/i);
    expect(screen.getByRole("contentinfo")).toHaveTextContent(/AI-generated scenes are illustrative/);
  });
});
