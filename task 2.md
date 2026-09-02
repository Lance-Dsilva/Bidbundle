# Task: Replace Dashboard Rails and Chat AI Threads with a Global AI Widget

## Objective

Move the conversational Bundleen AI experience into one production-quality floating widget that is available throughout the authenticated application. Remove the large dashboard right-side rails shown in the reference image and remove Bundleen AI as a fake contact/thread inside homeowner and provider messaging.

There must be one consistent AI entry point: a small fixed button at the bottom-right of every authenticated product page. Clicking it opens a floating chat panel powered by the existing authenticated Bundleen AI API.

## Scope

Apply this to every authenticated surface under:

- `/app/homeowner/*`
- `/app/provider/*`
- `/app/hoa/*`
- `/app/admin/*`

Do not place the widget on marketing, sign-in, sign-up, onboarding, invitation acceptance, or access-denied pages.

## 1. Remove the dashboard right rails

Remove the complete right-side card rail represented in the reference image, including:

- Inbox / Notifications cards
- Nearby / Recent activity / Job opportunities cards
- Quick actions cards
- Any “Ask AI” or “Ask Bundleen AI” item inside those rails

Known implementations to inspect include:

- `src/components/layout/HomeownerShell.tsx`
- `src/components/layout/ProviderShell.tsx`
- `src/app/app/homeowner/dashboard/page.tsx`
- Shared `.dash-right-rail` and dashboard grid rules in `src/app/globals.css`

Search all authenticated dashboards for additional copies; do not only remove the provider version from the screenshot.

After removal:

- Expand the main dashboard content into the freed space.
- Keep sensible maximum widths so content does not become excessively stretched on large screens.
- Preserve primary page actions elsewhere in the main content or navigation.
- Do not remove the top notification bell or the underlying database notification system.
- Replace the bell's current “scroll to notifications card” behavior with an accessible notification popover/dropdown using `useNotifications`. It must support loading, empty, read/view, and dismiss states. The bell must not point to a removed DOM element.

## 2. Build one global floating Bundleen AI widget

Create a reusable component such as `BundleenAiWidget` and mount it once in each authenticated shell/layout:

- `HomeownerShell`
- `ProviderShell`
- `HoaManagerShell`
- `AdminCrmShell`

Reuse the existing production AI implementation where possible:

- `src/components/ai/BundleenAiPanel.tsx`
- `src/hooks/useBundleenAi.ts`
- `/api/ai/chat`
- `/api/ai/history`
- `/api/ai/memory`

Do not create a second AI API or duplicate conversation state logic.

### Closed state

- Show a small, polished AI/chat icon fixed to the bottom-right.
- Use the Bundleen green/teal design system and a recognizable sparkle/chat symbol.
- Include an accessible name such as `Open Bundleen AI` and a useful tooltip.
- Account for mobile safe-area insets and do not overlap navigation, existing floating action buttons, or essential controls.
- The control must not look like a generic page action or a second “new request” button.

### Open state

- Open a floating chat window anchored above the button on desktop.
- Provide a clear header, Bundleen AI identity, close/minimize control, message history, streaming state, composer, retry state, and clear-conversation action.
- Keep the panel within the viewport at laptop and large-monitor sizes.
- On narrow mobile screens, use a full-width bottom sheet or near-full-screen dialog with safe-area padding rather than a tiny desktop panel.
- Use a production z-index policy: above page content and menus, but below critical auth/security modals.
- Lazy-load the panel so closed pages do not download/render the full conversation UI unnecessarily.
- Do not call the AI endpoint until the user sends a message. History loading may occur when the widget first opens.
- Preserve the conversation while navigating between pages inside the same role shell.
- Never allow more than one widget or panel instance on a page.

### Accessibility and interaction

- Use dialog semantics while open, with an accessible title.
- Support keyboard open/close, `Escape`, visible focus states, and logical focus return to the launcher.
- Trap focus on mobile/full modal presentation; desktop non-modal behavior may allow page interaction only if it remains keyboard-safe.
- Prevent background scroll for the mobile dialog.
- Respect `prefers-reduced-motion`.
- Do not use hover-only controls.

### Authorization and errors

- Continue using server-derived identity and role authorization. Never trust a role or community ID supplied only by the client.
- Preserve the existing admin, HOA manager, homeowner, and provider data isolation.
- Show clear states for network failure, rate limiting, missing AI configuration, and empty history.
- Do not expose raw model/provider errors, SQL, tokens, or internal tool payloads.

## 3. Remove conversational AI from chat and message tabs

Homeowner chat and provider messages must contain only real human/group communication.

Update at least:

- `src/app/app/homeowner/chat/page.tsx`
- `src/app/app/provider/messages/page.tsx`

Remove:

- The `Bundleen AI` contact/thread
- AI-only thread types and conditional rendering
- AI composer placeholders and AI labels in the chat header
- Copy such as “Neighbors, groups, providers and AI” or “Customers, active bids and AI”
- Any chat-tab buttons that open or simulate an AI conversation

Keep human homeowner, neighbor, HOA, provider, bid, and group conversations intact. Empty states should describe only the remaining real messaging use cases.

This task removes only the conversational assistant from messaging. Do not remove separate product features such as AI bid analysis, request drafting, schedule optimization, or dispute assistance unless they are themselves implemented as a fake chat contact.

## 4. Remove duplicate AI navigation and pages

Because the widget is now global, remove dedicated “Ask Bundleen AI” navigation items from the HOA and admin sidebars.

Inspect:

- `src/components/hoa/HoaManagerShell.tsx`
- `src/components/admin/AdminCrmShell.tsx`
- `/app/hoa/assistant`
- `/app/admin/assistant`

Legacy assistant URLs should redirect safely to the appropriate dashboard rather than leaving broken bookmarked links. Do not render a second assistant page alongside the widget.

Remove remaining dashboard “Ask AI” buttons/cards whose only purpose is opening the conversational assistant. The floating widget should be the single conversational AI launcher.

## 5. Production UI requirements

- Use shared design tokens and existing icon primitives; avoid one-off inline styling where reusable component styles are appropriate.
- The panel must look correct in all four shells and at common widths: approximately 375, 768, 1280, and 1536 pixels.
- Avoid layout shift when opening or closing.
- Long messages, streaming text, errors, and the mobile keyboard must not break the layout.
- Sanitize/render assistant content safely. Do not introduce raw HTML rendering.
- Add a small unread/attention indicator only if backed by real state; do not add a decorative fake count.
- Keep notification state separate from AI state.

## 6. Tests and verification

Add or update tests that verify:

- Each authenticated shell renders exactly one AI launcher.
- The widget opens, closes, restores focus, and handles `Escape`.
- Mobile presentation and desktop presentation use the intended responsive layout.
- Streaming, retry, rate-limit, empty-history, and clear-history states still work.
- Role-specific AI authorization remains enforced server-side.
- Homeowner chat contains no Bundleen AI thread or AI composer path.
- Provider messages contain no Bundleen AI thread or AI composer path.
- Admin and HOA navigation no longer contain dedicated assistant links.
- Legacy assistant URLs redirect to the correct dashboards.
- Notification bells open the new notification popover and no longer scroll to removed rail cards.
- No dashboard renders `.dash-right-rail`, Inbox/Nearby/Quick Actions rail cards, or duplicate conversational AI launchers.

Run:

- Prisma validation if schema files are touched
- TypeScript typecheck
- Full unit test suite
- Production Next.js build
- Visual checks at mobile and desktop widths for homeowner, provider, HOA manager, and admin shells

## Completion criteria

- The large dashboard right rails are gone everywhere and main content uses the available space correctly.
- The top notification bell remains fully functional through a popover/dropdown.
- One compact floating Bundleen AI launcher appears on every authenticated app page.
- Its panel is responsive, accessible, role-aware, and connected to the existing production AI backend.
- Human chat/message pages contain no AI contact or AI conversation mode.
- Dedicated assistant navigation/pages no longer duplicate the widget.
- Tests, typecheck, and production build pass.

Do not commit, push, or deploy until the implementation has been reviewed.
