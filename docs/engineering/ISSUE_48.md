# Issue 48: public community sharing

Stacked on PR #74 (`codex/issue-49-price-ladder`, initial integration head `5498f27`).

Partial implementation of [#48](https://github.com/Lance-Dsilva/Bidbundle/issues/48). Keep draft until the enrollment, pricing, payment and guarantee dependencies pass their actual completion gates.

## Available behind PUBLIC_REQUEST_SHARING=1

An active scoped HOA manager/team member explicitly publishes an optional request. Both community and request paths use 24 random bytes (192 bits) encoded as unguessable URL-safe tokens. The community path lists only explicitly shared optional requests in visible lifecycle states, not every community request. Closed, failed, draft, cancelled, disabled, inactive-community, and wrong-community requests are unavailable anonymously.

Manager controls create/copy links, open the public preview, rotate the request token, disable sharing and download a one-page PDF flyer with a QR code. Disabling removes the request from the community listing too. Rotation changes the request link but does not revoke access for holders of the community listing link. These are public unlisted summaries, not confidential documents.

Public responses intentionally select service category, lifecycle, joined count, minimum count, enrollment deadline, accepted price tiers/protected cap, awarded provider company name, verified nonexpired bid count and capability paths. The community listing includes the manager-published community name. No resident IDs, names, home addresses, request titles/descriptions, unit rows, private instructions or bid amounts are queried or returned. Unknown category text is replaced by a generic label, never echoed. Metadata and HTTP headers prevent indexing, following, archival caching and referrer propagation; search-engine directives are not access controls.

The flyer uses only generic service labels, counts, and the capability URL. Its canonical HTTPS origin is BUNDLEEN_APP_URL (default https://bundleen.com), never a request Host header. Configure that origin to the intended Preview host when validating Preview flyers; do not send real resident invitations during tests. It uses bundled standard PDF fonts and a locally generated QR image, with no external rendering service.

## Required before completion / public enablement

- Apply and verify `20261116020000_public_request_sharing` in the approved database. No shared database migration performed by this branch.
- #49 accepted-only price contract is integrated; keep its own enrollment/settlement gates intact and rebase after subsequent changes.
- Awarded provider company name and submitted nonexpired bids from active providers with current verified documents are included; private credentials never leave the server.
- Implement return to the same request after sign-in/sign-up, roster address matching, existing emailed homeowner invitation reuse, explicit card setup and committed enrollment (#43/#49). The current CTA preserves the request path through sign-in and resolves existing active occupied-roster members to that request’s resident-workspace anchor. Unmatched accounts get address/invitation guidance. It **does not auto-enroll** or grant membership. The three-step acceptance gate is not claimed.
- Mount the guarantee only after #50 redo/refund execution exists and is approved. No unenforceable promise is published here.
- Connect the scoped existing broadcasts workflow when enabled; no real emails are sent by this branch.
- Verify mobile/desktop pages against real authenticated Preview and check OG image rendering. Metadata has generic text and an existing PNG brand icon; bespoke social-card design remains optional polish.

## Validation

`npm test -- tests/public-request-sharing.test.ts tests/share-flyer.test.ts` verifies scope, enable/revoke/rotate, fail-closed lifecycle gates, public projection, safe flyer origin and portable PDF generation.

`SHARE_FLYER_EVIDENCE=1` writes a synthetic flyer to `/private/tmp/bundleen-share-48-flyer.pdf` for `pdftoppm` visual inspection. This is a test artifact, not a real community link.

No production deployment, shared migration or real resident message is part of this work. #55 referral attribution must wrap these public links only after its household/payment guardrails are integrated.

Validation checkpoint: 38 focused sharing/flyer/pricing checks passed after stacking; three real PostgreSQL tests passed for concurrent publication, actual rotate/revoke reads, and manager/roster authorization. TypeScript and direct Next build passed. The base-only full suite had 2472/2476 pass with the four known baseline neighborhood reconciliation failures; final stacked full suite is not claimed. The generic one-page PDF was rendered and visually inspected, and full URL extraction passed. Browser sign-up/card completion remains unverified.

## Resumed implementation checkpoint

Selected next P1 issue after #56 implementation was parked for actual Stripe/authenticated acceptance. Restored PR77 head3b0fa00 in `/private/tmp/bundleen-sharing-resume`; integrated reviewed #43 head7b8dbf9 as merge87fb9ca. Default-off environment declarations and both sharing/enrollment/quality schema models retained. Merge is local and not yet validated/pushed.

Accepted next scope: opaque server-owned expiring share flow across signup/profile; revalidate exact public link every mutation; verified-email homeowner invitation plus exact unit address provides existing residency proof. Address-only matching cannot grant occupancy because roster lacks a trusted resident-email field. Missing/ambiguous/occupied-other cases route manager review. Reuse existing explicit card consent and atomic committed enrollment, at most three product steps after signup; never silently enroll. Scoped broadcast integration and enforceable guarantee remain gates. Backend owner stripe_award_gate_resume owns context/schema/roster transaction/tests; root owns UI/API after DTO freeze; independent reviewer available. No real resident messages, shared migration, feature enablement or deployment.

### Signup/card interface checkpoint

Local root commit `7a087e2` adds same-origin start/action routes with HttpOnly opaque flow cookie, validated profile return, explicit address confirmation, reused saved/new card UI through the flow endpoint, asynchronous server consent restart, and strict committed joined response. No membership is granted by page rendering; backend invitation/roster transaction remains under active implementation and independent review. API/profile62 and UI15 focused tests pass; typecheck passed at the tested interim snapshot. Reviewed tests cover strict payload/cookie/session boundaries, safe signup return/fallback and truthful review/join rendering. Backend review found and is correcting inactive-unit acceptance, cross-community invitation concurrency, and restart-consent race. Do not push/merge or claim acceptance until those fixes and real disposable PostgreSQL tests pass. Root owns UI/API; backend owner owns schema/domain and enrollment callback.

Previous parked #56 PR79 final head326e5b2 has successful Vercel status. Its actual Stripe/authenticated acceptance remains externally blocked and it is not resolved.

## Integrated enrollment and resident message verification

The shared flow now binds an opaque two-hour server record to the verified homeowner, revalidates the exact active share, matches only an existing trusted emailed homeowner invitation plus address, serializes competing acceptance, and reuses protected capped card consent/atomic joining. Generic invitation acceptance uses the same resident authority locking. Card restart revokes and rotates the server-owned consent; final secret and join checks reject a stale consent, revoked share, or changed home. Fresh shared signup skips automatic neighborhood assignment, granting no HOA membership until invitation verification.

Resident messages have a manager-only preview snapshot and explicit confirmation; locked queue-time audience and preferences are reread before transactional outbox writes. A changed audience requires another preview. Tests sent no real messages. The exact guarantee copy is implemented behind `SERVICE_QUALITY_GUARANTEE=0` plus intake; keep off until real remedy execution and operations acceptance.

Validation: combined unit suite 2977/2977 across184 files; final14 broadcast tests include four subsequent stale-audience regression cases. Independent PostgreSQL16/16 pass on54 migrations in owned disposable issue48 database; reviewed07000 checksum35f1cf4435383e7ee173ec35407106577c7b1a6b9fd8eff53f25b4c42925eb78. Tests exercise actual domain/database acceptance, immutable setup identities and observed User-row blocking; Stripe transport is mocked. Final direct Next build/typecheck passes after retrying only a sandbox Google Fonts DNS failure. Independent backend/UI/test review approved. No shared migration/config enable, real email, or production deployment.

Remaining acceptance: real authenticated signup-to-joined browser flow within three product steps, live sandbox Stripe setup/Connect dependent gates, deployed OG/mobile rendering and real guarantee operational acceptance. Do not resolve or merge merely because this draft is pushed. Engineering owns remaining verification; account owner still needs to sign in for existing Stripe sandbox policy inspection.

### Presentation review

Inspected actual components/CSS in an isolated synthetic fixture at desktop and390px mobile width, with sans-serif fallback fonts and no authentication/payment/email. Address inputs, capped card consent, public price ladder and manager-review/broadcast-preview states fit without horizontal clipping. Updated stale public instructions to describe the actual invitation/card journey; strengthened disabled queue-button styling and spacing. This is presentation evidence only: authenticated signup, Stripe bank flow, deployed fonts/OG and actual delivery remain unverified. Stripe dashboard tab still displays sign-in; no policy change performed.
