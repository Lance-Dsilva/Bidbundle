import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Contract-level guards for the marketplace.
 *
 * Two failures this catches that a unit test cannot:
 *
 *  1. **A client calling a path with no Route Handler.** The provider Job Feed,
 *     My Bids, Schedule, Earnings, and the neighbourhood panel all did exactly
 *     that: `/api/provider/job-feed`, `/api/provider/bids`, `/provider/schedule`,
 *     `/provider/earnings`, `/homeowner/bids`, `/neighbourhood/requests`, and
 *     `/bids/{id}/accept` were fetched by hooks and served by nothing. Every
 *     one produced an error the customer could do nothing about.
 *
 *  2. **A migration that drops an invariant.** The exactly-one-target rule and
 *     the snapshot requirement are what make a `ServiceVisit` safe to
 *     generalize; without them a nullable `unitId` is a bug, not a feature.
 */

const ROOT = resolve(import.meta.dirname, "..");

function read(relativePath: string): string {
  return readFileSync(resolve(ROOT, relativePath), "utf8");
}

/** Every file under a directory, recursively. */
function walk(directory: string): string[] {
  const entries = readdirSync(directory);
  return entries.flatMap((entry) => {
    const full = join(directory, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

/* ── Legacy endpoints ────────────────────────────────────────────────────── */

/**
 * Paths that had callers but no handler. Each is checked as a whole path
 * segment so an unrelated identifier cannot mask a real regression.
 */
const REMOVED_LEGACY_PATHS = [
  "/provider/job-feed",
  "/provider/bids",
  "/provider/schedule",
  "/provider/earnings",
  "/homeowner/bids/accept",
  "/neighbourhood/requests",
  "/api/provider/job-feed",
  "/api/provider/bids",
  "/api/requests/",
] as const;

describe("no client calls a nonexistent endpoint", () => {
  /**
   * Comments are stripped before scanning. Several of these modules explain in
   * prose which dead path they replaced, and a doc comment naming an endpoint
   * is documentation, not a call.
   */
  const withoutComments = (source: string) =>
    source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  const clientSources = walk(resolve(ROOT, "src/hooks"))
    .concat(walk(resolve(ROOT, "src/components/provider")))
    .concat(walk(resolve(ROOT, "src/components/homeowner")))
    .filter((path) => path.endsWith(".ts") || path.endsWith(".tsx"))
    .map((path) => ({ path, source: withoutComments(readFileSync(path, "utf8")) }));

  it.each(REMOVED_LEGACY_PATHS)("nothing fetches %s any more", (legacyPath) => {
    const offenders = clientSources
      .filter(({ source }) => source.includes(`"${legacyPath}`) || source.includes(`\`${legacyPath}`))
      .map(({ path }) => path.replace(`${ROOT}/`, ""));

    expect(offenders).toEqual([]);
  });

  it("removed the hooks that only existed to call them", () => {
    for (const dead of [
      "src/hooks/useProviderJobFeed.ts",
      "src/hooks/useProviderBids.ts",
      "src/hooks/useProviderSchedule.ts",
      "src/hooks/useNeighbourhoodRequests.ts",
    ]) {
      expect(existsSync(resolve(ROOT, dead))).toBe(false);
    }
  });

  it("leaves one provider surface per job, not an HOA-only duplicate", () => {
    // `/app/provider/hoa` showed a feed titled "HOA jobs" that had begun
    // returning neighbourhood work too. It redirects to the real feed now.
    const retired = read("src/app/app/provider/hoa/page.tsx");
    expect(retired).toContain("redirect(\"/app/provider/job-feed\")");
    expect(existsSync(resolve(ROOT, "src/components/provider/ProviderHoaWorkspace.tsx"))).toBe(
      false,
    );

    const nav = read("src/components/layout/ProviderShell.tsx");
    expect(nav).not.toContain("/app/provider/hoa");
  });
});

/* ── Canonical routes exist ──────────────────────────────────────────────── */

const REQUIRED_ROUTES = [
  // Provider marketplace: one feed, one bid contract, one schedule.
  "src/app/api/provider/marketplace/route.ts",
  "src/app/api/provider/marketplace/requests/[requestId]/bid/route.ts",
  "src/app/api/provider/marketplace/occurrences/[occurrenceId]/plan/route.ts",
  "src/app/api/provider/marketplace/visits/[visitId]/status/route.ts",
  "src/app/api/provider/marketplace/earnings/route.ts",
  // Homeowner neighbourhood: hub, participation, lifecycle, award, quotes.
  "src/app/api/homeowner/neighbourhood/route.ts",
  "src/app/api/homeowner/requests/route.ts",
  "src/app/api/homeowner/requests/[requestId]/route.ts",
  "src/app/api/homeowner/requests/[requestId]/participation/route.ts",
  "src/app/api/homeowner/requests/[requestId]/transition/route.ts",
  "src/app/api/homeowner/requests/[requestId]/award/route.ts",
  "src/app/api/homeowner/bids/route.ts",
  // Admin address verification.
  "src/app/api/admin/geocode/route.ts",
] as const;

describe("canonical routes", () => {
  it.each(REQUIRED_ROUTES)("%s is a real Route Handler", (path) => {
    expect(existsSync(resolve(ROOT, path))).toBe(true);
    const source = read(path);
    expect(source).toMatch(/export (async )?function (GET|POST|PUT|PATCH|DELETE)/);
  });

  it("every marketplace mutation authorizes before it acts", () => {
    const mutations = REQUIRED_ROUTES.filter((path) =>
      /participation|transition|award|bid\/route|status\/route|plan\/route|geocode/.test(path),
    );

    for (const path of mutations) {
      const source = read(path);
      // A gate, and a rate limiter behind it: both come from the shared
      // `require*Mutation` helpers rather than being re-implemented per route.
      expect(source).toMatch(/require(HoaMutation|ProviderMutation|AdminMutation)/);
    }
  });
});

/* ── Migration invariants ────────────────────────────────────────────────── */

describe("the shared-lifecycle migration", () => {
  const migration = read(
    "prisma/migrations/20260829090000_shared_marketplace_and_address_verification/migration.sql",
  );

  it("makes unitId nullable only alongside an exactly-one-target CHECK", () => {
    expect(migration).toContain('ALTER COLUMN "unitId" DROP NOT NULL');
    expect(migration).toContain('CONSTRAINT "ServiceVisit_one_target" CHECK');
    expect(migration).toMatch(/\("unitId" IS NOT NULL\)::int \+ \("homeownerUserId" IS NOT NULL\)::int\) = 1/);
  });

  it("requires a routeable snapshot on every homeowner stop", () => {
    expect(migration).toContain('CONSTRAINT "ServiceVisit_homeowner_snapshot" CHECK');
    expect(migration).toContain('"serviceLatitude" IS NOT NULL');
    expect(migration).toContain('"serviceLongitude" IS NOT NULL');
  });

  it("keeps one stop per home per service day for both target kinds", () => {
    expect(migration).toContain('"ServiceVisit_occurrenceId_homeownerUserId_key"');
  });

  it("refuses to call an HOA verified without coordinates", () => {
    expect(migration).toContain('CONSTRAINT "HoaProfile_verified_has_coordinates" CHECK');
  });

  it("preserves existing HOA data: no DELETE or DROP TABLE", () => {
    // Comments describing the reversal are allowed; executable statements are
    // not. Strip comment lines before checking.
    const executable = migration
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n");

    expect(executable).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(executable).not.toMatch(/\bDROP\s+TABLE\b/i);
    expect(executable).not.toMatch(/\bTRUNCATE\b/i);
  });

  it("backfills existing rows rather than resetting them", () => {
    // An HOA that already has coordinates stays live.
    expect(migration).toMatch(/UPDATE "HoaProfile"[\s\S]*'verified'/);
    expect(migration).toContain('WHERE "latitude" IS NOT NULL');
  });

  it("adds the feed and schedule indexes the new reads need", () => {
    expect(migration).toContain('"HoaServiceRequest_status_biddingClosesAt_idx"');
    expect(migration).toContain('"ServiceVisit_status_scheduledDate_idx"');
  });

  it("carries an operational recovery note", () => {
    expect(migration).toContain("Operational recovery");
  });
});

/* ── Schema invariants ───────────────────────────────────────────────────── */

describe("the Prisma schema matches the migration", () => {
  const schema = read("prisma/schema.prisma");

  it("declares both visit targets as nullable relations", () => {
    expect(schema).toMatch(/unitId\s+String\?/);
    expect(schema).toMatch(/homeownerUserId\s+String\?/);
  });

  it("keeps the service-location snapshot columns", () => {
    for (const column of [
      "serviceAddressLine1",
      "serviceLatitude",
      "serviceLongitude",
      "serviceAccessNotes",
    ]) {
      expect(schema).toContain(column);
    }
  });

  it("keeps HOA coordinates as internal columns, not admin input", () => {
    // They still exist — matching, maps, distance, and routing all read them.
    expect(schema).toMatch(/model HoaProfile[\s\S]*latitude\s+Float\?/);
    // But the admin schema refuses to accept them.
    const validation = read("src/lib/validation/hoa.ts");
    expect(validation).not.toMatch(/latitude: z\.union\(\[latitudeField, z\.null\(\)\]\)/);
  });
});
