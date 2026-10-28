import { randomUUID } from "node:crypto";

import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";

// Opt-in only: the normal integration configuration requires isolated resources.
// These exercise the deployed trigger, not a scripted Prisma substitute.
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const suite = testDatabaseUrl ? describe : describe.skip;
let db: PrismaClient;
const runId = randomUUID();
const userIds: string[] = [];
const communityIds: string[] = [];
let residentId: string;
let outsiderId: string;
let neighborhoodId: string;
let otherNeighborhoodId: string;

suite("neighborhood participation database guards", () => {
  beforeAll(async () => {
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: testDatabaseUrl as string }) });
    for (const label of ["resident", "outsider"]) {
      const user = await db.user.create({ data: { clerkUserId: `itest-${runId}-${label}`, email: `itest-${runId}-${label}@example.test`, fullName: "Integration Resident", role: "homeowner" } });
      userIds.push(user.id);
    }
    [residentId, outsiderId] = userIds;
    for (const label of ["home", "other"]) {
      const community = await db.community.create({ data: { name: `itest-${runId}-${label}`, type: "neighborhood", centerLatitude: 30.4, centerLongitude: -97.72, radiusMiles: 2 } });
      communityIds.push(community.id);
    }
    [neighborhoodId, otherNeighborhoodId] = communityIds;
    await db.communityMembership.createMany({ data: [
      { communityId: neighborhoodId, userId: residentId, status: "active", isAdminOverride: true },
      { communityId: otherNeighborhoodId, userId: outsiderId, status: "active", isAdminOverride: true },
    ] });
  });

  afterAll(async () => {
    if (!db) return;
    await db.hoaServiceRequest.deleteMany({ where: { communityId: { in: communityIds } } });
    await db.communityMembership.deleteMany({ where: { communityId: { in: communityIds } } });
    await db.community.deleteMany({ where: { id: { in: communityIds } } });
    await db.user.deleteMany({ where: { id: { in: userIds } } });
    await db.$disconnect();
  });

  async function request(overrides: { status?: "collecting_interest" | "open_for_bids"; participantsLockedAt?: Date; enrollmentClosesAt?: Date } = {}) {
    return db.hoaServiceRequest.create({ data: {
      communityId: neighborhoodId, createdByUserId: residentId, title: "Integration cleaning", category: "cleaning", description: "Isolated trigger regression", kind: "optional_group", status: "collecting_interest", minHomes: 1,
      enrollmentClosesAt: new Date(Date.now() + 86_400_000), ...overrides,
    } });
  }

  it("accepts an active neighborhood homeowner without an HOA unit and allows changing their answer", async () => {
    const job = await request();
    const participation = await db.hoaRequestParticipation.create({ data: { requestId: job.id, userId: residentId, unitId: null, response: "joined" } });
    await expect(db.hoaRequestParticipation.update({ where: { id: participation.id }, data: { response: "declined" } })).resolves.toMatchObject({ response: "declined", unitId: null });
  });

  it("refuses a homeowner whose only active membership belongs to another neighborhood", async () => {
    const job = await request();
    await expect(db.hoaRequestParticipation.create({ data: { requestId: job.id, userId: outsiderId, unitId: null, response: "joined" } })).rejects.toThrow();
  });

  it.each(["locked", "closed", "elapsed"] as const)("refuses new participation after enrollment is %s", async (condition) => {
    const job = await request(condition === "locked" ? { participantsLockedAt: new Date() } : condition === "closed" ? { status: "open_for_bids" } : { enrollmentClosesAt: new Date(Date.now() - 1000) });
    await expect(db.hoaRequestParticipation.create({ data: { requestId: job.id, userId: residentId, unitId: null, response: "joined" } })).rejects.toThrow();
  });
});
