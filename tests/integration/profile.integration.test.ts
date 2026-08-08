import { randomUUID } from "node:crypto";

import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";

/** Bundleen profile persistence against an isolated real Postgres database. */
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const suite = testDatabaseUrl ? describe : describe.skip;

if (!testDatabaseUrl) {
  console.warn("[integration] Skipping database tests: TEST_DATABASE_URL is not set.");
}

let db: PrismaClient;
const runId = randomUUID().slice(0, 8);
const emailFor = (label: string) => `itest-${runId}-${label}@example.com`;
const clerkIdFor = (label: string) => `user_itest_${runId}_${label}`;

suite("Clerk-backed profiles against a real database", () => {
  beforeAll(async () => {
    db = new PrismaClient({
      adapter: new PrismaPg({ connectionString: testDatabaseUrl as string }),
    });
  });

  afterAll(async () => {
    await db.user.deleteMany({ where: { email: { contains: `itest-${runId}-` } } });
    await db.$disconnect();
  });

  it.each(["homeowner", "provider"] as const)("creates a %s profile", async (role) => {
    const user = await db.user.create({
      data: {
        clerkUserId: clerkIdFor(role),
        email: emailFor(role),
        fullName: role === "homeowner" ? "Ada Lovelace" : "Grace Hopper",
        role,
      },
    });

    expect(user.id).toBeTruthy();
    expect(user.clerkUserId).toBe(clerkIdFor(role));
    expect(user.role).toBe(role);
    expect(user.isVerified).toBe(false);
  });

  it("enforces unique Clerk identity mapping", async () => {
    const clerkUserId = clerkIdFor("duplicate-clerk");
    await db.user.create({
      data: { clerkUserId, email: emailFor("clerk-a"), fullName: "Ada", role: "homeowner" },
    });

    await expect(
      db.user.create({
        data: { clerkUserId, email: emailFor("clerk-b"), fullName: "Grace", role: "provider" },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("enforces unique email mapping", async () => {
    const email = emailFor("duplicate-email");
    await db.user.create({
      data: {
        clerkUserId: clerkIdFor("email-a"),
        email,
        fullName: "Ada",
        role: "homeowner",
      },
    });

    await expect(
      db.user.create({
        data: {
          clerkUserId: clerkIdFor("email-b"),
          email,
          fullName: "Grace",
          role: "provider",
        },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("persists Clerk verification state", async () => {
    const user = await db.user.create({
      data: {
        clerkUserId: clerkIdFor("verified"),
        email: emailFor("verified"),
        fullName: "Ada Lovelace",
        role: "homeowner",
        isVerified: true,
      },
    });
    expect(user.isVerified).toBe(true);
  });
});
