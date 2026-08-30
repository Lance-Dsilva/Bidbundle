import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Every database object `createSupportTicket` touches has to be created by a
 * committed migration.
 *
 * The production 500 turned out to be an application bug rather than migration
 * drift, but ruling drift out cost real time because nothing asserted the link
 * between the code's requirements and the migration's contents. This closes
 * that gap: the ticket-number sequence in particular is drawn with raw SQL, so
 * a rename or a dropped `CREATE SEQUENCE` would be invisible to Prisma's own
 * schema checks and would only surface as a 500 in production.
 */

const ROOT = resolve(import.meta.dirname, "..");
const MIGRATIONS = resolve(ROOT, "prisma/migrations");

/** Every migration's SQL, concatenated in application order. */
const allMigrationSql = readdirSync(MIGRATIONS)
  .filter((entry) => entry !== "migration_lock.toml")
  .sort()
  .map((entry) => readFileSync(resolve(MIGRATIONS, entry, "migration.sql"), "utf8"))
  .join("\n");

const supportService = readFileSync(resolve(ROOT, "src/lib/server/support.ts"), "utf8");

describe("support migration completeness", () => {
  it("creates every table the ticket creation transaction writes", () => {
    for (const table of ["SupportTicket", "SupportTicketMessage", "SupportTicketEvent"]) {
      expect(allMigrationSql).toContain(`CREATE TABLE IF NOT EXISTS "${table}"`);
    }
  });

  it("creates the sequence the ticket number is drawn from", () => {
    // The name the code actually uses, read out of the code rather than
    // restated here, so a rename in one place fails this test.
    const used = supportService.match(/nextval\('([a-z_]+)'\)/)?.[1];
    expect(used).toBe("support_ticket_number_seq");
    expect(allMigrationSql).toContain(`CREATE SEQUENCE IF NOT EXISTS "${used}"`);
  });

  it("creates the enums the ticket columns are typed with", () => {
    for (const enumName of [
      "SupportTicketStatus",
      "SupportTicketPriority",
      "SupportTicketCategory",
      "SupportTicketMessageKind",
      "SupportTicketEventType",
    ]) {
      expect(allMigrationSql).toContain(`CREATE TYPE "${enumName}"`);
    }
  });

  it("creates the enum values the ticket is written with", () => {
    expect(allMigrationSql).toMatch(/CREATE TYPE "SupportTicketStatus"[^;]*'new'/);
    expect(allMigrationSql).toMatch(/CREATE TYPE "SupportTicketPriority"[^;]*'normal'/);
    expect(allMigrationSql).toMatch(
      /CREATE TYPE "SupportTicketMessageKind"[^;]*'customer_reply'/,
    );
    expect(allMigrationSql).toMatch(/CREATE TYPE "SupportTicketEventType"[^;]*'created'/);
  });

  it("creates the unique index the ticket number depends on", () => {
    expect(allMigrationSql).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS "SupportTicket_ticketNumber_key"',
    );
  });

  it("creates the notification and outbox tables the receipt is queued into", () => {
    expect(allMigrationSql).toMatch(/CREATE TABLE (IF NOT EXISTS )?"Notification"/);
    expect(allMigrationSql).toMatch(/CREATE TABLE (IF NOT EXISTS )?"OutboxEvent"/);
  });
});

describe("homeowner request migration completeness", () => {
  it("adds the budget columns the request writer sets", () => {
    expect(allMigrationSql).toContain('ADD COLUMN IF NOT EXISTS "budgetMinCents"');
    expect(allMigrationSql).toContain('ADD COLUMN IF NOT EXISTS "budgetMaxCents"');
  });

  it("constrains the budget range in the database, not only in Zod", () => {
    expect(allMigrationSql).toContain('"HoaServiceRequest_budget_bounds"');
    expect(allMigrationSql).toMatch(/"budgetMaxCents" >= "budgetMinCents"/);
  });

  it("indexes the owner column My Requests reads by", () => {
    expect(allMigrationSql).toContain(
      'CREATE INDEX IF NOT EXISTS "HoaServiceRequest_createdByUserId_createdAt_idx"',
    );
  });
});

describe("migration safety", () => {
  const latest = readFileSync(
    resolve(MIGRATIONS, "20260827090000_homeowner_individual_requests/migration.sql"),
    "utf8",
  );

  const statements = latest
    .split(";")
    .map((statement) => statement.replace(/--[^\n]*/g, "").trim())
    .filter(Boolean);

  it("guards every column and index against a re-run", () => {
    expect(statements.length).toBeGreaterThan(0);
    for (const statement of statements) {
      if (/^ALTER TABLE[\s\S]*ADD COLUMN/i.test(statement)) {
        expect(statement).toMatch(/ADD COLUMN IF NOT EXISTS/);
      }
      if (/^CREATE INDEX/i.test(statement)) {
        expect(statement).toMatch(/CREATE INDEX IF NOT EXISTS/);
      }
    }
  });

  it("drops each constraint before adding it, since Postgres has no ADD IF NOT EXISTS", () => {
    const added = [...latest.matchAll(/ADD CONSTRAINT "([^"]+)"/g)].map((m) => m[1]!);
    expect(added.length).toBeGreaterThan(0);
    for (const name of added) {
      const dropIndex = latest.indexOf(`DROP CONSTRAINT IF EXISTS "${name}"`);
      const addIndex = latest.indexOf(`ADD CONSTRAINT "${name}"`);
      expect(dropIndex, `${name} is added without a preceding guarded drop`).toBeGreaterThanOrEqual(0);
      expect(dropIndex).toBeLessThan(addIndex);
    }
  });

  it("adds a constraint that every pre-existing row already satisfies", () => {
    // Existing HOA-manager requests have both budget columns NULL. Each clause
    // is NULL-guarded and `(NULL IS NULL) = (NULL IS NULL)` is true, so the
    // ALTER validates without a table rewrite failure on live data.
    expect(latest).toMatch(/"budgetMinCents" IS NULL\) = \("budgetMaxCents" IS NULL/);
    expect(latest).toMatch(/"budgetMinCents" IS NULL OR/);
    expect(latest).toMatch(/"budgetMaxCents" IS NULL OR/);
  });
});
