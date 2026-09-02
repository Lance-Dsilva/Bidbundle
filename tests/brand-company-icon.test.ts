import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import sharp from "sharp";
import { describe, expect, it } from "vitest";

import {
  BUNDLEEN_COMPANY_ICON,
  BundleenCompanyIcon,
} from "@/components/brand/BundleenCompanyIcon";

/**
 * The company-icon rollout.
 *
 * Before this, five shells inlined their own `<img>` against two different
 * legacy logos, the admin sidebar rendered a CSS mask that could only ever
 * paint one colour, and the browser/PWA icons were a different mark again.
 * These tests hold the single source of truth in place: one file, one
 * component, one set of raster icons generated from that same vector.
 */

const ROOT = resolve(import.meta.dirname, "..");
const read = (path: string) => readFileSync(resolve(ROOT, path), "utf8");

const APPROVED = "public/bundleen/brand/bundleen-mark-v1-bundle-check.svg";
const CANONICAL = "public/bundleen/brand/bundleen-company-icon.svg";

/**
 * Every surface that renders the company icon.
 *
 * `AuthShowcase` is one component behind nine routes — sign-in, get-started,
 * the profile step, and the admin/HOA invitation and sign-in pages — so the
 * brand mark on all of them moves together.
 */
const BRAND_SURFACES = [
  "src/app/page.tsx",
  "src/components/layout/HomeownerShell.tsx",
  "src/components/layout/ProviderShell.tsx",
  "src/components/layout/AppTopbar.tsx",
  "src/components/hoa/HoaManagerShell.tsx",
  "src/components/admin/AdminCrmShell.tsx",
  "src/components/auth/AuthShowcase.tsx",
] as const;

describe("the canonical asset", () => {
  it("exists under a stable, non-concept filename", () => {
    expect(existsSync(resolve(ROOT, CANONICAL))).toBe(true);
    expect(BUNDLEEN_COMPANY_ICON).toBe("/bundleen/brand/bundleen-company-icon.svg");
  });

  it("is the approved artwork byte for byte", () => {
    // Promoted, not redrawn: geometry and colours cannot drift from the file
    // that was signed off.
    expect(read(CANONICAL)).toBe(read(APPROVED));
  });

  it("keeps the approved colours, transparency, and metadata", () => {
    const svg = read(CANONICAL);
    expect(svg).toContain("#0F9D8A");
    expect(svg).toContain("#F5A623");
    expect(svg).toContain("<title");
    expect(svg).toContain("<desc");
    // Nothing added to the artwork itself.
    expect(svg).not.toMatch(/<rect[^>]*fill="#(fff|FFF)/);
    expect(svg).not.toContain("Gradient");
    expect(svg).not.toContain("filter");
  });

  it("keeps the rejected concepts out of the shipped surfaces", () => {
    for (const surface of BRAND_SURFACES) {
      const source = read(surface);
      expect(source).not.toContain("community-weave");
      expect(source).not.toContain("shared-street");
      // The raster twin has a white background and no vector sharpness.
      expect(source).not.toMatch(/bundleen-[a-z0-9-]*\.(png|jpe?g)/);
    }
  });
});

describe("the shared component", () => {
  it("points every surface at the one asset path", () => {
    const markup = renderToStaticMarkup(BundleenCompanyIcon({ size: 36 }));
    expect(markup).toContain(`src="${BUNDLEEN_COMPANY_ICON}"`);
  });

  it("is decorative beside the wordmark and labelled without it", () => {
    // Beside visible "Bundleen" text a labelled icon makes a screen reader say
    // the brand twice.
    expect(renderToStaticMarkup(BundleenCompanyIcon({}))).toContain('alt=""');
    expect(renderToStaticMarkup(BundleenCompanyIcon({ label: "Bundleen" }))).toContain(
      'alt="Bundleen"',
    );
  });

  it("sizes with attributes so stylesheet breakpoints still win", () => {
    const markup = renderToStaticMarkup(BundleenCompanyIcon({ size: 36 }));
    expect(markup).toContain('width="36"');
    expect(markup).toContain('height="36"');
    // An inline width would beat `.dash-mobile-topbar-brand img { width: 30px }`
    // and freeze the mark at its desktop size on a phone.
    expect(markup).not.toMatch(/style="[^"]*width/);
  });

  it("never stretches: equal dimensions and a contain rule", () => {
    const markup = renderToStaticMarkup(BundleenCompanyIcon({ size: 38 }));
    expect(markup).toContain('width="38"');
    expect(markup).toContain('height="38"');
    expect(markup).toContain("bundleen-company-icon");
    expect(read("src/app/globals.css")).toContain(
      ".bundleen-company-icon { object-fit: contain; }",
    );
  });
});

describe("every branded surface uses it", () => {
  it.each(BRAND_SURFACES)("%s renders the component", (surface) => {
    const source = read(surface);
    expect(source).toContain('from "@/components/brand/BundleenCompanyIcon"');
    expect(source).toContain("<BundleenCompanyIcon");
  });

  it.each(BRAND_SURFACES)("%s references no retired logo", (surface) => {
    const source = read(surface)
      // Comments explain what was removed; that is not a reference.
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
      .replace(/^\s*\/\/.*$/gm, "");

    for (const retired of [
      "modern/icons/logo",
      "creative/icons/logo-house",
      'Icon name="logo-mark"',
    ]) {
      expect(source, `${surface} still uses ${retired}`).not.toContain(retired);
    }
  });

  it("keeps both the desktop and the mobile placement in the two dashboard shells", () => {
    for (const shell of [
      "src/components/layout/HomeownerShell.tsx",
      "src/components/layout/ProviderShell.tsx",
    ]) {
      const source = read(shell);
      expect((source.match(/<BundleenCompanyIcon/g) ?? []).length).toBe(2);
      // Sidebar at 36, mobile topbar at 30 — the sizes the stylesheet uses.
      expect(source).toContain("<BundleenCompanyIcon size={36} />");
      expect(source).toContain("<BundleenCompanyIcon size={30} />");
    }
  });

  it("keeps the wordmark text on every surface it had", () => {
    for (const shell of [
      "src/components/layout/HomeownerShell.tsx",
      "src/components/layout/ProviderShell.tsx",
      "src/components/layout/AppTopbar.tsx",
      "src/components/admin/AdminCrmShell.tsx",
    ]) {
      expect(read(shell)).toContain(">Bundleen<");
    }
    expect(read("src/components/hoa/HoaManagerShell.tsx")).toContain(">Bundleen HOA<");
    expect(read("src/components/admin/AdminCrmShell.tsx")).toContain("Operations CRM");
  });

  it("shows the admin mark in full colour instead of a one-colour mask", () => {
    const source = read("src/components/admin/AdminCrmShell.tsx");
    expect(source).toContain("<BundleenCompanyIcon");
    // A mask paints a single colour, so the amber roof could never appear.
    expect(source).not.toMatch(/mask-image|bg-gradient-to-br from-emerald-400 to-teal-600/);
    // Still the same link target and footprint as the tile it replaced.
    expect(source).toContain('href="/app/admin/dashboard"');
    expect(source).toContain("h-10 w-10");
  });

  it("keeps the icon within the 25–42px navigation range everywhere", () => {
    for (const surface of BRAND_SURFACES) {
      for (const match of read(surface).matchAll(/<BundleenCompanyIcon size=\{(\d+)\}/g)) {
        const size = Number(match[1]);
        expect(size, `${surface} renders the mark at ${size}px`).toBeGreaterThanOrEqual(25);
        expect(size).toBeLessThanOrEqual(42);
      }
    }
  });
});

describe("no surface anywhere still reaches for a retired logo", () => {
  /** Every `.tsx` under `src`, so a new caller cannot slip past the list. */
  function componentFiles(directory = resolve(ROOT, "src"), found: string[] = []): string[] {
    for (const entry of readdirSync(directory)) {
      const full = resolve(directory, entry);
      if (statSync(full).isDirectory()) {
        if (entry !== "generated") componentFiles(full, found);
      } else if (entry.endsWith(".tsx")) {
        found.push(full.slice(ROOT.length + 1));
      }
    }
    return found;
  }

  it("finds no component rendering the old house or wordmark logo", () => {
    const offenders = componentFiles().filter((file) => {
      const source = read(file)
        .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      return (
        source.includes("modern/icons/logo.svg") ||
        source.includes("creative/icons/logo-house") ||
        source.includes('Icon name="logo-mark"')
      );
    });
    expect(offenders, `still on a retired logo: ${offenders.join(", ")}`).toEqual([]);
  });

  it("leaves the retired files on disk for history", () => {
    // Removing the references is the rollout; deleting the assets is not.
    for (const asset of [
      "public/creative/icons/logo-house.svg",
      "public/modern/icons/logo.svg",
      "public/bundleen/brand/bundleen-logo-v2-community-weave.svg",
      "public/bundleen/brand/bundleen-logo-v3-shared-street.svg",
    ]) {
      expect(existsSync(resolve(ROOT, asset)), `${asset} was deleted`).toBe(true);
    }
  });
});

describe("browser and installed-app icons", () => {
  it("serves the approved artwork as the favicon", () => {
    expect(read("src/app/icon.svg")).toBe(read(CANONICAL));
    expect(read("src/app/layout.tsx")).toContain(BUNDLEEN_COMPANY_ICON);
    expect(read("src/app/layout.tsx")).not.toContain("creative/icons/logo-house");
  });

  it("keeps the manifest pointing at files that exist at their declared sizes", async () => {
    const manifest = JSON.parse(read("public/manifest.webmanifest")) as {
      icons: Array<{ src: string; sizes: string; purpose: string }>;
    };
    expect(manifest.icons.length).toBeGreaterThan(0);

    for (const icon of manifest.icons) {
      const file = resolve(ROOT, "public", icon.src.replace(/^\//, ""));
      expect(existsSync(file), `${icon.src} is missing`).toBe(true);

      const [width, height] = icon.sizes.split("x").map(Number);
      const meta = await sharp(file).metadata();
      expect(meta.width, `${icon.src} width`).toBe(width);
      expect(meta.height, `${icon.src} height`).toBe(height);
    }
  });

  it("keeps alpha on the any-purpose icons and none on the ones that get composited", async () => {
    for (const [file, expectTransparent] of [
      ["public/icons/icon-192.png", true],
      ["public/icons/icon-512.png", true],
      // iOS composites a touch icon onto black; a maskable icon gets cropped.
      // Both need to carry their own opaque plate.
      ["public/icons/apple-touch-icon.png", false],
      ["public/icons/icon-maskable-512.png", false],
    ] as const) {
      const stats = await sharp(resolve(ROOT, file)).stats();
      const alpha = stats.channels[3];
      expect(alpha, `${file} has no alpha channel`).toBeDefined();
      expect(alpha!.min === 0, `${file} transparency`).toBe(expectTransparent);
    }
  });

  it("renders both brand colours into every raster icon", async () => {
    // The old mask lost the amber entirely; a silently mis-rendered SVG would
    // do the same, so each file is checked for both.
    for (const file of [
      "public/icons/icon-192.png",
      "public/icons/icon-512.png",
      "public/icons/apple-touch-icon.png",
      "public/icons/icon-maskable-512.png",
    ]) {
      const { data, info } = await sharp(resolve(ROOT, file))
        .raw()
        .toBuffer({ resolveWithObject: true });

      let teal = 0;
      let amber = 0;
      for (let index = 0; index < data.length; index += info.channels) {
        const [r, g, b, a] = [data[index]!, data[index + 1]!, data[index + 2]!, data[index + 3]!];
        if (a > 200 && g > 120 && g > r + 40 && b > r + 20) teal += 1;
        if (a > 200 && r > 200 && g > 130 && g < 200 && b < 90) amber += 1;
      }

      expect(teal, `${file} has no teal`).toBeGreaterThan(0);
      expect(amber, `${file} has no amber`).toBeGreaterThan(0);
    }
  });

  it("keeps the maskable mark inside the guaranteed safe area", async () => {
    // Platforms may crop a maskable icon to a circle, a squircle, or a rounded
    // square, and only the inner 80% is safe. Measuring the drawn artwork is
    // what proves the `b` survives every one of those masks.
    const file = resolve(ROOT, "public/icons/icon-maskable-512.png");
    const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });

    let minX = info.width;
    let maxX = 0;
    let minY = info.height;
    let maxY = 0;
    for (let y = 0; y < info.height; y += 1) {
      for (let x = 0; x < info.width; x += 1) {
        const index = (y * info.width + x) * info.channels;
        // Anything that is not the white plate is artwork.
        const isPlate = data[index]! > 245 && data[index + 1]! > 245 && data[index + 2]! > 245;
        if (isPlate) continue;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }

    const centre = info.width / 2;
    const safeRadius = info.width * 0.4;
    const corners = [
      [minX, minY],
      [maxX, minY],
      [minX, maxY],
      [maxX, maxY],
    ] as const;

    for (const [x, y] of corners) {
      const distance = Math.hypot(x - centre, y - centre);
      expect(distance, `artwork reaches ${Math.round(distance)}px from centre`).toBeLessThanOrEqual(
        safeRadius,
      );
    }
  });
});
