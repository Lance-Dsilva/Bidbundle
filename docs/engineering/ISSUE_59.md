# Issue 59 — vendor sourcing and proposal invitations

Implements the vendor sourcing backlog in [issue #59](https://github.com/Lance-Dsilva/Bidbundle/issues/59). Development is isolated on `codex/issue-59-vendor-sourcing`. The Flutter program remains parked.

## Intended workflow

1. A manager or resident recommends a business on a collecting-interest or open-bidding request. The referral is private to authorized staff and does not approve documents or send email.
2. An administrator imports a bounded CSLB CSV or maintains business contacts in the community's vendor-sourcing panel. Preview the import before applying it. CSLB data does not include email addresses; an administrator must confirm contacts and geographic coordinates separately.
3. Opening bidding notifies eligible registered providers. Administrators can review registered providers and licensed leads and queue a bounded invitation batch. Registered-provider invitations remain available when cold-lead outreach is disabled.
4. An expiring, signed invitation exposes only coarse area, service terms and participant counts. It does not expose resident identities, home addresses or access notes. The invited business signs up or signs in, confirms its verified email, and submits a normal proposal.
5. Pending verification is allowed only through the invitation-specific proposal path. Winning work still requires the normal current-document and community eligibility checks. Importing a license or claiming an invitation never verifies a provider.

The public invitation and unsubscribe pages are noindex and use no-referrer policies. Public API responses are private/no-store. Unsubscribe is an explicit POST, including the mail-client one-click POST; merely viewing the page does not unsubscribe a contact.

## Operational configuration

Keep cold outreach disabled until sender setup and release checks are complete. No real vendor mail or automated SMS is authorized by local verification.

Configure secrets in the deployment environment, never in Git:

- `RESEND_API_KEY`: sending service credential.
- `RESEND_WEBHOOK_SECRET`: signature verification secret for `/api/webhooks/resend/vendor-invites`.
- `VENDOR_INVITE_TOKEN_SECRET`: dedicated high-entropy signing secret, at least 32 characters. Rotation invalidates existing invitation and unsubscribe signatures; plan rotation before enabling real outreach.

Operational settings include `APP_URL` (HTTPS application origin), `VENDOR_OUTREACH_FROM_ADDRESS` (dedicated sending subdomain), `VENDOR_OUTREACH_SENDING_DOMAIN` (optional explicit exact sender domain), `VENDOR_OUTREACH_POSTAL_ADDRESS` (owner-approved physical mailing address), `VENDOR_OUTREACH_ENABLED=true`, and `VENDOR_OUTREACH_DOMAIN_READY=true`. Set the latter flags only after the sender owner confirms sending approval, SPF/DKIM/DMARC and delivery tracking. `VENDOR_OUTREACH_DAILY_LIMIT` defaults to 25 and is capped at 200; `VENDOR_OUTREACH_REQUEST_LIMIT` defaults to 25 and is capped at 100. Use a conservative warm-up schedule.

Outreach uses the existing authenticated outbox worker. The initial invitation and at most two reminders are scheduled per lead/request; current eligibility, deadline, engagement and suppression are rechecked before dispatch. A configured cron is not proof of successful delivery. Inspect the outbox and delivery evidence after activation. Do not manually drain a shared outbox as a test.

## Development and release gates

`npm run build` runs database migrations in this repository. Use direct `next build` for compilation-only checks. The issue branch disables its Vercel Git deployment in `vercel.json` to prevent accidental application of a migration to the currently shared Preview database.

The new migration must be reviewed and exercised only against a disposable local PostgreSQL database before any shared-database action. Do not apply the scaffold to production. Existing migrations must remain unchanged. Later release requires a reviewed migration plan, authorized deployment, configured sender prerequisites and bounded synthetic end-to-end verification. Store no credentials or real business contacts in evidence.

Local evidence/checkpoints are under `/private/tmp/bundleen-issue-59-evidence`; test scripts and this document preserve the reproducible contracts in the repository. Local verification passed: 2,598 unit checks, standalone TypeScript and direct Next build; independent source review and 32 real PostgreSQL tests on a fresh owned database. The 34 prior migrations remained unchanged. Database tests use synthetic identities and mocked email transport; they do not prove live Resend delivery or Clerk signup. Additional targeted checks cover late webhook reconciliation and safe retry handling.

Browser verification used actual proposal/admin/unsubscribe components with synthetic Clerk/API responses. At 320/390/1280px, no horizontal overflow was found. A pool proposal calculated exact cents and reached the success state; registered invitations worked while cold-lead outreach was disabled; explicit unsubscribe reached its confirmation. This is not evidence of live authentication or server-side delivery.

Run `npm test`, `npm run typecheck`, and `npx next build` for normal verification. Database verification uses `npx vitest run --config tests/postgres/vendor-sourcing.config.mts` with `TEST_DATABASE_URL` restricted by the suite to an owned loopback database. Apply all migrations to that empty disposable database first; never redirect this suite at shared Preview or production data.

The feature is ready for draft review, with deployment and real outreach parked on the external prerequisites above. It is not yet a resolved issue. New live test keys, sending domain approval or secret values must never be placed in PR comments.
