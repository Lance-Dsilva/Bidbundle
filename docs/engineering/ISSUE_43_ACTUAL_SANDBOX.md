# Issue43 actual Stripe sandbox checkpoint

Actual test account access was verified using only the privately supplied sandbox key read in-process. Account access succeeded; balance.livemode was false; charges and payouts were enabled. No key or balance values were printed.

The exclusively owned localhost:53952/bundleen_issue43_test_live database has the52 PR73 migrations. Application domain methods accepted a visit billing offer, created a real sandbox Customer and off-session SetupIntent, confirmed Stripe's documented pm_card_visa fixture and persisted the verified card ending4242. A fresh customer PaymentIntent query returned no intents: saving the card did not charge it. These are first-run results, not authenticated browser evidence.

Connect Express account creation through the existing Accounts-v1 domain implementation returned HTTP400 StripeInvalidRequestError. Stripe reported that Accounts-v1 support must be enabled for a supported compatibility scenario, or the integration must use Accounts-v2. No account/onboarding link was created. Root owns inspection of the API-policy setting after requested browser login; no policy was changed by the tester. Do not repeatedly retry account creation while this prerequisite is unchanged.

Charges, provider transfers, partial/full refunds and reversals remain untested against real Stripe. Their harness scenarios are skipped behind active onboarding. Receipt-email delivery and authenticated browser/bank challenge acceptance are not established. The manager separately verified signed Stripe CLI delivery into the actual local webhook inbox and rejection of an invalid signature; the listener has stopped cleanly.

## Private execution prerequisites

- Explicit TEST_DATABASE_URL for the exact owned loopback database and runner_cards role; no shared environment loading.
- Private /private/tmp/bundleen-stripe-test-key containing only the sandbox key. Never commit it or paste it into chat.
- Manager-owned CLI listener before new Stripe objects are created. The local CLI path is /private/tmp/bundleen-stripe-cli/node_modules/.bin/stripe; signing secret lives separately in the private webhook-secret file.
- Tagged resource IDs and any future onboarding URL remain only in /private/tmp/bundleen-stripe-live-evidence.json (mode0600), excluded from repository output.
- Historical artifact flags explicitly skip the corresponding tests. They do not count as fresh passes and do not prove that a reset database or changed account still owns earlier resources. Resume of partial financial work needs a reviewed reconciliation of DB/account/resource identity; do not delete evidence merely to force a fresh run.
- STRIPE_CONNECT_POLICY_RECHECK=1 permits one deliberate retry only after the manager resolves the policy prerequisite.

Only local fixture Blob transport and database injection are substituted; Stripe SDK/domain calls are real sandbox operations. No production/shared database, live charge, external email delivery or security-policy change occurred. Final harness typecheck/diff results are in the manager handoff.
