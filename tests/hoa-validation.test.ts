import { describe, expect, it } from "vitest";

import {
  awardSchema,
  bidSubmitSchema,
  dayPlanSchema,
  hoaManagerInvitationCreateSchema,
  hoaProfileSchema,
  hoaRequestCreateSchema,
  hoaRequestTransitionSchema,
  hoaResidentInvitationCreateSchema,
  hoaSurveyCreateSchema,
  hoaSurveyStatusSchema,
  hoaSurveyVoteSchema,
  participationResponseSchema,
  reviewCreateSchema,
  serviceAreaSchema,
  unitCreateSchema,
  unitImportSchema,
  unitUpdateSchema,
  visitStatusSchema,
} from "@/lib/validation/hoa";

describe("HOA invitation validation", () => {
  it("normalizes a valid manager email and rejects extra authority fields", () => {
    expect(hoaManagerInvitationCreateSchema.parse({ email: "  MANAGER@Example.com " })).toEqual({
      email: "manager@example.com",
    });
    expect(
      hoaManagerInvitationCreateSchema.safeParse({
        email: "manager@example.com",
        communityId: "client-selected",
        role: "hoa_manager",
      }).success,
    ).toBe(false);
  });

  it("binds a resident invitation to a unit", () => {
    expect(
      hoaResidentInvitationCreateSchema.parse({
        email: "RESIDENT@example.com",
        unitId: "unit-1",
      }),
    ).toEqual({ email: "resident@example.com", unitId: "unit-1" });
    expect(
      hoaResidentInvitationCreateSchema.safeParse({ email: "resident@example.com" }).success,
    ).toBe(false);
  });
});

describe("HOA profile validation", () => {
  const base = {
    legalName: "Cedar Park Homes Association",
    addressLine1: "11800 Cedar Lane",
    locality: "Austin",
    region: "TX",
    postalCode: "78758",
    country: "US",
    timezone: "America/Chicago",
    totalHomes: 10,
  };

  it("accepts a complete profile", () => {
    expect(hoaProfileSchema.safeParse(base).success).toBe(true);
  });

  it("rejects a bogus timezone and half a coordinate pair", () => {
    expect(hoaProfileSchema.safeParse({ ...base, timezone: "Central" }).success).toBe(false);
    expect(hoaProfileSchema.safeParse({ ...base, latitude: 30.4 }).success).toBe(false);
    expect(
      hoaProfileSchema.safeParse({ ...base, latitude: 30.4, longitude: -97.7 }).success,
    ).toBe(true);
  });

  it("bounds the declared home count", () => {
    expect(hoaProfileSchema.safeParse({ ...base, totalHomes: 0 }).success).toBe(false);
    expect(hoaProfileSchema.safeParse({ ...base, totalHomes: 10_001 }).success).toBe(false);
  });
});

describe("unit validation", () => {
  it("requires a label and a complete coordinate pair", () => {
    expect(unitCreateSchema.safeParse({ label: "Home 14" }).success).toBe(true);
    expect(unitCreateSchema.safeParse({ label: "" }).success).toBe(false);
    expect(unitCreateSchema.safeParse({ label: "Home 14", latitude: 30.4 }).success).toBe(false);
  });

  it("accepts admin-safe occupancy transitions only", () => {
    expect(unitUpdateSchema.safeParse({ occupancyStatus: "inactive" }).success).toBe(true);
    expect(unitUpdateSchema.safeParse({ occupancyStatus: "haunted" }).success).toBe(false);
  });

  it("keeps imports explicit about the commit step", () => {
    const parsed = unitImportSchema.parse({ csv: "label\nHome 1" });
    expect(parsed.commit).toBe(false);
  });
});

describe("HOA request validation", () => {
  const compulsory = {
    title: "Biweekly gardening",
    category: "Gardening",
    description: "Front-yard maintenance for all homes.",
    kind: "compulsory_recurring" as const,
    recurrenceLabel: "Every two weeks",
    recurrenceIntervalDays: 14,
    totalOccurrences: 12,
    biddingClosesAt: "2026-09-01T00:00:00Z",
    publish: true,
  };

  it("requires recurrence details for compulsory requests", () => {
    expect(hoaRequestCreateSchema.safeParse(compulsory).success).toBe(true);
    expect(
      hoaRequestCreateSchema.safeParse({ ...compulsory, recurrenceLabel: null }).success,
    ).toBe(false);
    expect(
      hoaRequestCreateSchema.safeParse({ ...compulsory, recurrenceIntervalDays: null }).success,
    ).toBe(false);
  });

  it("requires a bidding deadline to publish a compulsory request", () => {
    expect(
      hoaRequestCreateSchema.safeParse({ ...compulsory, biddingClosesAt: null }).success,
    ).toBe(false);
    expect(
      hoaRequestCreateSchema.safeParse({
        ...compulsory,
        biddingClosesAt: null,
        publish: false,
      }).success,
    ).toBe(true);
  });

  it("requires an enrollment deadline to publish an optional request", () => {
    const optional = {
      title: "Pool cleaning",
      category: "Pool",
      description: "Optional shared pool service.",
      kind: "optional_group" as const,
      recurrenceLabel: null,
      publish: true,
    };
    expect(hoaRequestCreateSchema.safeParse(optional).success).toBe(false);
    expect(
      hoaRequestCreateSchema.safeParse({
        ...optional,
        enrollmentClosesAt: "2026-09-01T00:00:00Z",
      }).success,
    ).toBe(true);
  });

  it("rejects an inverted home range", () => {
    expect(
      hoaRequestCreateSchema.safeParse({
        ...compulsory,
        kind: "optional_group",
        publish: false,
        minHomes: 5,
        maxHomes: 3,
      }).success,
    ).toBe(false);
  });

  it("allows only named lifecycle actions, never raw status strings", () => {
    expect(hoaRequestTransitionSchema.safeParse({ action: "close_bidding" }).success).toBe(true);
    expect(hoaRequestTransitionSchema.safeParse({ action: "awarded" }).success).toBe(false);
    expect(hoaRequestTransitionSchema.safeParse({ status: "completed" }).success).toBe(false);
  });

  it("accepts only join or decline responses", () => {
    expect(participationResponseSchema.safeParse({ response: "joined" }).success).toBe(true);
    expect(participationResponseSchema.safeParse({ response: "maybe" }).success).toBe(false);
  });
});

describe("service area validation", () => {
  it("requires a full circle or postal codes", () => {
    expect(
      serviceAreaSchema.safeParse({
        label: "North Austin",
        centerLatitude: 30.4,
        centerLongitude: -97.7,
        radiusMiles: 15,
      }).success,
    ).toBe(true);
    expect(
      serviceAreaSchema.safeParse({ label: "Postal only", postalCodes: ["78758"] }).success,
    ).toBe(true);
    expect(serviceAreaSchema.safeParse({ label: "Nothing" }).success).toBe(false);
    expect(
      serviceAreaSchema.safeParse({
        label: "Half circle",
        centerLatitude: 30.4,
        postalCodes: ["78758"],
      }).success,
    ).toBe(false);
  });
});

describe("bid validation", () => {
  const bid = {
    amountCents: 45_000,
    pricingBasis: "per_visit" as const,
    scope: "Mow, edge, and blow all front yards.",
  };

  it("accepts a well-formed bid in integer cents", () => {
    expect(bidSubmitSchema.safeParse(bid).success).toBe(true);
  });

  it("rejects negative and fractional money", () => {
    expect(bidSubmitSchema.safeParse({ ...bid, amountCents: -1 }).success).toBe(false);
    expect(bidSubmitSchema.safeParse({ ...bid, amountCents: 45.5 }).success).toBe(false);
  });

  it("rejects unknown fields on the award body", () => {
    expect(awardSchema.safeParse({ bidId: "bid-1" }).success).toBe(true);
    expect(awardSchema.safeParse({ bidId: "bid-1", force: true }).success).toBe(false);
  });
});

describe("day plan validation", () => {
  it("requires distinct ranks and distinct visits", () => {
    expect(
      dayPlanSchema.safeParse({
        stops: [
          { visitId: "v1", stopRank: 1 },
          { visitId: "v2", stopRank: 2 },
        ],
        publish: true,
      }).success,
    ).toBe(true);
    expect(
      dayPlanSchema.safeParse({
        stops: [
          { visitId: "v1", stopRank: 1 },
          { visitId: "v2", stopRank: 1 },
        ],
      }).success,
    ).toBe(false);
    expect(
      dayPlanSchema.safeParse({
        stops: [
          { visitId: "v1", stopRank: 1 },
          { visitId: "v1", stopRank: 2 },
        ],
      }).success,
    ).toBe(false);
  });

  it("validates HH:MM windows", () => {
    expect(
      dayPlanSchema.safeParse({
        stops: [{ visitId: "v1", stopRank: 1, windowStart: "09:00", windowEnd: "10:30" }],
      }).success,
    ).toBe(true);
    expect(
      dayPlanSchema.safeParse({
        stops: [{ visitId: "v1", stopRank: 1, windowStart: "9am" }],
      }).success,
    ).toBe(false);
  });
});

describe("visit status validation", () => {
  it("accepts provider work states only", () => {
    expect(visitStatusSchema.safeParse({ status: "completed" }).success).toBe(true);
    expect(visitStatusSchema.safeParse({ status: "scheduled" }).success).toBe(false);
    expect(visitStatusSchema.safeParse({ status: "unscheduled" }).success).toBe(false);
  });
});

describe("review validation", () => {
  it("bounds the rating and requires a comment", () => {
    expect(reviewCreateSchema.safeParse({ rating: 5, comment: "Great work" }).success).toBe(true);
    expect(reviewCreateSchema.safeParse({ rating: 0, comment: "Bad bounds" }).success).toBe(false);
    expect(reviewCreateSchema.safeParse({ rating: 6, comment: "Bad bounds" }).success).toBe(false);
    expect(reviewCreateSchema.safeParse({ rating: 4, comment: "" }).success).toBe(false);
  });
});

describe("HOA survey validation", () => {
  it("accepts one bounded monthly survey and unique options", () => {
    expect(
      hoaSurveyCreateSchema.safeParse({
        monthKey: "2026-08",
        question: "Which service should we bundle?",
        options: ["Pool cleaning", "Pest control"],
        status: "open",
      }).success,
    ).toBe(true);
    expect(
      hoaSurveyCreateSchema.safeParse({
        monthKey: "August",
        question: "Which service?",
        options: ["Pool", "pool"],
        status: "open",
      }).success,
    ).toBe(false);
  });

  it("only accepts bounded integer option indexes", () => {
    expect(hoaSurveyVoteSchema.safeParse({ optionIndex: 0 }).success).toBe(true);
    expect(hoaSurveyVoteSchema.safeParse({ optionIndex: -1 }).success).toBe(false);
    expect(hoaSurveyVoteSchema.safeParse({ optionIndex: 1.5 }).success).toBe(false);
  });

  it("allows surveys to be opened or closed only", () => {
    expect(hoaSurveyStatusSchema.safeParse({ status: "closed" }).success).toBe(true);
    expect(hoaSurveyStatusSchema.safeParse({ status: "cancelled" }).success).toBe(false);
  });
});
