# HOA amenities, bookings, issues, and reviews

Everything in this document is private to one official `hoa` community. There
is no public listing, no provider surface, and no location-based
`neighborhood` surface. Every read and write is scoped to an active HOA
membership, an active staff assignment for that HOA, or a Bundleen admin.

---

## 1. Data model

| Model | Holds | Notes |
| --- | --- | --- |
| `Amenity` | One shared space, its rules, and its booking policy | `ratingCount`/`ratingSum` are transactionally maintained, never recomputed |
| `AmenityResource` | One independently bookable unit (`Court 1`, `Court 2`) | Capacity is rows, not a number — see §2 |
| `AmenityHours` | Weekly opening windows in minutes from local midnight | `closesMinute` may reach 1800 to express an overnight window |
| `AmenityClosure` | A dated closure or a weekly recurring one | CHECK-enforced to be exactly one shape |
| `AmenityBooking` | One reservation of one resource | Carries a frozen `policySnapshot` and `timezone` |
| `AmenityBookingEvent` | Append-only booking history | |
| `AmenityIssue` + `Message` + `Event` | HOA operations ticket | **Not** a `SupportTicket` — see §6 |
| `AmenityReview` + `AmenityReviewResponse` | Resident rating, one manager reply | |
| `MediaAsset` | One stored image with exactly one owner | `storageUrl` is server-only — see §5 |

Amenities are attached to `hoa` communities only. That is enforced by the
`amenity_requires_hoa` trigger, not by application code alone, so a bug
elsewhere becomes a rejected write rather than a cross-product leak.

### Migration

`prisma/migrations/20260830090000_hoa_amenities` is additive and forward-only.
It creates new tables, adds values to three existing enums, and touches no
marketplace table: no HOA request, bid, agreement, occurrence, visit, review,
or audit row is read, rewritten, or deleted. `tests/amenity-migration-objects.test.ts`
asserts both properties against the file that will actually be applied.

It requires the `btree_gist` extension. `CREATE EXTENSION IF NOT EXISTS
btree_gist;` is in the migration; if the deploy role cannot create extensions,
an operator must run it once as superuser first.

**Recovery.** The rollback sequence is in the migration header. In short: drop
the amenity tables and `DELETE FROM "OutboxEvent" WHERE "kind" =
'amenity_booking_reminder'`. The added enum values are harmless to leave —
PostgreSQL cannot drop one, and nothing outside these tables writes them.

---

## 2. Why overbooking is impossible, not merely unlikely

Capacity is modelled as `AmenityResource` rows. One exclusive clubhouse has one
row; four identical tennis courts have four. Every booking holds exactly one
resource.

```sql
ALTER TABLE "AmenityBooking" ADD CONSTRAINT "AmenityBooking_no_overlap"
  EXCLUDE USING gist (
    "resourceId" WITH =,
    tsrange("blockStartsAt", "blockEndsAt", '[)') WITH &&
  )
  WHERE ("status" IN ('pending_approval', 'confirmed'));
```

Two residents submitting for the last slot at the same instant both pass the
availability check — that is unavoidable, and a check-then-insert would sell
both. PostgreSQL fails exactly one insert with SQLSTATE `23P01`.
`createBooking` catches it, reloads the snapshot, and re-evaluates: on a
four-court amenity the loser is quietly given another court, and only when
every resource is genuinely taken does anyone see *"That time was just
taken."*

The range is half-open (`[)`), so 10:00–11:00 and 11:00–12:00 touch without
colliding. `blockEndsAt` includes the cleanup buffer **in force when the
booking was made**, so a later buffer change cannot move an existing
reservation's footprint.

---

## 3. Availability

`lib/server/amenity-availability.ts` is pure: rules and held blocks in, a
decision out. The browser calls it through `/availability` to *preview* slots;
`createBooking` calls the same `evaluateBookingRange` to *decide*. They cannot
disagree, because the calendar is a loop over the decision function.

It accounts for timezone and DST, weekly hours including overnight windows,
resource capacity, live bookings, slot alignment and buffers, blackout /
maintenance / holiday / private-event closures, minimum notice, the advance
window, per-resident and per-unit limits, and party size.

### Daylight saving

`lib/server/timezone.ts` converts wall-clock times using `Intl`, and reports
how each conversion resolved:

- **`exact`** — the ordinary case.
- **`ambiguous`** — the fall-back hour happens twice. The *earlier* instant is
  used, which is what a resident booking "1:30am" means.
- **`nonexistent`** — the spring-forward hour never happens. Such slots are
  **skipped** rather than emitted: a slot labelled 02:00 that no clock in the
  HOA will ever show is not a slot, and emitting it would collide with 03:00.

Both cases are covered in `tests/amenity-availability.test.ts` against real
`America/Chicago` transition dates.

---

## 4. The 30-minute reminder

A reminder is an `OutboxEvent` of kind `amenity_booking_reminder` whose
`nextAttemptAt` is `startsAt - 30 minutes`. No timer, no service worker, no
open tab.

| Requirement | How |
| --- | --- |
| Durable | A database row, not a process |
| Stable dedupe key | `amenity-reminder:{bookingId}:{startsAtISO}` |
| Concurrency-safe | The existing claim-based `updateMany` in `deliverPendingOutbox` |
| Retry / dead-letter | The existing backoff; `status = failed` after 8 attempts |
| Timezone-independent | The due time is UTC; only rendering uses the HOA zone |
| Starts in < 30 min | Due time clamps to "now" — delivered on the next pass |
| Cancel / reschedule | The pending row is deleted; a reschedule queues a new key |
| Never stale | The worker re-reads the booking and compares its start instant |

The last row is the important one. Deleting the pending row handles the normal
path, but a delete that races the worker's claim would still deliver. So
`resolveBookingReminder` re-reads the canonical booking and sends nothing if it
is not `confirmed`, if its `startsAt` no longer matches the queued value, if it
has already started, or if it is a manager's maintenance block.

**Cadence.** `vercel.json` runs `/api/jobs/reminders` every five minutes — the
tightest Vercel Cron offers on Hobby/Pro — so a reminder due at T-30 goes out
between T-30 and T-25, inside the promised window. The daily `/api/jobs/outbox`
job is kept as recovery. For a tighter guarantee, point an external scheduler at
the same URL with `OUTBOX_WORKER_SECRET`; no code change is needed.

**Payloads carry ids only.** `{ bookingId, startsAt }` — no address, access
note, resident note, or personal data ever enters the queue.

---

## 5. Media

Uploads go through `lib/server/media.ts`, which is deliberately not a copy of
the avatar handler. An avatar is a photo someone chose to publish; these
include the inside of a resident's clubhouse and photographs attached to a
private complaint.

- **The bytes decide the type.** Declared MIME and filename are attacker-chosen
  and ignored; magic bytes are sniffed, and only JPEG, PNG, and WebP pass.
- **Every image is re-encoded** through sharp, which drops EXIF — including the
  GPS tags that would otherwise publish a resident's coordinates inside a photo
  of a broken gate — and turns a decompression bomb into a failed decode
  (`limitInputPixels`) rather than a stored payload.
- **No public URL is ever handed out.** `MediaAsset.storageUrl` is server-only
  and never serialized. Browsers get `/api/hoa/amenities/media/{id}`, which
  re-runs authorization on every request, so revoking a membership revokes the
  photos with it. Responses are `private, no-store` with `nosniff`.
- **A failed database write takes its blob with it.**
- Limits: 8 MB per file; 12 gallery, 5 issue, 3 review images per owner;
  longest edge 2400 px. Uploads are rate-limited per account.

**Residual risk, stated plainly.** Vercel Blob on this plan issues
public-if-known URLs. The stored URL is unguessable and never leaves the
server, so the practical exposure is "an attacker who can already read the
database". If private buckets or signed URLs become available,
`readMediaBytes` is the single function to change.

**Retention.** `removeMedia` deletes the stored object and keeps the row as a
soft-removed record. The audit trail — who uploaded what, and when it was taken
down — outlives the file; the private image does not.

---

## 6. Issue tickets are not support tickets

An amenity issue is an HOA operations ticket owned by that HOA's manager. It is
a different table from `SupportTicket`, uses a different notification kind, and
is referenced by nothing in `lib/server/ai/**` — so the AI support assistant
cannot ingest it. Making that structural rather than a filter is the point.

**Internal notes.** A manager can write a note the reporter must never see.
That is enforced in exactly one place: `serializeIssue(row, viewer, audience)`
removes `internal_note` rows from the array for a `"reporter"` audience, so
they are absent from the JSON entirely rather than hidden by the client. An
internal note also notifies nobody — telling a resident "there is an update you
cannot read" leaks its existence.

---

## 7. Reviews

**Eligibility, as chosen and implemented:**

- A **bookable** amenity is reviewable once per *completed* booking. Three
  completed sessions means three reviews, each badged "verified booking".
- A **non-bookable** common area is reviewable once by any active resident.
  The "once" is enforced by a partial unique index, not only a pre-check.

`Amenity.ratingCount` / `ratingSum` move in the same transaction as every
review write, by the exact delta, and a CHECK constraint bounds them — so a
drift bug becomes a failed write rather than a quietly wrong star rating.

**A manager may respond, once, always labelled. A manager may never edit or
delete a resident's review** — there is deliberately no code path for it.
Removal is a Bundleen admin moderation action that records a reason and writes
an audit row.

---

## 8. Permission matrix

| Action | Resident | HOA staff | Bundleen admin | Provider / other HOA |
| --- | --- | --- | --- | --- |
| List published amenities | ✓ | ✓ | ✓ | ✗ |
| See draft / archived | ✗ | ✓ | ✓ | ✗ |
| Book, cancel, reschedule own | ✓ | ✓ (as resident) | ✗ | ✗ |
| Approve / decline / complete | ✗ | ✓ | ✓ (audited) | ✗ |
| Create / edit / publish / archive | ✗ | ✓ | ✓ (audited) | ✗ |
| Closures, gallery, cover | ✗ | ✓ | ✓ (audited) | ✗ |
| Open an issue | ✓ | ✓ | ✗ | ✗ |
| Read an issue thread | own only | ✓ (their HOA) | ✓ (audited) | ✗ |
| Read an internal note | ✗ | ✓ | ✓ | ✗ |
| Write a review | ✓ (eligible) | ✗ (unless resident) | ✗ | ✗ |
| Respond to a review | ✗ | ✓ | ✓ | ✗ |
| Remove a review | own only | ✗ | ✓ (audited) | ✗ |
| Message HOA residents | ✗ | ✓ (own HOA) | ✓ | ✗ |
| Message any other audience | ✗ | ✗ | ✗ | ✗ |

Bundleen admin access is a *recovery* path. It is recorded in
`AdminAuditLog.metadata.via = "admin"`, so it stays distinguishable from a
manager's own work.

---

## 9. HOA-scoped messages

`lib/server/amenity-communications.ts` reuses the delivery infrastructure — the
preference-aware notification builder, the durable outbox, Resend — and
deliberately **not** the global `Broadcast` model. A manager must never reach
the Bundleen-wide audience, and the most reliable way to guarantee that is not
to hand them the machinery: there is no segment parameter, no "all HOAs"
option, and no code path that omits the community filter.
`tests/amenity-communications.test.ts` asserts the module imports none of it.

Three audiences, all `communityId`-rooted: all active residents, residents with
an upcoming booking for one amenity, residents affected by a closure.

Idempotency is a hash of the message plus a ten-minute bucket: two clicks send
once, a genuine correction ten minutes later sends again.

An **urgent** message overrides residents' email preferences, so it requires a
written justification and writes an audit row naming the manager who claimed
it. Ordinary announcements honour the preference.

---

## 10. Out of scope

Explicitly not built, and not to be inferred from the schema: payments, public
or non-resident rentals, guest accounts, door-lock integration, and external
calendar sync.
