# Task: Provider Coverage Maps, Smooth Auth Loading, and Modular Admin Support CRM

## Objective

Implement three production workstreams:

1. Give service providers a visual, editable map circle that defines where they work. Capture it during provider onboarding and let the provider change it later from profile settings.
2. Replace blank Clerk sign-in/sign-up transitions with a branded Bundleen loading experience based on a small house animation.
3. Refactor the admin portal into a modular CRM and add a ticketing workspace, global operational email broadcasts, and admin-reviewed AI reply/diagnostic drafts.

The implementation must be secure, responsive, tested, and use the existing Bundleen data, authentication, map, notification, email, and AI foundations. Do not ship placeholder controls or fake data.

## Important product rules

- Provider coverage is separate from the fixed radius used to create non-HOA homeowner communities. Do not let providers change homeowner community rules.
- A provider may manage more than one active service area, but onboarding should create a clear primary service area.
- Provider job eligibility must be calculated server-side from active service areas. Never trust a client-supplied eligibility result.
- Ticket AI may prepare a draft and an internal explanation, but it must never send a customer response automatically.
- A global email broadcast is a high-impact admin action. It requires restricted authorization, recipient preview, confirmation, idempotent queued delivery, and an audit trail.
- Keep all existing homeowner, HOA manager, provider, and admin authorization boundaries intact.

---

## 1. Provider service-area map and radius

### Existing foundation to reuse

The project already has:

- `ProviderServiceArea` in `prisma/schema.prisma`
- Provider service-area validation in `src/lib/validation/hoa.ts`
- Provider coverage matching in `src/lib/server/hoa-market.ts`
- Provider service-area APIs under `/api/provider/hoa/service-areas`
- Leaflet/Geoapify map and geocoding code used by onboarding

Extend and consolidate these pieces. Do not build a second incompatible coverage system.

### Provider onboarding

Add a provider-only onboarding step after the provider's business details/location step and before final account completion.

The step must:

- Ask for a service-area center using address autocomplete/search.
- Center the map on the selected address and show a marker.
- Draw a visible translucent circle representing the provider's service radius.
- Let the provider move the center by dragging the marker or choosing another address.
- Let the provider adjust the radius with both an accessible slider and a numeric miles field. If a reliable map resize handle is added, keep the slider/input available for keyboard and mobile users.
- Update the circle and summary immediately while editing.
- Display a plain-language summary such as `Serving within 15 miles of North Austin, TX`.
- Clearly explain that this area controls which open service requests the provider can see.
- Require a valid center and radius before continuing.
- Preserve the draft when moving backward/forward or after an auth handoff.
- Save the first area as the provider's primary active service area only after server validation.

Use one centrally defined default, minimum, and maximum radius. The existing validation permits up to 200 miles; confirm and encode the actual product limit once rather than duplicating magic numbers in UI and API files.

### Provider profile settings

Add a production `Service areas` section to the provider profile/settings page.

It must support:

- Viewing every active service area on a map and in a compact list.
- Selecting and editing the primary area.
- Changing its center/address and radius with the same shared map editor used during onboarding.
- Adding another area up to the existing server-side maximum.
- Renaming an area with a useful label.
- Removing/deactivating an area with confirmation.
- Preventing accidental removal of the last active area without explaining that the provider will stop receiving matched opportunities.
- Saving, success, validation, conflict, and retry states.
- Showing the last saved value after refresh; optimistic UI must roll back on failure.

Do not leave service-area editing only inside the HOA opportunity page. Profile settings must be the canonical long-term management location. Other pages may link to it.

### Data and matching requirements

- Persist normalized latitude, longitude, radius in miles, label, and enough normalized address context to render the selection later. Add fields/migration only if the current model cannot represent the required saved address cleanly.
- Treat exact provider coordinates as private operational data. Do not expose them publicly or to unrelated customers.
- Use active service areas only when matching requests.
- A request is eligible if its verified location falls within at least one active provider circle and its service category/other eligibility checks also match.
- Use the existing bounding-box prefilter plus Haversine distance (or an equivalent correct geospatial query) on the server.
- Handle missing request coordinates and missing provider coverage explicitly; do not treat them as zero distance.
- Recalculate opportunity lists immediately after a successful service-area edit.
- Audit provider coverage changes without placing raw secrets or unnecessary exact coordinates in human-readable logs.
- Ensure a provider can create/update/delete only service areas owned by their own authenticated user ID.

### Reusable UI

Create a reusable component such as `ProviderServiceAreaEditor` instead of duplicating map logic between onboarding and profile settings. It should own presentation and emit validated draft values; persistence remains in the page/API layer.

Requirements:

- Leaflet/Geoapify attribution must remain visible.
- Map loading, geocoding failure, no results, invalid address, and offline states must be clear.
- Do not expose the Geoapify key from a server-only secret; use the currently intended public-key configuration and domain restrictions.
- Support keyboard operation and touch screens.
- Avoid rendering Leaflet during SSR; load it safely on the client.
- Work at approximately 375, 768, 1280, and 1536 pixel widths.

---

## 2. Branded Clerk authentication loading transition

### Problem

Clerk sometimes takes time to load or determine the current session. The Bundleen auth layout appears while the form area is blank, which looks broken during sign-in, sign-up, invitation acceptance, and redirect handoffs.

### Required experience

Create one reusable component such as `BundleenAuthLoader` and use it anywhere the application waits for Clerk or an auth redirect.

The loader should:

- Occupy the same card/form area as the incoming auth UI so the page does not jump.
- Show a small Bundleen house animation rather than a generic circular spinner.
- Use the existing house/logo visual language. Prefer an inline, accessible SVG/CSS animation over a large bitmap asset.
- Animate a simple sequence such as the house outline drawing, door/light appearing, and a subtle neighborhood pulse.
- Include concise text such as `Preparing your secure sign-in…` or context-specific sign-up/invitation copy.
- Crossfade smoothly into the Clerk form or destination after Clerk becomes ready.
- Add no artificial delay once Clerk is ready.
- Respect `prefers-reduced-motion` by showing a static house with a subtle status change.
- Use `role="status"` and polite live-region text without repeatedly announcing animation frames.
- Provide a helpful retry/offline state if Clerk cannot initialize after a reasonable timeout; never expose raw Clerk errors.

### Coverage

Audit and cover at least:

- `/sign-in/[[...sign-in]]`
- `/get-started/[[...sign-up]]`
- `/get-started/profile`
- `/admin/sign-in/[[...sign-in]]`
- `/hoa/sign-in/[[...sign-in]]`
- `/hoa/join/[invitationId]/[[...sign-up]]`
- `/hoa/invitation-sign-in/[invitationId]/[[...sign-in]]`
- `/auth/continue`
- Any route-level or component-level `isLoaded`/session handoff that can currently render an empty auth panel

Use Clerk's supported loading primitives and auth state (`ClerkLoading`/`ClerkLoaded` or the appropriate current equivalent) plus route-level `loading.tsx` where useful. Avoid hydration mismatches, duplicate forms, and redirect loops.

The final transition must correctly distinguish:

- Clerk SDK still loading
- Signed-out user who needs a form
- Existing signed-in session
- Email-verification handoff
- Role/profile completion handoff
- Invalid/expired invitation
- Network or initialization failure

---

## 3. Modular admin CRM, ticketing, global broadcasts, and ticket AI

### 3.1 Refactor the admin portal architecture

The current admin portal is visually dense and major responsibilities are coupled into large shell/workspace components. Refactor it into modular production CRM features without removing existing admin capabilities.

Organize the navigation into clear modules:

- Overview
- Customers
  - HOA accounts
  - Neighborhoods/homeowners
- Service providers
- Support
  - Ticket queue
- Communications
  - Global notifications/broadcast history
- Governance
  - Audit trail
  - Admin access

Create shared admin primitives instead of repeating one-off layouts:

- `AdminPageHeader`
- `AdminMetricCard`
- `AdminDataTable`
- `AdminFilterBar`
- `AdminStatusBadge`
- `AdminEmptyState`
- `AdminDetailLayout`
- `AdminDrawer`/`AdminDialog`
- Consistent loading, error, pagination, search, and confirmation states

Keep `AdminCrmShell` focused on shell/navigation/header responsibilities. Move customer, provider, support, and communications logic into feature-level components and server modules. Prefer server-side filtering and pagination for large tables. Keep bookmarked existing routes working or add safe redirects.

The redesigned admin UI must remain responsive and usable on laptops; tables must not force the entire page to overflow horizontally. Important actions, status, owner, last activity, and next action should be easy to scan.

### 3.2 Customer support ticketing platform

Add an authenticated support center for homeowners, HOA managers, and service providers, plus a full admin ticket workspace.

#### Customer experience

Authenticated users must be able to:

- Create a ticket with category, subject, and detailed message.
- See only tickets they created or are explicitly allowed to see for their HOA role.
- Open a ticket as a chronological conversation thread.
- Reply to an open/pending ticket.
- See status and the latest public response.
- Receive an in-app notification and email when an admin replies or materially changes status.
- Reopen a recently resolved ticket under a defined policy or create a linked follow-up.

Email notifications should link back to the authenticated ticket thread. Do not pretend email replies are ingested unless an inbound-email provider/webhook has actually been configured.

#### Admin experience

Add routes such as:

- `/app/admin/support`
- `/app/admin/support/[ticketId]`

The ticket queue must support:

- Search by ticket number, subject, requester name/email, community, or provider.
- Filters for status, priority, category, requester role, assignee, and date/age.
- Sort by newest, oldest unanswered, priority, and recent activity.
- Visible unread/unanswered and SLA-age indicators.
- Assignment to an authorized admin.
- Statuses such as `new`, `open`, `pending_customer`, `pending_internal`, `resolved`, and `closed`.
- Priorities such as `low`, `normal`, `high`, and `urgent`.
- Public replies and clearly separated internal notes.
- A full event timeline for assignment/status/priority changes.
- Safe concurrent editing behavior so one admin does not silently overwrite another admin's reply or status update.

Generate a human-friendly immutable ticket number, but use an internal ID for relations. Sanitize all message content and render plain text or a tightly controlled safe format; never render arbitrary customer HTML.

Suggested data model (adapt names to existing conventions):

- `SupportTicket`
- `SupportTicketMessage`
- `SupportTicketEvent`
- `SupportTicketAiDraft`

Add appropriate relations to `User`, optional `Community`, optional request/bid/visit references, assigned admin, timestamps, indexes, and cascade/restrict behavior. Preserve support history if an admin access grant changes.

### 3.3 AI-assisted ticket reply and explanation

Inside the admin ticket detail page, add an `AI assistance` area with two separate actions:

#### Draft reply

- `Generate reply` collects authorized server-side context and prepares a customer-facing draft.
- The generated text appears in an editable draft composer.
- It must remain unsent until an admin explicitly clicks `Approve and send`.
- Regenerating, editing, discarding, approving, and sending should have clear states.
- Never invoke send as an AI tool and never allow the model to call a mutation that replies to or closes a ticket.

#### Explain issue dropdown

Add an expandable internal-only `Explain what may be wrong` section. AI should summarize:

- The customer's complaint and desired outcome.
- Relevant account/community/provider/request/bid/schedule/notification facts.
- Likely cause(s), with uncertainty clearly stated.
- Missing information or questions needed.
- Recommended admin checks and next actions.
- Evidence links/record IDs that an authorized admin can open.
- Confidence level and a warning when available data is insufficient.

This explanation must never be visible to the customer and must not be copied into the reply automatically.

#### AI security and reliability

- Reuse the existing authenticated Bundleen AI client, model configuration, cost controls, and server tool pattern.
- Add narrow ticket-context retrieval tools. The model must not generate or execute arbitrary SQL.
- Build context from the authenticated admin's permitted scope on the server. Never accept requester/user/community identity solely from the client.
- Fetch only data relevant to the ticket and redact secrets, auth data, payment credentials, exact private coordinates, and unrelated users.
- Treat ticket text as untrusted prompt content and defend against prompt injection.
- Do not include internal AI explanations in customer-visible exports, messages, or emails.
- Store useful audit metadata for generated/approved/discarded drafts without storing hidden chain-of-thought.
- Record which admin approved the final reply and the exact text that was sent.
- Rate-limit generation per admin/ticket and prevent duplicate requests from repeated clicks.
- Show a clear unavailable state when `OPENAI_API_KEY` is not configured.

### 3.4 Global operational notifications

Add an admin `Communications` workspace for urgent platform-wide messages, such as an outage, degraded service, security notice, or required maintenance.

The compose flow must include:

- Message type/severity.
- Subject and plain-language body.
- Optional in-app notification copy and destination URL.
- Audience selection with `All active users` plus optional role segmentation for homeowner, HOA manager, and provider.
- A server-calculated recipient count and sample before send.
- `Send test to me`.
- Save draft and discard draft.
- A final review screen and explicit high-risk confirmation (for example, typing `SEND TO ALL`) before a global send.
- Broadcast status and delivery summary: queued, processing, delivered, failed/suppressed, and retryable failures.
- Searchable broadcast history and immutable audit records.

Delivery requirements:

- Use the existing notification/outbox and Resend integration.
- Create recipient records and enqueue idempotently; never send thousands of emails directly inside the request handler.
- Trigger processing promptly while retaining the scheduled outbox job as recovery.
- Deduplicate by user/email and skip invalid, deleted, or provider-suppressed addresses.
- Respect email provider suppression/bounce handling.
- General announcements must respect `notifyEmail`. Clearly classified urgent operational/security messages may be sent to every active affected account even if general notifications are disabled, but the UI must explain this before approval and the event must be audited.
- Use a stable per-broadcast/per-recipient idempotency key so retries cannot duplicate emails.
- Escape all user-entered content in email templates; no arbitrary HTML or scripts.
- Apply batch/concurrency limits compatible with the current Resend quota and expose partial failures to admins.
- Optionally create matching in-app notifications, but do not mix broadcast counters with support-ticket unread counters.

Restrict global broadcast sending to the Bundleen owner or a dedicated explicit permission such as `communications:send_global`. Ordinary admin access must not automatically grant it. Drafting/viewing may use a less privileged permission.

---

## API and authorization requirements

Create or extend REST endpoints using the project's existing conventions. A reasonable shape is:

- `/api/provider/service-areas` and `/api/provider/service-areas/[areaId]` (retain compatibility with existing HOA-prefixed endpoints or migrate callers safely)
- `/api/support/tickets`
- `/api/support/tickets/[ticketId]`
- `/api/support/tickets/[ticketId]/messages`
- `/api/admin/support/tickets`
- `/api/admin/support/tickets/[ticketId]`
- `/api/admin/support/tickets/[ticketId]/messages`
- `/api/admin/support/tickets/[ticketId]/ai-draft`
- `/api/admin/support/tickets/[ticketId]/ai-explanation`
- `/api/admin/communications/broadcasts`
- `/api/admin/communications/broadcasts/[broadcastId]`
- `/api/admin/communications/broadcasts/[broadcastId]/test`
- `/api/admin/communications/broadcasts/[broadcastId]/send`

Exact routes may differ, but keep customer APIs, provider-owned APIs, and admin APIs clearly separated.

For every mutation:

- Derive user/admin identity from Clerk on the server.
- Validate inputs with Zod and enforce length/range limits.
- Check ownership/role/permission server-side.
- Use database transactions for state change plus event/outbox creation.
- Add rate limits and idempotency where repeated requests can cause duplicate work.
- Return safe structured errors and correct HTTP status codes.
- Record high-impact admin actions in the existing audit system.

---

## Testing and verification

### Provider coverage

- Provider onboarding cannot complete the coverage step without a valid center/radius.
- Map circle reflects radius changes and marker movement.
- Draft survives onboarding navigation/auth handoff.
- Provider can view and update saved areas in profile settings.
- Provider cannot modify another provider's area.
- Removed areas do not match requests.
- Opportunity matching correctly handles inside, outside, boundary, multiple areas, missing coordinates, and maximum-radius cases.
- Mobile map interactions and keyboard controls work.

### Auth transition

- Every listed auth route shows the branded loader while Clerk is unresolved.
- No blank auth panel appears.
- Loader disappears when the Clerk form/session becomes ready.
- Existing session, email verification, invitation, and profile completion routes do not loop.
- Timeout/offline state is understandable and retryable.
- Reduced-motion mode has no continuous motion.

### Admin CRM and support

- Existing admin pages and permissions still work after modularization.
- Requesters can see only their own permitted tickets.
- Admins can filter, assign, reply, add internal notes, and change status.
- Internal notes and AI explanations never appear in customer APIs or emails.
- Ticket reply/status notifications create correct in-app and email outbox records.
- Concurrent admin changes do not silently overwrite data.
- Search, pagination, empty, loading, and error states work.

### Ticket AI

- AI receives only authorized, ticket-relevant data.
- Prompt-injection text in a ticket cannot cause unauthorized tool access or mutation.
- Generate creates a draft only; it never sends.
- Only explicit admin approval sends the edited final text.
- AI explanation remains internal and shows evidence/uncertainty.
- Missing AI configuration, provider error, timeout, and rate limit fail safely.

### Global broadcasts

- Recipient preview is calculated on the server and matches the chosen audience.
- Unauthorized admins cannot send a broadcast.
- Test send affects only the requesting admin.
- Final confirmation is required for global delivery.
- Retries do not create duplicate recipient emails.
- Preferences are honored for general announcements; urgent operational override is explicit and audited.
- Large recipient sets are batched through the outbox and partial failures remain retryable.

Run:

- Prisma validation and migration checks
- TypeScript typecheck
- Full unit/integration test suite
- Production Next.js build
- Visual tests at mobile, tablet, laptop, and large desktop widths
- Manual end-to-end tests for provider onboarding/profile editing, all Clerk auth entry points, customer ticket creation/admin response, AI draft approval, and a test-only broadcast

Do not use real global customer recipients while testing. Seed or target dedicated test accounts and use Resend test mode/test-recipient controls where available.

---

## Completion criteria

- A new provider visually selects and saves a service center/radius during onboarding.
- The provider can later manage the same coverage from profile settings, and job matching reflects the saved areas.
- Clerk latency never leaves a blank sign-in/sign-up panel; users see a smooth accessible Bundleen house transition.
- The admin portal is organized into modular CRM features with consistent reusable UI.
- Customers can create and participate in support ticket threads; admins can manage a real queue and conversation history.
- Admin AI can prepare an editable reply and internal explanation using scoped database context, but cannot send without human approval.
- Authorized staff can safely send audited, idempotent global operational emails through the existing outbox/Resend pipeline.
- Authorization, privacy, tests, typecheck, migrations, and production build all pass.

Do not commit, push, send a real broadcast, or deploy until the implementation has been reviewed.
