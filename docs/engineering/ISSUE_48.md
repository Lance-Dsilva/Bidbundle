# Issue 48: public community sharing

Partial implementation of [#48](https://github.com/Lance-Dsilva/Bidbundle/issues/48). Keep draft until the enrollment, pricing, payment and guarantee dependencies pass their actual completion gates.

## Available behind PUBLIC_REQUEST_SHARING=1

An active scoped HOA manager/team member explicitly publishes an optional request. Both community and request paths use 24 random bytes (192 bits) encoded as unguessable URL-safe tokens. The community path lists only explicitly shared optional requests in visible lifecycle states, not every community request. Closed, failed, draft, cancelled, disabled, inactive-community, and wrong-community requests are unavailable anonymously.

Manager controls create/copy links, open the public preview, rotate the request token, disable sharing and download a one-page PDF flyer with a QR code. Disabling removes the request from the community listing too. Rotation changes the request link but does not revoke access for holders of the community listing link. These are public unlisted summaries, not confidential documents.

Public responses intentionally select only service category, lifecycle, joined count, minimum count, enrollment deadline and capability paths. The community listing includes the manager-published community name. No resident IDs, names, home addresses, request titles/descriptions, unit rows, private instructions or bid amounts are queried or returned. Unknown category text is replaced by a generic label, never echoed. Metadata and HTTP headers prevent indexing, following, archival caching and referrer propagation; search-engine directives are not access controls.

The flyer uses only generic service labels, counts, and the capability URL. Its canonical HTTPS origin is BUNDLEEN_APP_URL (default https://bundleen.com), never a request Host header. Configure that origin to the intended Preview host when validating Preview flyers; do not send real resident invitations during tests. It uses bundled standard PDF fonts and a locally generated QR image, with no external rendering service.

## Required before completion / public enablement

- Apply and verify `20261116020000_public_request_sharing` in the approved database. No shared database migration performed by this branch.
- Integrate #49 committed maximum and monotone price ladder. Current page deliberately does not imply a committed price or display an unverified provider count.
- Integrate verified awarded provider display and exact eligible-provider bidding count.
- Implement return to the same request after sign-in/sign-up, roster address matching, existing emailed homeowner invitation reuse, explicit card setup and committed enrollment (#43/#49). The current CTA only opens the resident workspace and **does not auto-enroll**. The three-step acceptance gate is not claimed.
- Mount the guarantee only after #50 redo/refund execution exists and is approved. No unenforceable promise is published here.
- Connect the scoped existing broadcasts workflow when enabled; no real emails are sent by this branch.
- Verify mobile/desktop pages against real authenticated Preview and check OG image rendering. Metadata has generic text and an existing PNG brand icon; bespoke social-card design remains optional polish.

## Validation

`npm test -- tests/public-request-sharing.test.ts tests/share-flyer.test.ts` verifies scope, enable/revoke/rotate, fail-closed lifecycle gates, public projection, safe flyer origin and portable PDF generation.

`SHARE_FLYER_EVIDENCE=1` writes a synthetic flyer to `/private/tmp/bundleen-share-48-flyer.pdf` for `pdftoppm` visual inspection. This is a test artifact, not a real community link.

No production deployment, shared migration or real resident message is part of this work. #55 referral attribution must wrap these public links only after its household/payment guardrails are integrated.
