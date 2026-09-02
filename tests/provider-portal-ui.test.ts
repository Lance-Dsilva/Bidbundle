import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The three provider-portal issues, checked where they are decided: in the
 * markup and the stylesheet.
 *
 * These are the assertions a screenshot review would make, written down so the
 * next change to these files has to keep them true — a removed promo card that
 * quietly returns, or a redesigned panel that drifts back to a fixed narrow
 * column, both fail here.
 */

const ROOT = resolve(import.meta.dirname, "..");

/**
 * Source with comments removed.
 *
 * Several of these files explain in prose *why* something was taken out, and
 * that explanation must not read as the thing still being there.
 */
const read = (path: string) =>
  readFileSync(resolve(ROOT, path), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const PROVIDER_SHELL = read("src/components/layout/ProviderShell.tsx");
const HOMEOWNER_SHELL = read("src/components/layout/HomeownerShell.tsx");
const GLOBALS = read("src/app/globals.css");
const PROFILE_PAGE = read("src/app/app/provider/profile/page.tsx");
const DIALOG = read("src/components/provider/ProviderBusinessDetailsDialog.tsx");
const PANEL = read("src/components/provider/ProviderServiceAreasPanel.tsx");
const EDITOR = read("src/components/provider/ProviderServiceAreaEditor.tsx");

/* ── Issue #1 — provider account editing ─────────────────────────────────── */

describe("issue #1: one obvious, complete business editor", () => {
  it("names the action for everything it edits, not just the public profile", () => {
    expect(PROFILE_PAGE).toContain("Edit business details");
    // "Edit public profile" undersold a dialog that also edits licence,
    // insurance, trades, address, and working hours.
    expect(PROFILE_PAGE).not.toContain("Edit public profile");
  });

  it("has exactly one editor: no parallel route or second modal", () => {
    expect(PROFILE_PAGE).toContain("ProviderBusinessDetailsDialog");
    expect((PROFILE_PAGE.match(/role="dialog"/g) ?? []).length).toBe(0);
    expect((DIALOG.match(/role="dialog"/g) ?? []).length).toBe(1);
  });

  it("confirms a save on the page rather than closing silently", () => {
    expect(PROFILE_PAGE).toMatch(/role="status"/);
    expect(PROFILE_PAGE).toContain("Your business details are saved.");
  });

  it("carries no administrator-owned field in the editor's form", () => {
    // The dialog reads verification state to explain it; it must never put one
    // of these into a form value the save would carry.
    for (const field of [
      "licenseVerifiedAt:",
      "insuranceVerifiedAt:",
      "payoutStatus:",
      "accountStatus:",
      "serviceRadiusMi:",
    ]) {
      expect(DIALOG, `${field} is a form field`).not.toContain(field);
    }
  });

  it("is operable by keyboard and announced as a modal", () => {
    expect(DIALOG).toContain('aria-modal="true"');
    expect(DIALOG).toContain("aria-labelledby");
    expect(DIALOG).toContain('event.key === "Escape"');
    // Focus is moved in and put back, and Tab cycles rather than escaping
    // behind the overlay.
    expect(DIALOG).toContain("firstFieldRef.current?.focus()");
    expect(DIALOG).toContain("openerRef.current instanceof HTMLElement");
    expect(DIALOG).toContain('event.key !== "Tab"');
  });

  it("does not offer raw coordinates as editable profile fields", () => {
    // Coverage geometry belongs to the service-area map, which owns the
    // server-stored centre the matcher actually uses.
    expect(DIALOG).not.toMatch(/latitude|longitude/i);
  });

  it("keeps touch targets usable on a phone", () => {
    // 44px minimum on the controls a thumb has to hit.
    expect(DIALOG).toContain("height: 44");
    expect(DIALOG).toMatch(/className="grid grid-cols-1 gap-4 sm:grid-cols-2"/);
    expect(DIALOG).toContain('className="p-4 sm:p-6"');
  });
});

/* ── Issue #2 — sidebar promotional card ─────────────────────────────────── */

describe("issue #2: the provider growth card is gone", () => {
  it("removes the card, its class, and its copy from the provider sidebar", () => {
    for (const fragment of [
      "provider-growth-card",
      "dash-invite-card",
      "Grow your business",
      "Find nearby jobs without extra driving",
      "Review neighborhood demand",
    ]) {
      expect(PROVIDER_SHELL, `${fragment} is still rendered`).not.toContain(fragment);
    }
  });

  it("drops the now-unused provider-only style but keeps the shared one", () => {
    expect(GLOBALS).not.toContain(".provider-growth-card");
    // The homeowner sidebar still renders a `dash-invite-card`, so the shared
    // style stays.
    expect(GLOBALS).toContain(".dash-invite-card");
    expect(HOMEOWNER_SHELL).toContain("dash-invite-card");
  });

  it("re-anchors the provider account block the card used to hold down", () => {
    expect(GLOBALS).toContain(".provider-shell .dash-sidebar-profile { margin-top: auto; }");
    // Scoped, so the homeowner sidebar does not end up with two auto margins
    // splitting the gap between the card and the account block.
    expect(GLOBALS).not.toMatch(/^\.dash-sidebar-profile \{[^}]*margin-top: auto/m);
  });

  it("keeps the Job Feed route in the primary navigation", () => {
    expect(PROVIDER_SHELL).toContain('href: "/app/provider/job-feed"');
    expect(PROVIDER_SHELL).toContain('label: "Job Feed"');
  });
});

/* ── Issue #3 — service-area layout ──────────────────────────────────────── */

describe("issue #3: the service-area panel is compact and balanced", () => {
  it("no longer reserves a fixed narrow list column beside a tall editor", () => {
    expect(PANEL).not.toContain("lg:grid-cols-[280px_minmax(0,1fr)]");
    // The saved areas wrap along the top instead, so one area cannot leave a
    // tall empty gutter under it.
    expect(PANEL).toContain('className="flex flex-wrap gap-2.5"');
  });

  it("gives the map the width and puts the settings beside it", () => {
    expect(PANEL).toContain('layout="split"');
    expect(EDITOR).toContain("lg:grid-cols-[minmax(0,1fr)_320px]");
    // Taller map in the split layout than in the onboarding card.
    expect(EDITOR).toContain("h-[300px] sm:h-[380px] lg:h-[460px]");
  });

  it("groups the area name with the save and cancel actions", () => {
    expect(EDITOR).toContain("{actions ? <div>{actions}</div> : null}");
    expect(PANEL).toContain("actions={");
  });

  it("keeps one coverage implementation for onboarding and settings", () => {
    // Onboarding still drives the same component, in its stacked layout.
    const onboarding = read("src/components/onboarding/ProviderCoverageStep.tsx");
    expect(onboarding).toContain("ProviderServiceAreaEditor");
    expect(onboarding).not.toContain('layout="split"');
    expect(EDITOR).toContain('layout = "stacked"');
  });

  it("keeps the map attribution and the real Leaflet circle", () => {
    expect(EDITOR).toContain("openstreetmap.org/copyright");
    expect(EDITOR).toContain("leaflet");
    expect(EDITOR).toContain(".circle(");
    expect(EDITOR).toContain("draggable: !disabled");
  });

  it("meets the 44px touch minimum on the area actions", () => {
    // The remove/confirm controls sit inside a wrapping card on mobile.
    expect(PANEL).toContain("h-11 rounded-lg bg-red-600");
    expect(PANEL).toContain("h-11 rounded-lg border border-slate-300");
  });

  it("still resolves ownership from the session, never a client-supplied id", () => {
    expect(PANEL).toContain('credentials: "same-origin"');
    expect(PANEL).not.toMatch(/providerUserId|\buserId\b/);
  });
});
