import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

const SHELLS = [
  "src/components/layout/HomeownerShell.tsx",
  "src/components/layout/ProviderShell.tsx",
  "src/components/hoa/HoaManagerShell.tsx",
  "src/components/admin/AdminCrmShell.tsx",
];

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe("global Bundleen AI widget wiring", () => {
  it.each(SHELLS)("%s mounts exactly one <BundleenAiWidget /> and imports it", (path) => {
    const source = read(path);
    expect(source).toMatch(/import\s*\{\s*BundleenAiWidget\s*\}\s*from\s*"@\/components\/ai\/BundleenAiWidget"/);
    expect(countOccurrences(source, "<BundleenAiWidget")).toBe(1);
  });

  it.each(SHELLS)("%s renders no removed dashboard right-rail markup", (path) => {
    const source = read(path);
    expect(source).not.toMatch(/dash-right-rail/);
    expect(source).not.toMatch(/dash-rail-card/);
    expect(source).not.toMatch(/dash-quick-card/);
    expect(source).not.toMatch(/Ask Bundleen AI/i);
  });

  it("the homeowner dashboard page no longer duplicates shell chrome or a right rail", () => {
    const source = read("src/app/app/homeowner/dashboard/page.tsx");
    expect(source).not.toMatch(/dash-right-rail/);
    expect(source).not.toMatch(/dash-sidebar/);
    expect(source).not.toMatch(/dash-mobile-bottom-nav/);
    expect(source).not.toMatch(/Ask AI/i);
  });

  it("HomeownerShell wraps every homeowner route, including the dashboard", () => {
    const source = read("src/components/layout/HomeownerShell.tsx");
    expect(source).not.toMatch(/return children/);
  });

  it("HOA and admin shells no longer link to a dedicated assistant page", () => {
    expect(read("src/components/hoa/HoaManagerShell.tsx")).not.toMatch(/\/app\/hoa\/assistant/);
    expect(read("src/components/admin/AdminCrmShell.tsx")).not.toMatch(/\/app\/admin\/assistant/);
  });

  it("legacy assistant routes redirect to the role dashboard instead of rendering a second AI page", () => {
    const hoa = read("src/app/app/hoa/assistant/page.tsx");
    expect(hoa).toMatch(/redirect\(\s*"\/app\/hoa\/dashboard"\s*\)/);
    expect(hoa).not.toMatch(/BundleenAiPanel/);

    const admin = read("src/app/app/admin/assistant/page.tsx");
    expect(admin).toMatch(/redirect\(\s*"\/app\/admin\/dashboard"\s*\)/);
    expect(admin).not.toMatch(/BundleenAiPanel/);
  });
});

describe("notification bell popover replaces the old scroll-to-rail behavior", () => {
  it.each(["src/components/layout/HomeownerShell.tsx", "src/components/layout/ProviderShell.tsx"])(
    "%s uses NotificationBell and no longer scrolls to a rail element",
    (path) => {
      const source = read(path);
      expect(source).toMatch(/import\s*\{\s*NotificationBell\s*\}\s*from\s*"@\/components\/ui\/NotificationBell"/);
      expect(countOccurrences(source, "<NotificationBell")).toBeGreaterThanOrEqual(2); // mobile + desktop topbar
      expect(source).not.toMatch(/scrollToNotifications/);
      expect(source).not.toMatch(/scrollIntoView/);
    },
  );
});

describe("no conversational AI thread left in human messaging", () => {
  it("homeowner chat has no Bundleen AI thread or AI composer path", () => {
    const source = read("src/app/app/homeowner/chat/page.tsx");
    expect(source).not.toMatch(/BundleenAiPanel/);
    expect(source).not.toMatch(/type:\s*"ai"/);
    expect(source).not.toMatch(/and AI/i);
  });

  it("provider messages has no Bundleen AI thread or AI composer path", () => {
    const source = read("src/app/app/provider/messages/page.tsx");
    expect(source).not.toMatch(/BundleenAiPanel/);
    expect(source).not.toMatch(/kind:\s*"ai"/);
    expect(source).not.toMatch(/and AI/i);
  });
});
