# Bundleen Community Roles and Internal Admin Portal

## Goal

Build the real community/account-management foundation for Bundleen.

Bundleen has only two public customer experiences:

1. **Homeowner**
2. **Service provider**

Do not add separate public signup choices or separate customer applications for HOA managers, HOA team members, or neighborhood managers. Those people use the homeowner experience, and Bundleen staff assign their community responsibilities from a private internal admin portal.

The existing `admin` database role and `/app/admin/**` routes are reserved for Bundleen staff. They are not a third public customer type and must never be obtainable through public registration.

## Admin portal ownership and shared access

- The immutable primary owner is `lancedsilva2000@gmail.com`.
- Admin authentication is sign-in-only at `/admin/sign-in`; it has no create-account link.
- The `admin` role alone is insufficient. Every portal request also requires an active `AdminAccessGrant` linked to the signed-in Clerk identity's verified email.
- Only the primary owner may grant or revoke shared admin access.
- Shared access is granted to an existing, verified Bundleen/Clerk account by email and stored in Postgres. It never stores or creates a password.
- Public signup continues to create only homeowner or provider accounts.
- Revoking shared access immediately restores the account's previous public role and preserves the access history.
- Admin-access changes are written to the append-only audit log without recording the invited email in audit metadata.

## Business model

There are two community types:

### 1. Official HOA community

- Represents an existing HOA.
- Contains homeowner residents.
- Can have an HOA manager and HOA team members.
- An HOA manager or team member does **not** need to be a resident homeowner in that HOA.
- Bundleen staff manually assign and remove HOA manager/team access.
- The data model should allow an HOA manager/team member to be assigned to more than one HOA later, even if the first UI focuses on one community at a time.

### 2. Location-based neighborhood community

- For homeowners who are not part of an official HOA community.
- Formed using stored latitude/longitude, a center point, and a configurable radius.
- Contains the nearest/eligible homeowners whose verified signup location falls inside the radius.
- Has at most one neighborhood manager.
- The neighborhood manager **must already be an active homeowner member of that same neighborhood community**.
- Nobody outside that neighborhood community can be assigned as its manager.
- Bundleen staff make the manager assignment; homeowners cannot promote themselves.

## Required account and permission model

Do not add `isManager`, `isHoaManager`, or similar booleans to `User`. These responsibilities belong to a specific community and must be stored as scoped database records.

Keep the current global roles:

- `homeowner`
- `provider`
- `admin` — internal Bundleen staff only

Add community-specific records along these lines (exact names may be adjusted to fit Prisma conventions):

### `Community`

- `id`
- `name`
- `type`: `hoa | neighborhood`
- `status`: `active | archived`
- `centerLatitude` and `centerLongitude`
- `radiusMiles` (required for a neighborhood; optional for an HOA)
- timestamps

### `CommunityMembership`

This represents homeowner residency/membership, not management permission.

- `communityId`
- `userId`
- `status`: `pending | active | removed`
- `joinedAt`
- optional `isPrimary`
- unique community/user pair
- only users whose global role is `homeowner` may become homeowner members

### `CommunityStaffAssignment`

This represents scoped operational access.

- `communityId`
- `userId`
- `role`: `neighborhood_manager | hoa_manager | hoa_team`
- `status`: `active | revoked`
- `assignedByUserId` (Bundleen admin who assigned it)
- `assignedAt` and `revokedAt`
- unique active assignment for the same community/user/role

Enforce these rules in server-side services and APIs:

- `neighborhood_manager` is valid only for a `neighborhood` community.
- A neighborhood manager must have an active `CommunityMembership` in the same community.
- A neighborhood community can have no more than one active neighborhood manager. Enforce this at database level where practical (for example, a partial unique index in the SQL migration) and also validate it in the service layer for a useful error message.
- `hoa_manager` and `hoa_team` are valid only for an `hoa` community.
- HOA staff assignments do not require a resident membership.
- Removing the neighborhood manager's homeowner membership must first revoke or transfer their manager assignment in the same operation.
- Users cannot assign, elevate, or revoke their own roles.

## Internal Bundleen admin portal

Refactor the existing mock HOA-flavored `/app/admin/**` area into a private **Bundleen operations portal** backed by Neon. Preserve the existing `requireRole(["admin"])` server-side gate.

### Admin overview

Show real summary counts and links for:

- HOA communities
- location-based neighborhood communities
- homeowners/members
- providers by status
- communities without a manager
- pending assignments or provider reviews

### Communities list

At `/app/admin/communities` (or consistently rename the existing community route):

- Search and filter communities by name, type, status, and manager state.
- Create and edit a community.
- For neighborhood communities, edit center coordinates and radius with validation.
- Archive rather than hard-delete communities that have memberships/history.
- Clicking a community opens a real detail page.

### Community detail

The detail page must show:

- community name, type, status, location/radius
- active, pending, and removed homeowner members
- current manager and HOA team assignments, as applicable
- member name, initials/avatar, email, join state, and relevant location eligibility without exposing unnecessary precise coordinates
- actions to add/remove members and assign/revoke scoped roles

Role assignment behavior:

- For a neighborhood community, the manager selector must list only active homeowner members of that community.
- Assigning a new neighborhood manager should require an explicit confirmation and atomically replace/revoke the prior manager if one exists.
- For an HOA, Bundleen admins may select an eligible existing homeowner account as HOA manager/team even if that account is not a resident member of the HOA.
- All mutations must be authenticated, admin-authorized, validated, rate-limited where appropriate, and recorded in an audit log.

### Provider controls

Add a real provider-management area to the internal portal:

- Search and filter service providers.
- Open a provider detail page.
- View company/profile details, claimed trades, service area, license/insurance claims, and trusted verification timestamps.
- Set provider account status such as `pending | active | suspended`.
- Verify or revoke license and insurance verification using server-controlled timestamps; providers must never write these fields themselves.
- Optionally assign/remove the communities the provider is approved to serve if this relationship is needed by the current job/bid flow. If not yet consumed elsewhere, model it cleanly but do not show fake assignments.
- Record who made every provider status/verification change and when.

Suspending a provider must block provider-only mutations and new bidding, while preserving historical bids/jobs. Do not delete provider history.

## Homeowner and provider dashboard behavior

There remain only two public customer dashboard families:

- `/app/homeowner/**`
- `/app/provider/**`

Do not create separate `/hoa-manager` or `/neighborhood-manager` customer applications.

### Top-right identity area

The top-right profile/avatar area must load its role context from a server-authorized API/database query, not local storage or editable Clerk metadata.

For homeowners, show the most relevant scoped label:

- `Homeowner`
- `Neighborhood manager`
- `HOA manager`
- `HOA team`

For providers, show:

- `Service provider`
- provider status where useful (`Pending`, `Active`, or `Suspended`)

Role changes made by Bundleen admins must appear after refresh and preferably after a normal client revalidation without requiring a new login.

### Conditional homeowner management controls

- A normal resident sees the ordinary homeowner dashboard.
- A neighborhood manager sees additional community-management navigation/actions within the homeowner dashboard.
- An HOA manager/team member sees appropriate HOA community controls within the homeowner dashboard.
- These are conditional sections of the same homeowner experience, not separate account types.
- The server must authorize every management read/write from live community assignments. Hiding navigation is not security.

For the first implementation, customer-side management controls can be read-only summaries if write permissions are not fully defined. Bundleen admin assignment and enforcement are the priority; do not invent broad manager powers.

## Geolocation membership behavior

- Continue storing the homeowner's normalized address plus latitude/longitude.
- Never expose exact homeowner coordinates in lists unnecessarily.
- Match a non-HOA homeowner to a neighborhood community using a server-side distance calculation and the community radius.
- Do not trust a browser-provided community ID or calculated distance.
- Do not automatically move an existing HOA resident into a neighborhood community.
- A manual Bundleen admin override should be possible and auditable.
- Define deterministic behavior when more than one neighborhood radius matches (for example, closest center, then stable ID as a tie-breaker).

## Audit log

Add an immutable admin audit record for sensitive changes:

- actor Bundleen admin user ID
- action type
- target type and target ID
- community/provider ID where relevant
- safe before/after metadata (no secrets and no unnecessary address/coordinate data)
- timestamp

At minimum audit:

- manager/team assignment and revocation
- community creation/edit/archive
- member add/remove/override
- provider activation/suspension
- license/insurance verification changes

## API and security requirements

- Create validated admin Route Handlers under a consistent namespace such as `/api/admin/communities/**` and `/api/admin/providers/**`.
- Use `authorizeRequest(["admin"])` or the existing equivalent on every internal endpoint.
- Customer community endpoints must resolve live membership/staff assignments from Neon.
- Never trust a client-submitted global role, staff role, verification flag, account status, assignment actor, distance, or community eligibility result.
- Use idempotent mutations and avoid long-running interactive transactions on the serverless Neon pool (the signup flow already demonstrated `P2028`). Prefer nested writes, short sequential operations, and database constraints.
- Return explicit `400`, `401`, `403`, `404`, and `409` responses; keep database/internal details out of client errors.
- Protect destructive/role-changing operations from accidental double submission.
- Do not store authorization only in Clerk metadata. Clerk owns identity/session; Neon is authoritative for Bundleen roles and assignments.

## Migration and backfill

- Add a reviewed Prisma migration for the new enums/models/indexes and provider status fields.
- Preserve all existing users and profiles.
- Do not guess community memberships for existing users unless the server can make a valid radius match from stored coordinates.
- Existing providers should receive a documented conservative status (`pending` unless current trusted data justifies `active`).
- Replace the existing admin mock data only when the corresponding real query/API is ready; empty states must be honest.

## Suggested implementation order

1. Prisma schema, SQL constraints/indexes, migration, and test fixtures.
2. Server-side community/provider authorization and assignment services.
3. Admin community list/detail APIs and UI.
4. Admin provider list/detail APIs and UI.
5. Viewer-context API for top-right role/status labels.
6. Conditional homeowner navigation and role-aware summary sections.
7. Geolocation-based neighborhood assignment and admin override.
8. Audit-log UI and final removal of admin mock data.

## Acceptance criteria

- Public signup still offers only homeowner and service provider.
- Bundleen internal admins are provisioned privately and remain protected from public role escalation.
- Admins can view communities, click into one, see real members, and manage valid role assignments.
- A neighborhood manager can only be selected from active members of that neighborhood, and only one is active at a time.
- HOA managers/team members can be assigned without being HOA resident members.
- Admins can view and control real provider status and trusted verification fields.
- Assigned roles/statuses appear in the customer's top-right dashboard identity area from live server data.
- The homeowner/provider customer routes remain the only two public dashboard families.
- Server authorization—not conditional UI—enforces all permissions.
- All sensitive admin changes are audited.
- No mock member/community/provider claims remain on completed admin screens.
- Typecheck, unit/integration tests, production build, and migration deployment pass.

## Explicitly out of scope for this task

The referral/free-service reward system is part of the product direction but should be a later task after community membership and manager assignment are stable. Do not implement a multi-level referral chain or editable reward counters here. Future rewards should use qualified referral records and an immutable credit ledger, not booleans or manually incremented totals.
