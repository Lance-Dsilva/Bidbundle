import { randomUUID } from "node:crypto";

import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";

/**
 * The community rules the *database* enforces, against a real Postgres.
 *
 * The service layer checks all of these too, and the unit suite covers that.
 * What only a real database can show is that the partial unique indexes, CHECK
 * constraints, and the append-only trigger from
 * `20260812120000_community_roles_admin_portal` actually exist and hold — the
 * layer that has to survive a bug in the service, a manual query, or two
 * admins acting in the same instant.
 */
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const suite = testDatabaseUrl ? describe : describe.skip;

if (!testDatabaseUrl) {
  console.warn("[integration] Skipping community tests: TEST_DATABASE_URL is not set.");
}

let db: PrismaClient;
const runId = randomUUID().slice(0, 8);
const nameFor = (label: string) => `itest-${runId}-${label}`;

suite("community constraints against a real database", () => {
  let neighborhoodId: string;
  let hoaId: string;
  let alphaId: string;
  let betaId: string;

  beforeAll(async () => {
    db = new PrismaClient({
      adapter: new PrismaPg({ connectionString: testDatabaseUrl as string }),
    });

    const neighborhood = await db.community.create({
      data: {
        name: nameFor("neighborhood"),
        type: "neighborhood",
        centerLatitude: 37.7749,
        centerLongitude: -122.4194,
        radiusMiles: 4,
      },
    });
    neighborhoodId = neighborhood.id;
    const hoa = await db.community.create({ data: { name: nameFor("hoa-staff"), type: "hoa" } });
    hoaId = hoa.id;

    const [alpha, beta] = await Promise.all([
      db.user.create({
        data: {
          clerkUserId: `user_itest_${runId}_alpha`,
          email: `itest-${runId}-alpha@example.com`,
          fullName: "Alpha Resident",
        },
      }),
      db.user.create({
        data: {
          clerkUserId: `user_itest_${runId}_beta`,
          email: `itest-${runId}-beta@example.com`,
          fullName: "Beta Resident",
        },
      }),
    ]);
    alphaId = alpha.id;
    betaId = beta.id;

    await db.communityMembership.createMany({
      data: [
        { communityId: neighborhoodId, userId: alphaId, status: "active" },
        { communityId: neighborhoodId, userId: betaId, status: "active" },
      ],
    });
  });

  afterAll(async () => {
    // The trigger that makes these tests meaningful also blocks the cleanup,
    // so it is disabled for exactly the length of the delete. Nothing in the
    // application ever does this.
    await db.$executeRawUnsafe(
      `ALTER TABLE "AdminAuditLog" DISABLE TRIGGER "AdminAuditLog_append_only"`,
    );
    await db.$executeRawUnsafe(
      `ALTER TABLE "AdminAuditLog" DISABLE TRIGGER "AdminAuditLog_no_truncate"`,
    );
    await db.adminAuditLog.deleteMany({ where: { actorUserId: { in: [alphaId, betaId] } } });
    await db.$executeRawUnsafe(
      `ALTER TABLE "AdminAuditLog" ENABLE TRIGGER "AdminAuditLog_append_only"`,
    );

    await db.$executeRawUnsafe(
      `ALTER TABLE "AdminAuditLog" ENABLE TRIGGER "AdminAuditLog_no_truncate"`,
    );

    await db.communityStaffAssignment.deleteMany({
      where: { community: { name: { startsWith: `itest-${runId}-` } } },
    });
    await db.community.deleteMany({ where: { name: { startsWith: `itest-${runId}-` } } });
    await db.user.deleteMany({ where: { email: { contains: `itest-${runId}-` } } });
    await db.$disconnect();
  });

  it("rejects a neighborhood with no centre point or radius", async () => {
    await expect(
      db.community.create({ data: { name: nameFor("no-geometry"), type: "neighborhood" } }),
    ).rejects.toThrow();
  });

  it("rejects an implausible radius", async () => {
    await expect(
      db.community.create({
        data: {
          name: nameFor("huge-radius"),
          type: "neighborhood",
          centerLatitude: 1,
          centerLongitude: 1,
          radiusMiles: 500,
        },
      }),
    ).rejects.toThrow();
  });

  it("accepts an HOA with no geometry at all", async () => {
    const hoa = await db.community.create({ data: { name: nameFor("hoa"), type: "hoa" } });
    expect(hoa.radiusMiles).toBeNull();
    expect(hoa.centerLatitude).toBeNull();
  });

  it("permits at most one active neighborhood manager, and allows a clean handover", async () => {
    const first = await db.communityStaffAssignment.create({
      data: { communityId: neighborhoodId, userId: alphaId, role: "neighborhood_manager" },
    });

    // A second appointment while the first is active is the race the partial
    // unique index exists to lose.
    await expect(
      db.communityStaffAssignment.create({
        data: { communityId: neighborhoodId, userId: betaId, role: "neighborhood_manager" },
      }),
    ).rejects.toThrow();

    // The same person cannot hold the same active role twice either.
    await expect(
      db.communityStaffAssignment.create({
        data: { communityId: neighborhoodId, userId: alphaId, role: "neighborhood_manager" },
      }),
    ).rejects.toThrow();

    await db.communityStaffAssignment.update({
      where: { id: first.id },
      data: { status: "revoked", revokedAt: new Date() },
    });

    const successor = await db.communityStaffAssignment.create({
      data: { communityId: neighborhoodId, userId: betaId, role: "neighborhood_manager" },
    });
    expect(successor.userId).toBe(betaId);
  });

  it("permits only one active HOA manager while allowing multiple HOA team members", async () => {
    await db.communityStaffAssignment.create({
      data: { communityId: hoaId, userId: alphaId, role: "hoa_manager" },
    });
    await expect(
      db.communityStaffAssignment.create({
        data: { communityId: hoaId, userId: betaId, role: "hoa_manager" },
      }),
    ).rejects.toThrow();

    await db.communityStaffAssignment.createMany({
      data: [
        { communityId: hoaId, userId: alphaId, role: "hoa_team" },
        { communityId: hoaId, userId: betaId, role: "hoa_team" },
      ],
    });
  });

  it("refuses a revoked assignment that does not say when it was revoked", async () => {
    const assignment = await db.communityStaffAssignment.findFirstOrThrow({
      where: { communityId: hoaId, userId: alphaId, role: "hoa_team", status: "active" },
    });

    await expect(
      db.communityStaffAssignment.update({
        where: { id: assignment.id },
        data: { status: "revoked" },
      }),
    ).rejects.toThrow();
  });

  it("keeps one membership per person per community", async () => {
    await expect(
      db.communityMembership.create({
        data: { communityId: neighborhoodId, userId: alphaId, status: "pending" },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("makes the audit log append-only", async () => {
    const entry = await db.adminAuditLog.create({
      data: {
        actorUserId: alphaId,
        action: "staff_assigned",
        targetType: "staff_assignment",
        targetId: "whatever",
        communityId: neighborhoodId,
        metadata: { role: "neighborhood_manager" },
      },
    });

    await expect(
      db.adminAuditLog.update({ where: { id: entry.id }, data: { action: "community_created" } }),
    ).rejects.toThrow();

    await expect(db.adminAuditLog.delete({ where: { id: entry.id } })).rejects.toThrow();

    await expect(
      db.$executeRawUnsafe(`TRUNCATE TABLE "AdminAuditLog"`),
    ).rejects.toThrow();

    // And the actor cannot be deleted out from under their own history.
    await expect(db.user.delete({ where: { id: alphaId } })).rejects.toThrow();
  });
});
