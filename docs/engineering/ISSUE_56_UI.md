# Issue56 interface slice

Root owns `/private/tmp/bundleen-recurring-ui`, branch `codex/issue-56-recurring-ui`, base3a49ee1. Backend/schema/jobs remain exclusively owned by implementation in `/private/tmp/bundleen-recurring-plans`. No issue completion or release is claimed.

Implemented authenticated `/api/recurring-plans` list/proposal and `/api/recurring-plans/[planId]` view/actions. Strict request schemas reject supplied actor/customer/account/amount fields, mutation limiter precedes domain calls, and scoped plan view precedes stop/abandon. Responses use safe projection instead of raw subscription records. SetupIntent client secret is returned only to authenticated payer after domain authorization. Ten focused API tests pass, including cross-plan subscription denial, identity injection, safe error handling and projection privacy.

Pending: independent API review, backend contract stabilization, full typecheck, actual resident/manager/provider screens and dashboard discovery links, recurring consent/Stripe Elements, notice controls, histories, component/browser verification. No financial dispatch UI is represented as complete. Temporary dependency/domain/generated symlinks must not be committed.

Next root action: finish reviewed API slice and implement UI against `listRecurringPlans`/`getRecurringPlanView` capability DTO, then integrate only after backend independent gates. #43 sandbox API-policy sign-in remains a separate external verification prerequisite; #56 implementation proceeds independently. Flutter42 and SMS53 stay parked.
