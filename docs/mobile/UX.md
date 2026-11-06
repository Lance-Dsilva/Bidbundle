# Native UX plan (draft for independent review)

Source: docs/homepage-v5.md, src/app/landing.css, existing role screens and shells. V5 tokens: warm paper #F8F6EF, forest ink #193E34, teal #087666, muted #596C61, divider #CFD8CA. Serif headings and readable platform body typography; use bundled/licensed fonts or platform fallbacks, never assume Georgia is present on Android. Preserve the shared company icon geometry and original asset provenance. Marketing illustrations remain illustrative, not customer evidence.

## Navigation and authority
Start with sign-in/sign-up and server-derived context. Homeowner tabs: Home, Requests, Inbox, Account; request creation is an explicit action. Provider: Overview, Marketplace, Inbox, Account; scheduling/service areas accessible within provider journeys. HOA management appears only after server grants, with explicit managed-community selection; community resident tools do not imply manager authority. Switching among server-authorized workspaces/assignments refreshes context and clears previous role/community data. Back returns within the active stack; Android back and iOS swipe-back must preserve drafts or offer a discard choice. Notifications and support are reachable without crowding the main navigation. Admin stays on the web and is explicitly deferred.

## Screen acceptance
Use 48 logical-pixel targets, safe areas, visible focus, semantic labels and accessible status text in addition to color. Support text scaling to 200%, small phones, landscape and keyboard insets without clipped actions. Honor reduced motion. Label form fields and inline errors; retain correct input on recoverable failures. Native date/time pickers display timezone clearly. Never infer award, savings or eligibility from client-side arithmetic.

Each network screen distinguishes initial loading, empty success, refreshing, offline/error with retry, forbidden, missing profile/onboarding, expired session and slow response. Do not display a permission error as an empty list. Clear protected content on sign-out or identity change, reject late responses from a previous session. No automatic replay of writes after timeout. Confirm destructive actions with concrete consequences.

## Review evidence required
Capture iOS and Android screenshots for sign-in, context/dashboard, empty/error, 200% text, role switching and each subsequent completed flow. Screenshots must use safe test identities and contain no tokens/production personal data. Reviewer records device/OS, font scale, expected behavior, findings and resolution; source inspection is not runtime UX evidence. None captured yet.

VoiceOver/TalkBack review must verify traversal, field/error announcements and focus after navigation. Measure contrast on actual composited colors. Preserve drafts across background/resume where safe; never persist tokens or sensitive drafts by accident. Hosted auth must expose cancellation and return to a usable signed-out screen. Workspace selection never changes the account database role.
