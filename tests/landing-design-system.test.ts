import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import postcss, { type Rule } from "postcss";
import { describe, expect, it } from "vitest";

/** Source guards for progressive enhancement; actual viewport layout is UI review. */
const ROOT = resolve(import.meta.dirname, "..");
const CSS = postcss.parse(readFileSync(resolve(ROOT, "src/app/landing.css"), "utf8"));
const rules: Rule[] = [];
CSS.walkRules((rule) => { rules.push(rule); });

function declarations(rule: Rule, property: string) {
  const values: string[] = [];
  rule.walkDecls(property, (declaration) => { values.push(declaration.value); });
  return values;
}

describe("homepage stylesheet boundaries", () => {
  it("scopes every selector to the homepage so signup and application screens retain their styles", () => {
    expect(rules.length).toBeGreaterThan(0);
    for (const rule of rules) {
      for (const selector of rule.selectors) {
        if (selector.trim() === "html:has(.landing-shell)") {
          // The ancestor exists only when the homepage is mounted; this is
          // the approved exception to undo global smooth scrolling for users
          // requesting less motion. It may change scrolling and nothing else.
          expect(rule.parent?.type).toBe("atrule");
          expect((rule.parent as postcss.AtRule).params).toMatch(/prefers-reduced-motion\s*:\s*reduce/);
          expect(rule.nodes.map((node) => node.type === "decl" ? node.prop : node.type)).toEqual(["scroll-behavior"]);
          expect(declarations(rule, "scroll-behavior")).toEqual(["auto"]);
          continue;
        }
        expect(selector.trim(), `Unscoped landing rule: ${selector}`).toMatch(/^\.landing-shell(?:\b|\s|:)/);
      }
    }
  });

  it("preserves the hidden attribute on the mobile menu at every media size", () => {
    const hiddenRules = rules.filter((rule) => rule.selectors.some((selector) => selector.includes("[hidden]")));
    expect(hiddenRules.length).toBeGreaterThan(0);
    expect(hiddenRules.some((rule) => declarations(rule, "display").includes("none"))).toBe(true);
    for (const rule of hiddenRules) {
      expect(declarations(rule, "display").every((display) => display === "none")).toBe(true);
    }
  });

  it("does not conceal meaningful page content behind a reveal animation", () => {
    for (const rule of rules) {
      // Hiding a closed menu or SVG definitions is deliberate; hiding a page
      // section until JavaScript observes it violates progressive rendering.
      if (rule.selector.includes("mobile-menu") || rule.selector.includes("icon-definitions")) continue;
      expect(declarations(rule, "opacity"), rule.selector).not.toContain("0");
      expect(declarations(rule, "visibility"), rule.selector).not.toContain("hidden");
      if (/reveal|is-visible|data-animate/.test(rule.selector)) {
        expect(declarations(rule, "display"), rule.selector).not.toContain("none");
        expect(declarations(rule, "transform").every((value) => value === "none"), rule.selector).toBe(true);
      }
    }
  });

  it("keeps section targets clear when following in-page navigation", () => {
    expect(rules.some((rule) => rule.selectors.includes(".landing-shell [id]") && declarations(rule, "scroll-margin-top").some((value) => parseFloat(value) > 0))).toBe(true);
  });
});

describe("accessibility foundations", () => {
  it("provides an explicit visible focus outline for links, buttons and FAQ summaries", () => {
    for (const tag of ["a", "button", "summary"]) {
      const outlines = rules.filter((rule) => rule.selectors.some((selector) => selector.endsWith(`${tag}:focus-visible`))).flatMap((rule) => declarations(rule, "outline"));
      expect(outlines.some((outline) => /(?:[2-9]|\d{2,})px\s+solid\s+(?!transparent)/.test(outline)), `${tag} has no visible focus outline`).toBe(true);
    }
  });

  it("suppresses animations and transitions under reduced motion", () => {
    const reducedRules: Rule[] = [];
    CSS.walkAtRules("media", (media) => {
      if (/prefers-reduced-motion\s*:\s*reduce/.test(media.params)) media.walkRules((rule) => { reducedRules.push(rule); });
    });
    expect(reducedRules.length).toBeGreaterThan(0);
    const universal = reducedRules.filter((rule) => rule.selectors.some((selector) => /^\.landing-shell\s+\*$/.test(selector.trim())));
    expect(universal.some((rule) => declarations(rule, "animation").includes("none"))).toBe(true);
    expect(universal.some((rule) => declarations(rule, "transition").includes("none"))).toBe(true);
    // globals.css enables smooth scrolling on html; cancelling animation only
    // on descendants cannot disable that root-level motion.
    expect(reducedRules.some((rule) => rule.selectors.includes("html:has(.landing-shell)") && declarations(rule, "scroll-behavior").includes("auto"))).toBe(true);
  });

  it("keeps the original photographic proportions and adds no image frame or crop", () => {
    for (const scene of ["hero-scene", "garden-scene"]) {
      const imageRules = rules.filter((rule) => rule.selectors.includes(`.landing-shell .${scene} img`));
      expect(imageRules.some((rule) => declarations(rule, "height").includes("auto"))).toBe(true);
      for (const rule of rules.filter((rule) => rule.selector.includes(`.${scene}`))) {
        expect(declarations(rule, "object-fit")).not.toContain("cover");
        expect(declarations(rule, "box-shadow").every((value) => value === "none"), rule.selector).toBe(true);
        expect(declarations(rule, "border-radius").every((value) => /^(0|none)$/.test(value)), rule.selector).toBe(true);
        expect(declarations(rule, "border").every((value) => /^(0|none)$/.test(value)), rule.selector).toBe(true);
      }
    }
  });
});
