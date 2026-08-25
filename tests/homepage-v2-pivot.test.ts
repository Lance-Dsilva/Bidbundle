import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "..");
const PAGE = readFileSync(resolve(ROOT, "src/app/page.tsx"), "utf8");
const STYLES = readFileSync(resolve(ROOT, "src/app/landing.css"), "utf8");

describe("manager-first homepage", () => {
  it("uses the v2 hero, calls to action, and navigation", () => {
    expect(PAGE).toContain("Your whole neighborhood,");
    expect(PAGE).toContain("one better price.");
    expect(PAGE).toContain("I manage a community");
    expect(PAGE).toContain("I&apos;m a resident");
    expect(PAGE).toContain("Are you a service provider?");

    for (const label of ["How it works", "Services", "For Managers", "For Residents", "For Providers", "Log in", "Get started"]) {
      expect(PAGE).toContain(label);
    }
  });

  it("contains the new workflow, illustrative proof, and all three audience anchors", () => {
    for (const step of [
      "Manager runs a quick survey",
      "AI builds the bundle",
      "Verified providers bid",
      "Manager approves, everyone saves",
    ]) {
      expect(PAGE).toContain(step);
    }

    for (const stat of ["20–35%", "~3 weeks", "1 click", "4.0★+"]) {
      expect(PAGE).toContain(stat);
    }

    expect(PAGE).toContain('id="managers"');
    expect(PAGE).toContain('id="residents"');
    expect(PAGE).toContain('id="providers"');
    expect(PAGE).toContain("Illustrative placeholder metrics");
  });

  it("lists only the ten recurring-service categories", () => {
    for (const service of [
      "Lawn Care",
      "House Cleaning",
      "Gutter Cleaning",
      "Window Cleaning",
      "Power Washing",
      "Landscape Maintenance",
      "Pool Maintenance",
      "Snow Removal",
      "Yard Cleanup",
      "Pressure Washing",
    ]) {
      expect(PAGE).toContain(service);
    }

    expect(PAGE).not.toMatch(/post a request|neighbors join|plumbing|electrical|painting|HVAC|tree service|roofing|handyman|any service/i);
  });

  it("keeps the mobile services grid at two columns and homepage content visible before hydration", () => {
    expect(STYLES).toMatch(/\.ld-services-grid\s*\{\s*grid-template-columns:\s*repeat\(2,/);
    expect(STYLES).toMatch(/\.ld-reveal-up,\s*\n\.ld-reveal-scale\s*\{\s*opacity:\s*1;/);
  });
});
