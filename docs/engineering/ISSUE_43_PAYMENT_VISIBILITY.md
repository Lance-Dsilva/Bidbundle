# Issue 43 payment visibility handoff

Sandbox visibility slice based on `7af6d2f`, isolated in `codex/issue-43-payment-visibility`.

Resident history is scoped to the original payer, even after moving units. Provider history and SQL totals are scoped to the provider. Admin history requires a verified admin with an active matching non-staff grant; refund controls remain owner-only. Histories are bounded to 50 rows with an owned cursor. Stripe customer, card, intent and transfer identifiers are not serialized to the views.

Receipt redirects retrieve the stored charge server-side, verify sandbox mode and its immutable payment identity, and allow only HTTPS Stripe receipt URLs. Responses, including authorization failures, are private/no-store. No live Stripe calls were performed for this slice; receipt behavior is verified with mocked Stripe responses.

## Required integration before release

- Replace provider transfer totals and row amounts with `transferAmountCents ?? providerAmountCents` after the claim integration adds the actual transfer baseline. Original provider allocation is not necessarily the amount transferred after a pre-transfer refund.
- Integrate the financial-events branch's observed refund/reversal amounts and `reconciliationHoldReason`. Show adjustments awaiting review; do not present external Stripe adjustments as fully reconciled from the older schema alone.
- Retain explicit sandbox labels, distinguish transfers from bank deposits, and keep original platform fees labeled as before refund adjustments.
- This slice adds hosted receipt access, not receipt email delivery or live-payment activation.

## Verification

- Focused unit/UI/route suite: 38 passed, including ordinary staff grant denial.
- PostgreSQL read-model suite: 3 passed on the owned disposable integration database at localhost port 53952, with unique synthetic fixture inserts only and no existing-row updates or schema changes.
- Full unit suite: 2,753 passed across 165 files. Final focused rerun after staff-access restriction: 38 passed. Typecheck and git diff --check passed.
- Direct Next build blocked in unchanged Google font loader (first DNS failure; escalated retry received a font URL without the expected terminal extension). Recheck on the integrated manager checkout; no font workaround was introduced. Log: /private/tmp/bundleen-history-build.log.

Do not stage the local `node_modules` and `src/generated` symlinks. No production or shared database was accessed.
