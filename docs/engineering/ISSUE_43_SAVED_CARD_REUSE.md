# Issue43 saved-card reuse

Isolated branch codex/issue-43-saved-card-reuse, based on ff514fb. Enrollment service, route, UI and tests only; no schema or payment-engine changes.

A resident may select an opaque reference to a card previously saved by the same payer on their current Stripe customer. Public offer data contains only reference, brand and last4. Before creating a new consent-bound off-session SetupIntent, the server retrieves the method and checks sandbox/card identity and current customer ownership. Prior consent and prior SetupIntent never authorize a new request. Atomic join continues checking new setup metadata and current request/member/provider/cap/customer under locks.

Changing selection requires a new consent UUID and checkbox acceptance. Browser confirmation supports bank verification through confirmCardSetup with the new client secret; failed joins retain the newly verified setup for safe retry. A different-card restart is disabled during confirmation/join and clears old setup and consent. New-card PaymentElement path remains available.

Stripe reference checked by manager: https://docs.stripe.com/js/setup_intents/confirm_card_setup (attached method confirmation and bank verification). Actual Stripe challenge/browser flow remains an external acceptance gate; all Stripe calls in tests are mocked.

Verification: full suite 2,851 tests passed before final restart-button addition; final focused/typecheck results in manager handoff. Independent source review approved ownership/privacy boundary; restart UX recommendation implemented afterward. No real Stripe calls, database mutations, commit or push. Exclude local node_modules/src/generated symlinks when staging.
