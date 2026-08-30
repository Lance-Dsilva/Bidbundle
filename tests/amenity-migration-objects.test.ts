import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The amenity migration's database objects.
 *
 * Some of Part 5's guarantees are not expressible in application code at all —
 * "two residents cannot hold the same court at the same time" is an exclusion
 * constraint, and "an issue photo has exactly one owner" is a CHECK. If those
 * objects go missing from the migration, the code above them still compiles
 * and its unit tests still pass, so they are asserted here directly.
 *
 * The schema is read from disk rather than a live database: these tests must
 * run in CI with no PostgreSQL, and the file is the artifact that will be
 * applied to production.
 */

const MIGRATIONS_DIR = join(process.cwd(), "prisma", "migrations");
const MIGRATION_NAME = "20260830090000_hoa_amenities";

const migration = readFileSync(
  join(MIGRATIONS_DIR, MIGRATION_NAME, "migration.sql"),
  "utf8",
);
const schema = readFileSync(join(process.cwd(), "prisma", "schema.prisma"), "utf8");

/** Collapses whitespace so multi-line SQL can be matched as one string. */
const flat = migration.replace(/\s+/g, " ");

describe("no-overbooking guarantee", () => {
  it("enables btree_gist, which the exclusion constraint needs", () => {
    expect(flat).toContain("CREATE EXTENSION IF NOT EXISTS btree_gist");
  });

  it("declares the exclusion constraint over resource and time range", () => {
    expect(flat).toContain('ALTER TABLE "AmenityBooking" ADD CONSTRAINT "AmenityBooking_no_overlap"');
    expect(flat).toContain("EXCLUDE USING gist");
    expect(flat).toContain('"resourceId" WITH =');
    expect(flat).toContain('tsrange("blockStartsAt", "blockEndsAt", \'[)\') WITH &&');
  });

  it("restricts the constraint to the two statuses that hold capacity", () => {
    // A cancelled booking must free its slot; including it would make the
    // constraint block rebooking a released time.
    expect(flat).toContain(
      "WHERE (\"status\" IN ('pending_approval', 'confirmed'))",
    );
  });

  it("uses a half-open range so back-to-back bookings do not collide", () => {
    // `[)` — 10:00-11:00 and 11:00-12:00 touch without overlapping.
    expect(flat).toContain("'[)'");
  });
});

describe("tenant and integrity constraints", () => {
  it("refuses to attach an amenity to a non-HOA community", () => {
    expect(flat).toContain('FUNCTION "amenity_requires_hoa"');
    expect(flat).toContain('TRIGGER "amenity_requires_hoa_trigger"');
    expect(flat).toContain("community_type IS DISTINCT FROM 'hoa'");
  });

  it("keeps a booking's resource, community, and unit in one HOA", () => {
    expect(flat).toContain('FUNCTION "amenity_booking_consistency"');
    expect(flat).toContain('TRIGGER "amenity_booking_consistency_trigger"');
  });

  it("requires a cover photo to come from the amenity's own gallery", () => {
    expect(flat).toContain('FUNCTION "amenity_cover_belongs_to_amenity"');
  });

  it("gives every stored image exactly one owner, matching its purpose", () => {
    expect(flat).toContain('CONSTRAINT "MediaAsset_one_owner"');
    expect(flat).toContain('("amenityId" IS NOT NULL)::int');
    expect(flat).toContain("\"purpose\" <> 'amenity_issue' OR \"issueId\" IS NOT NULL");
  });

  it("allows only the three supported image formats at the storage layer", () => {
    expect(flat).toContain('CONSTRAINT "MediaAsset_supported_type"');
    expect(flat).toContain("'image/jpeg', 'image/png', 'image/webp'");
  });

  it("bounds ratings and keeps the stored aggregate self-consistent", () => {
    expect(flat).toContain('CONSTRAINT "AmenityReview_rating_range"');
    expect(flat).toContain('"rating" BETWEEN 1 AND 5');
    expect(flat).toContain('CONSTRAINT "Amenity_rating_aggregate"');
    expect(flat).toContain('"ratingSum" <= "ratingCount" * 5');
  });

  it("bounds the booking policy the availability engine relies on", () => {
    expect(flat).toContain('CONSTRAINT "Amenity_policy_bounds"');
    expect(flat).toContain('"maxDurationMinutes" BETWEEN "minDurationMinutes" AND 1440');
  });

  it("keeps a closure either dated or weekly, never both and never neither", () => {
    expect(flat).toContain('CONSTRAINT "AmenityClosure_one_shape"');
  });

  it("lets opening hours cross midnight but never invert", () => {
    expect(flat).toContain('CONSTRAINT "AmenityHours_window"');
    expect(flat).toContain('"closesMinute" > "opensMinute"');
    expect(flat).toContain('"closesMinute" <= 1800');
  });

  it("enforces one live review per resident per non-bookable amenity", () => {
    expect(flat).toContain('"AmenityReview_one_open_review_per_resident"');
    expect(flat).toContain(
      "WHERE \"bookingId\" IS NULL AND \"status\" = 'published'",
    );
  });
});

describe("indexes the product's reads depend on", () => {
  const REQUIRED = [
    // HOA catalog
    '"Amenity_communityId_status_name_idx"',
    // Manager calendar and resident's upcoming list
    '"AmenityBooking_communityId_status_startsAt_idx"',
    '"AmenityBooking_userId_startsAt_idx"',
    // Availability window lookups
    '"AmenityBooking_resourceId_blockStartsAt_idx"',
    '"AmenityClosure_amenityId_startsAt_endsAt_idx"',
    // Due reminders
    '"AmenityBooking_status_startsAt_idx"',
    // Open issue queue
    '"AmenityIssue_communityId_status_createdAt_idx"',
    // Paginated reviews
    '"AmenityReview_amenityId_status_createdAt_idx"',
  ];

  for (const index of REQUIRED) {
    it(`creates ${index}`, () => {
      expect(flat).toContain(index);
    });
  }
});

describe("safety of the migration itself", () => {
  it("is additive: it drops no pre-existing table or column", () => {
    // `DROP CONSTRAINT IF EXISTS` on the tables this migration itself creates
    // is a re-run guard and is expected. Nothing else may be dropped.
    const drops = migration
      .split("\n")
      .filter((line) => /^\s*(ALTER TABLE .*)?DROP (TABLE|COLUMN)/i.test(line));
    expect(drops).toEqual([]);
  });

  it("touches no marketplace table", () => {
    for (const table of [
      "HoaServiceRequest",
      "ServiceBid",
      "ServiceAgreement",
      "ServiceOccurrence",
      "ServiceVisit",
      "Review",
      "AdminAuditLog",
      "HoaProfile",
    ]) {
      // Foreign keys reference `Community`, `User`, and `CommunityUnit`; no
      // marketplace row is read, rewritten, or deleted.
      expect(migration).not.toMatch(
        new RegExp(`(UPDATE|DELETE FROM|ALTER TABLE)\\s+"${table}"`),
      );
    }
  });

  it("adds enum values without using them in the same transaction", () => {
    // PostgreSQL forbids using a new enum value in the transaction that adds
    // it. The values are added at the top and referenced only at runtime.
    expect(flat).toContain(
      "ALTER TYPE \"NotificationKind\" ADD VALUE IF NOT EXISTS 'booking'",
    );
    expect(flat).toContain(
      "ALTER TYPE \"AdminAuditAction\" ADD VALUE IF NOT EXISTS 'amenity_created'",
    );
    // No INSERT in this file may reference one of the new values.
    expect(migration).not.toMatch(/INSERT INTO "Notification"/);
  });

  it("carries an operational recovery note", () => {
    expect(migration).toContain("Operational recovery");
    expect(migration).toContain("DROP TABLE");
    expect(migration).toContain("amenity_booking_reminder");
  });

  it("is re-runnable, so a partially applied deploy can be retried", () => {
    const creates = migration.match(/CREATE TABLE (IF NOT EXISTS )?"/g) ?? [];
    expect(creates.length).toBeGreaterThan(0);
    expect(creates.every((statement) => statement.includes("IF NOT EXISTS"))).toBe(true);
  });

  it("is the newest migration, so it applies after the marketplace work", () => {
    const names = readdirSync(MIGRATIONS_DIR)
      .filter((entry) => /^\d{14}_/.test(entry))
      .sort();
    expect(names.at(-1)).toBe(MIGRATION_NAME);
  });
});

describe("schema and migration agree", () => {
  const MODELS = [
    "Amenity",
    "AmenityResource",
    "AmenityHours",
    "AmenityClosure",
    "AmenityBooking",
    "AmenityBookingEvent",
    "AmenityIssue",
    "AmenityIssueMessage",
    "AmenityIssueEvent",
    "AmenityReview",
    "AmenityReviewResponse",
    "MediaAsset",
  ];

  for (const model of MODELS) {
    it(`declares and creates ${model}`, () => {
      expect(schema).toMatch(new RegExp(`^model ${model} \\{`, "m"));
      expect(flat).toContain(`CREATE TABLE IF NOT EXISTS "${model}"`);
    });
  }

  it("keeps amenities out of the neighborhood workflow in the schema comment", () => {
    expect(schema).toContain("never populated for a `neighborhood` community");
  });
});
