# Homepage V5

The public homepage implements the approved V5 proposal with warm paper, forest and teal colors, serif headings, open photographic scenes, static service examples, an ordered four-step process, native FAQ disclosures, and a phone/tablet navigation menu.

The page stays server rendered. `LandingInteractions` only manages the menu's expanded state, link dismissal, Escape focus return, and desktop breakpoint reset. Homepage styles are scoped beneath `.landing-shell`. The sole ancestor-selector exception is the reduced-motion `html:has(.landing-shell)` rule: it disables the global smooth-scrolling behavior while the homepage is present, without affecting other routes or requiring JavaScript.

## Application entry points

- Header and hero “Get started” links lead to the local `#start` section.
- Homeowners continue to `/get-started?role=homeowner`.
- Providers continue to `/get-started?role=provider`.
- HOA managers continue to the existing interest form at `/community-onboarding`; this link grants no community authority.
- Sign in continues to `/sign-in`.

The standalone proposal's dialogs and design-preview labels are omitted. Existing help and email links remain in the compact footer. Onboarding, coverage, authorization, bidding, and provider selection logic are unchanged.

## Asset provenance

The two original 1536×1024 transparent PNGs from the approved V5 proposal are copied unchanged into `public/marketing/homepage-v5/`. They are illustrative AI-generated scenes, disclosed in the footer, and do not show actual customers. Both use `next/image` with intrinsic dimensions and responsive sizes; the hero is prioritized. Neither scene is framed, cropped, or distorted by the page.

| Asset | SHA-256 |
| --- | --- |
| `neighborhood-hero.png` | `b62085be7b325c21453530b020a9adddf1d600f1506a6b2c1f1a7cba713815a3` |
| `garden-care.png` | `73aa62e2cbfbddae1afddcc1bf4027ff34828e794c10c18f98d51cde7e01e876` |

The approved company logo comes from the shared `BundleenCompanyIcon` component.

## Preview build boundary

`vercel.json` delegates builds to `scripts/vercel-build.sh`. For Vercel `preview` or `development`, that script runs `next build` directly and does not run the migration step. Production retains the existing `npm run build` behavior, including `prisma migrate deploy` before compilation. An absent or unknown `VERCEL_ENV` fails closed. This homepage change does not authorize a production deployment or changes to live data.

Local verification should use `npm test` and `npm run typecheck`; `npm run build` must not be treated as a routine compile check because it deploys migrations.
