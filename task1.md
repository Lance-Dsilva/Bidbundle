# Task 1 — Roll out the approved Bundleen company icon

## Objective

Replace the old Bundleen house/community logos on the public homepage and every authenticated dashboard shell with the approved Bundle Check company icon: the teal lowercase `b` containing the amber roof/check.

The approved production source is:

`public/bundleen/brand/bundleen-mark-v1-bundle-check.svg`

Use this SVG as the visual source of truth. Do not use the pasted JPEG at runtime because it has a white background and loses vector sharpness. Do not use either of the alternative Community Weave or Shared Street concepts.

## Implementation requirements

### 1. Establish one canonical company-icon asset

- Promote or copy the approved SVG to a stable, non-concept filename such as `public/bundleen/brand/bundleen-company-icon.svg`.
- Preserve the exact approved geometry and colors:
  - teal: `#0F9D8A`
  - amber: `#F5A623`
  - transparent background
- Keep the source SVG accessible with its existing `<title>` and `<desc>` metadata.
- Do not add gradients, shadows, containers, outlines, or a white background to the artwork itself.
- Prefer a small reusable `BundleenCompanyIcon` component so all React surfaces share one asset path, sizing behavior, and accessibility treatment.
- When the icon sits beside visible “Bundleen” text, use decorative image semantics (`alt=""`). When it appears without visible brand text, give the link or image an accessible Bundleen label.

### 2. Replace the homepage icons

Update both company-icon placements in `src/app/page.tsx`:

- desktop/mobile header brand
- footer brand

Remove the homepage dependency on `/modern/icons/logo.svg`. Preserve the existing wordmark text, links, dimensions, spacing, and responsive behavior unless a small size adjustment is needed to avoid clipping.

### 3. Replace every dashboard-shell icon

Update every desktop sidebar/header and mobile topbar brand placement:

- `src/components/layout/HomeownerShell.tsx`
  - desktop sidebar brand
  - mobile topbar brand
- `src/components/layout/ProviderShell.tsx`
  - desktop sidebar brand
  - mobile topbar brand
- `src/components/hoa/HoaManagerShell.tsx`
  - HOA dashboard brand
- `src/components/admin/AdminCrmShell.tsx`
  - operations dashboard sidebar brand
- `src/components/layout/AppTopbar.tsx`
  - shared authenticated topbar used outside the role-specific dashboard shell

Remove these scoped surfaces’ dependencies on:

- `/creative/icons/logo-house.svg`
- `/modern/icons/logo.svg`
- the old masked `logo-mark` treatment

The admin shell currently renders `<Icon name="logo-mark">` inside a CSS mask and gradient tile. A mask can only display one color, so replace that brand mark with the actual multicolor company-icon image/component. Keep the dark-sidebar contrast, link target, “Bundleen” text, and “Operations CRM” subtitle intact. Do not recolor the approved teal or amber.

Changes to these shared shells must automatically cover all pages beneath:

- `/app/homeowner/*`
- `/app/provider/*`
- `/app/hoa/*`
- `/app/admin/*`
- role-aware `/app/support/*`

Do not edit every dashboard page individually when its shell already owns the brand.

### 4. Update global browser and installed-app icons

Keep the browser tab and installed PWA consistent with the newly approved company icon:

- update `src/app/icon.svg`
- update the SVG icon reference in `src/app/layout.tsx`
- regenerate from the approved vector:
  - `public/icons/apple-touch-icon.png`
  - `public/icons/icon-192.png`
  - `public/icons/icon-512.png`
  - `public/icons/icon-maskable-512.png`
- keep `public/manifest.webmanifest` paths and sizes valid
- give the maskable icon enough safe-area padding that the `b` is not cropped by circular, rounded-square, or squircle masks

Do not change unrelated PWA names, descriptions, routes, caching behavior, or theme settings.

### 5. Preserve layout quality

- The icon must remain crisp and proportional at approximately 25–42 px in navigation surfaces.
- Never stretch the SVG; use equal width and height with `object-fit: contain` where needed.
- Preserve the current visible `Bundleen` or `Bundleen HOA` wordmark text.
- Confirm the icon remains readable on the homepage’s light surfaces and the admin dashboard’s dark sidebar.
- Do not redesign navigation, dashboard content, typography, or colors outside the brand-icon placements.
- Do not delete old assets during this task. They may remain unreferenced until the rollout is approved.

## Verification

### Automated checks

- Run the relevant test suite, including `tests/landing-design-system.test.ts`.
- Run the production build or the project’s standard type/build validation.
- Search the scoped implementation to confirm no homepage or dashboard shell still references the old logos:

  ```sh
  rg -n "modern/icons/logo|creative/icons/logo-house|Icon name=\"logo-mark\"" src/app/page.tsx src/components/layout src/components/hoa src/components/admin/AdminCrmShell.tsx
  ```

- Verify that the manifest icon files exist at the declared dimensions and contain alpha where appropriate.

### Visual QA

Check at desktop and mobile widths:

- homepage header and footer
- homeowner dashboard
- provider dashboard
- HOA dashboard
- admin dashboard dark sidebar
- shared support shell for at least one customer role
- browser/favicon presentation and installed-app icon safe area

Confirm there is no clipping, stretching, blurry raster substitution, unwanted white square, lost amber accent, duplicate branding, or layout shift.

## Acceptance criteria

- The approved teal `b` and amber roof/check icon appears on the homepage and every dashboard shell.
- Desktop and mobile dashboard branding use the same canonical asset.
- The admin dashboard shows the full two-color icon instead of a monochrome mask.
- Browser, Apple touch, standard PWA, and maskable PWA icons match the approved company icon.
- Existing Bundleen wordmark text and navigation behavior remain unchanged.
- Old logo files are no longer referenced by the homepage or dashboard shells.
- Tests and production validation pass, and the rollout is visually verified at desktop and mobile sizes.

## Out of scope

- Replacing the Bundleen wordmark typography.
- Redesigning pages, dashboard navigation, or marketing content.
- Using either rejected logo direction.
- Deleting historical logo assets.
