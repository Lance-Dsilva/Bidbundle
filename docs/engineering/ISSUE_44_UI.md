# Issue 44 UI and export slice

Base: PR73 verified85d7e17. Root owns this isolated branch `codex/issue-44-hoa-share-ui`; backend/schema/jobs/Connect remain owned by the implementation engineer in `/private/tmp/bundleen-hoa-share`. Do not treat this slice as a completed issue.

Implemented: feature-gated manager and owner panels, monthly savings/earnings/negative carry display, owner rate and ended-month statement controls, manual payment reference, pending transfer reconciliation even when balance is reserved/held, scoped API dispatch and private downloads. No client-supplied payment amount or actor/account ID accepted. Domain services enforce exact current authority and financial gates.

CSV preserves exact cents and protects formula-like text. PDF reuses the repository board-export renderer dependencies and OFL fonts, supports Unicode and pagination, rejects unsupported text/oversize output, and checks complete ledger sums before export. All five pages of a synthetic75-line statement were rendered and inspected; the final -777-cent entry and page5 footer survive extraction. No private payer data enters the DTO.

Evidence:24 focused UI/API/export tests, full2,888 unit/component/API checks and TypeScript passed against current domain/type interfaces. Independent source review approved after correcting pending-transfer reconciliation controls. React accessibility/pending-state review done. UI testing is synthetic; no real authentication or Stripe operation is claimed. Final combined production build, font tracing for both statement routes, 2,922 tests, nine independent PostgreSQL cases, TypeScript and combined review now pass. Authenticated browser/actual sandbox Stripe verification remains pending; synthetic browser checks are described below.

Temporary domain/generated symlinks are excluded from commit. Backend owns `hoa-revenue-share-types.ts`; merge that source alongside this slice. Both panels are hidden unless server HOA_REVENUE_SHARE=1. Never enable production or run shared migrations from this checkpoint.

Synthetic browser check: actual component served locally with repository CSS and explicitly synthetic response data. Owner rate action visibly updated5% to2.35%; pending payout reconciliation remained enabled atavailable0/hold; manualpayment stayed disabled. Manager view omitted all rate/statement/payout/manual controls. This verifies client behavior only, not authenticated API/database/Stripe boundaries. Local test server stopped afterward.
