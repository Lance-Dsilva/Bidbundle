# Task: Resolve Provider Profile and Service-Area GitHub Issues

## Objective

Resolve the three open provider-portal issues in `Lance-Dsilva/Bidbundle` as one focused, production-quality UI and functionality pass. Preserve the current Bundleen colors, typography, navigation patterns, APIs, provider matching rules, and security model.

GitHub issues in scope:

1. [#1 — Service provider account details modification option required](https://github.com/Lance-Dsilva/Bidbundle/issues/1)
2. [#2 — Remove the Business/Grow your business card](https://github.com/Lance-Dsilva/Bidbundle/issues/2)
3. [#3 — Service Area card UI modification](https://github.com/Lance-Dsilva/Bidbundle/issues/3)

Do not redesign unrelated provider pages. Inspect the current implementation before changing it because issue #1 is already partially implemented.

---

## Findings from the issues and screenshots

### Issue #1: provider details editing

The screenshot shows the provider `Profile & business` page. It includes:

- A provider summary card with photo, company name, location, radius, reviews, and bio.
- Business details showing service area, working hours, address, and payout status.
- Verification status for business licence and liability insurance.
- A top-level `Edit public profile` button.

The current code already contains an edit dialog in:

- `src/app/app/provider/profile/page.tsx`
- `src/hooks/useProviderProfile.ts`
- `src/app/api/profile/provider/route.ts`

The current dialog includes name, phone, company name, neighborhood, business address, trades, licence number/state, insurance provider/policy number, working hours/days, and bio. Therefore, do **not** add a second profile editor or falsely consider the issue finished merely because the button exists.

The real work is to make the current editor obvious, complete, reliable, and correctly reflected in the read-only profile after save and reload.

### Issue #2: sidebar promotional card

The screenshot identifies the `Grow your business` sidebar card containing:

- “Find nearby jobs without extra driving.”
- Supporting neighborhood-demand text.
- A `Find jobs` button.

It is rendered by `src/components/layout/ProviderShell.tsx` as `provider-growth-card`. Remove this card from the provider sidebar only. Do not remove shared card styles or cards used by homeowner/HOA layouts unless they become provably unused.

### Issue #3: service-area UI

The screenshot shows the current service-area panel with:

- A wide outer card.
- A narrow fixed list column on the left containing one small area card.
- A tall editor squeezed into the right column.
- A large unused blank region under the left list.
- Address search, map, radius slider, explanation, and area-name controls separated vertically.

The functionality is valuable, but the hierarchy and space usage are poor. The selected area summary should be compact, while the map and editing controls should receive most of the available width.

Relevant components:

- `src/components/provider/ProviderServiceAreasPanel.tsx`
- `src/components/provider/ProviderServiceAreaEditor.tsx`
- `src/lib/provider-coverage.ts`
- `/api/provider/service-areas`

---

## Required implementation

## 1. Complete and clarify provider account editing

### UI requirements

- Keep one clear primary action near the page title, labelled `Edit business details` or similarly explicit. “Edit public profile” is too narrow for a dialog that also edits licence, insurance, trades, address, and working hours.
- Organize the existing edit experience into understandable sections:
  1. Public business profile — company name, photo, bio, phone.
  2. Services offered — trades/services.
  3. Business location — business address.
  4. Availability — working days and opening/closing hours.
  5. Credentials — licence number/state and insurance provider/policy number.
- Use the existing design system and standard form controls. Avoid a very long undifferentiated field grid.
- Clearly distinguish editable provider claims from Bundleen-controlled verification state.
- Explain that changing a previously verified licence or insurance claim sends it back for review.
- After save, update the visible summary immediately and ensure a browser reload shows the same persisted values.
- Show field-level validation, a form-level network/server error, saving state, and a success confirmation.
- Prevent accidental loss of edits when closing the dialog. If the form is dirty, request confirmation before discarding.
- Ensure the dialog is usable by keyboard, has focus management, labelled controls, Escape behavior, and a mobile layout that does not overflow.

### Functional requirements

- Confirm every requested field is accepted by the current validation schema, serialized correctly, and saved to the correct `User` or `ProviderProfile` record.
- Normalize trades/services consistently and prevent blank or duplicate trade entries.
- Validate working-hour pairs and licence/insurance field dependencies.
- Providers may edit their claims but may never set `isLicenseVerified`, `isInsuranceVerified`, verification timestamps, payout status, account status, or any administrator-owned field.
- If a verified licence or insurance claim changes, revoke only the affected verification, create the appropriate audit entry, and display it as pending review.
- Resolve the provider exclusively from the authenticated session. Never accept a user/provider ID from the client as ownership.
- Do not expose coordinates as manually editable profile fields. Coverage coordinates remain managed by the service-area editor.

### Existing implementation warning

Before writing code, test the current `Edit public profile` flow end-to-end. Reuse and refactor it rather than creating a parallel route or modal. Remove obsolete code only after all current fields and security behavior are preserved.

---

## 2. Remove the provider sidebar growth card

- Remove the `Grow your business` / `Find nearby jobs without extra driving` promotional card from `ProviderShell`.
- Keep `Job Feed` in the primary provider navigation; the functionality remains available there.
- Remove provider-only CSS that becomes unused, but do not remove generic sidebar styles still used by homeowner or HOA shells.
- Rebalance the sidebar so the account/profile block remains visually anchored and the navigation does not leave an awkward gap.
- Verify desktop, tablet, and mobile navigation. The card must not appear at any breakpoint.

---

## 3. Redesign the service-area panel without changing its behavior

### Desired information architecture

Use a compact summary-and-editor layout rather than a fixed narrow list beside a tall editor:

- Header row:
  - `Service areas` title and concise matching explanation.
  - `Add area` action.
- Compact saved-area selector/list:
  - Area label.
  - `Primary` badge where applicable.
  - City/formatted location and radius.
  - Clear selected state.
  - Compact `Edit` and `Remove` actions, with destructive confirmation.
- Selected/new area editor:
  - Address/area-center search in a full-width, clearly labelled row.
  - A large map that visibly draws the center marker and service-radius circle.
  - Radius value and slider adjacent to the map on wide screens or directly below it on smaller screens.
  - Area name and save/cancel actions grouped together.
  - A short plain-language matching summary, such as `Serving within 34 miles of Austin`.

### Layout requirements

- Eliminate the large empty area beneath the saved-area list.
- Do not squeeze the map, search field, or radius controls into an unnecessarily narrow column.
- On large screens, use balanced space—for example, a large map with a compact settings panel beside it, while saved areas sit above or in a compact rail that does not define the editor's full height.
- On tablet and mobile, use one column with a minimum touch target of 44px and no horizontal overflow.
- Keep the map attribution visible and legible without allowing it to dominate the card.
- Keep the existing Bundleen visual language; this is a hierarchy and spacing correction, not a color/brand redesign.

### Behavior that must be preserved

- Multiple service areas and maximum-area rules.
- Primary-area display and semantics.
- Address autocomplete/geocoding and reverse geocoding.
- Draggable/movable center behavior if currently supported.
- Radius minimum, maximum, step, normalization, and visible map circle.
- Existing-area editing, creation, cancellation, removal confirmation, optimistic rollback, and error handling.
- Unmappable legacy/postal-code areas.
- Session-owned `/api/provider/service-areas` authorization.
- Provider opportunity matching must continue using server-stored coordinates/radius, never browser-computed authority.

Do not replace the working map with a static image, store raw coordinates only in client state, or create a second coverage implementation.

---

## Security and data integrity

- Require an authenticated active provider for all provider profile and service-area mutations.
- Derive ownership from the server session on every request.
- Validate and normalize all profile, credential, address, trade, and radius inputs server-side.
- Do not permit mass assignment of administrator-owned fields.
- Preserve audit logging and verification revocation when verified claims are changed.
- Do not leak exact provider data beyond the existing authorized provider/admin surfaces.
- Preserve CSRF protections and same-origin authenticated API behavior already used by the application.

---

## Tests and verification

Add or update automated coverage for:

1. Provider profile edits persist across reloads for every editable field.
2. Unauthorized users and other providers cannot read or change another provider's profile/service areas.
3. Admin-owned verification, payout, and account fields cannot be modified by provider payloads.
4. Changing a verified licence revokes licence verification and writes an audit event without changing insurance verification.
5. Changing verified insurance does the equivalent without changing licence verification.
6. Trade normalization removes blanks/duplicates and rejects invalid values.
7. Invalid hours, credential fields, addresses, and service radii show useful validation errors.
8. Dirty-form close protection, save loading, success, and failure states.
9. The provider sidebar no longer contains the removed promotional card or its text.
10. Creating, selecting, editing, and removing service areas still works.
11. Map/radius changes save the correct normalized values and affect matching through the existing server logic.
12. Responsive UI checks at representative mobile, tablet, and desktop widths.

Run:

```bash
npm run typecheck
npm test
npx next build
```

Also manually inspect the provider profile at approximately 390px, 768px, and 1440px wide.

---

## Acceptance criteria

- Providers have one obvious, complete way to edit their public business details, trades, address, availability, licence claim, and insurance claim.
- Saved changes appear immediately and remain correct after reload.
- Providers cannot self-verify credentials or alter administrator-owned account fields.
- Changing verified credential claims correctly returns only those claims to pending review and is audited.
- The `Grow your business` sidebar card is absent from every provider route and breakpoint.
- Service-area management is compact and balanced, with no large wasted list-column space and no squeezed map/control column.
- All existing service-area creation, editing, removal, map, matching, and authorization behavior remains functional.
- No unrelated homeowner, HOA, admin, marketplace, bid, schedule, or earnings behavior regresses.
- Typecheck, the complete test suite, and the production build pass.

## Delivery notes

- Preserve unrelated working-tree changes.
- Do not close the GitHub issues until their acceptance criteria have been manually verified against the deployed UI.
- In the completion summary, map each code change and verification result to issue #1, #2, or #3.
- Do not commit, push, close issues, or deploy unless separately requested.
