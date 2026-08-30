import { describe, expect, it } from "vitest";

import {
  serializeOccurrenceForManager,
  serializeOccurrenceForViewer,
  serializeVisitForViewer,
  type VisitViewRow,
} from "@/lib/server/visit-views";

/**
 * The one place a service stop becomes something a client can see.
 *
 * These tests are the privacy boundary written down: who receives an exact
 * address, who receives coordinates, who receives a gate code, and who
 * receives only a label and a schedule. Both target kinds are covered, because
 * the whole point of generalizing `ServiceVisit` was that an HOA unit stop and
 * a neighbourhood homeowner stop must be redacted by the same rule.
 */

function unitVisit(overrides: Partial<VisitViewRow> = {}): VisitViewRow {
  return {
    id: "visit-unit",
    occurrenceId: "occurrence-1",
    unitId: "unit-1",
    homeownerUserId: null,
    serviceLabel: null,
    serviceAddressLine1: null,
    serviceLatitude: null,
    serviceLongitude: null,
    serviceAccessNotes: null,
    stopRank: 1,
    scheduledDate: new Date("2026-09-01T00:00:00Z"),
    windowStart: "09:00",
    windowEnd: "11:00",
    estimatedMinutes: 45,
    status: "scheduled",
    completionNote: null,
    completedAt: null,
    unit: {
      label: "Home 14",
      latitude: 30.4021,
      longitude: -97.7266,
      addressLine1: "11814 Cedar Lane",
      accessNotes: "Gate code 4417",
    },
    homeowner: null,
    ...overrides,
  };
}

function homeownerVisit(overrides: Partial<VisitViewRow> = {}): VisitViewRow {
  return {
    id: "visit-homeowner",
    occurrenceId: "occurrence-1",
    unitId: null,
    homeownerUserId: "resident-a",
    serviceLabel: "11800 Cedar Lane",
    serviceAddressLine1: "11800 Cedar Lane",
    serviceLatitude: 30.4,
    serviceLongitude: -97.72,
    serviceAccessNotes: "Dog in the yard",
    stopRank: 2,
    scheduledDate: new Date("2026-09-01T00:00:00Z"),
    windowStart: "11:00",
    windowEnd: "13:00",
    estimatedMinutes: 30,
    status: "scheduled",
    completionNote: null,
    completedAt: null,
    unit: null,
    homeowner: { fullName: "Alex Resident" },
    ...overrides,
  };
}

describe("target kinds", () => {
  it("labels an HOA stop from the unit inventory", () => {
    const view = serializeVisitForViewer(unitVisit(), true);
    expect(view).toMatchObject({
      targetKind: "unit",
      unitId: "unit-1",
      homeownerUserId: null,
      stopLabel: "Home 14",
    });
  });

  it("labels a neighbourhood stop from its immutable snapshot", () => {
    const view = serializeVisitForViewer(homeownerVisit(), true);
    expect(view).toMatchObject({
      targetKind: "homeowner",
      unitId: null,
      homeownerUserId: "resident-a",
      stopLabel: "11800 Cedar Lane",
      addressLine1: "11800 Cedar Lane",
      latitude: 30.4,
      longitude: -97.72,
    });
  });

  it("falls back to the resident's name only when the snapshot has no label", () => {
    const view = serializeVisitForViewer(
      homeownerVisit({ serviceLabel: null, serviceAddressLine1: null }),
      true,
    );
    expect(view.stopLabel).toBe("Alex Resident");
  });
});

describe("redaction", () => {
  it.each([
    ["an HOA unit stop", unitVisit()],
    ["a neighbourhood stop", homeownerVisit()],
  ])("withholds every location field from an unauthorized viewer: %s", (_label, row) => {
    const view = serializeVisitForViewer(row, false);

    expect(view.latitude).toBeNull();
    expect(view.longitude).toBeNull();
    expect(view.addressLine1).toBeNull();
    expect(view.accessNotes).toBeNull();
    // The label is location data too: a unit label and a snapshot label are
    // both routinely street addresses, so a redacted view gets neither.
    expect(view.stopLabel).toMatch(/^Stop \d+$/);
    // The schedule itself is not private: a group can be told a stop exists
    // and when, without being told where.
    expect(view.status).toBe("scheduled");
    expect(view.windowStart).not.toBeNull();
  });

  it("withholds access notes from someone allowed to see the address", () => {
    const view = serializeVisitForViewer(homeownerVisit(), true);
    expect(view.addressLine1).toBe("11800 Cedar Lane");
    // Routing a crew does not require a gate code; only the crew gets that.
    expect(view.accessNotes).toBeNull();
  });

  it("gives the awarded provider the access notes they need to do the work", () => {
    const view = serializeVisitForViewer(homeownerVisit(), true, { includeAccessNotes: true });
    expect(view.accessNotes).toBe("Dog in the yard");

    const hoaView = serializeVisitForViewer(unitVisit(), true, { includeAccessNotes: true });
    expect(hoaView.accessNotes).toBe("Gate code 4417");
  });

  it("leaves no coordinate anywhere in a redacted payload", () => {
    const serialized = JSON.stringify(serializeVisitForViewer(homeownerVisit(), false));
    expect(serialized).not.toContain("30.4");
    expect(serialized).not.toContain("-97.72");
    expect(serialized).not.toContain("Cedar Lane");
  });
});

describe("occurrence views", () => {
  const occurrence = {
    id: "occurrence-1",
    agreementId: "agreement-1",
    sequence: 1,
    serviceDate: new Date("2026-09-01T00:00:00Z"),
    status: "planned" as const,
    schedulePublishedAt: new Date("2026-08-30T00:00:00Z"),
    // Deliberately out of order: publishing decides the route, not the read.
    visits: [homeownerVisit(), unitVisit()],
  };

  it("orders stops by the provider's published rank", () => {
    const view = serializeOccurrenceForViewer(occurrence, true);
    expect(view.visits.map((visit) => visit.stopRank)).toEqual([1, 2]);
  });

  it("gives a scoped manager the stops but never the private access notes", () => {
    const view = serializeOccurrenceForManager(occurrence);

    expect(view.visits).toHaveLength(2);
    for (const visit of view.visits) {
      // A manager coordinates the day, so they see where the stops are…
      expect(visit.addressLine1).not.toBeNull();
      expect(visit.status).toBe("scheduled");
      // …but a gate code stays between the resident and the crew.
      expect(visit.accessNotes).toBeNull();
    }
  });

  it("gives the awarded provider the whole plan with stops and notes", () => {
    const view = serializeOccurrenceForViewer(occurrence, true, { includeAccessNotes: true });
    expect(view.visits.every((visit) => visit.latitude !== null)).toBe(true);
    expect(view.visits.every((visit) => visit.accessNotes !== null)).toBe(true);
  });
});
