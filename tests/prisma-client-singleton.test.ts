import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The regression test for the production support-ticket outage.
 *
 * `lib/server/db.ts` exports a proxy that resolves the Prisma client on *every*
 * property access. It used to skip its cache when `NODE_ENV === "production"`,
 * so `db.supportTicket`, `db.supportTicketMessage`, and `db.$transaction` were
 * three separate clients with three separate connection pools — in production
 * only, which is why nothing caught it locally.
 *
 * Prisma's batch `$transaction([...])` is only atomic when every promise in the
 * array came from the client running the batch. With one client per access the
 * statements executed independently and concurrently: the parent `SupportTicket`
 * insert committed on its own connection while the child message and event
 * inserts raced it and died on `SupportTicketEvent_ticketId_fkey`. Production
 * was left with orphaned tickets holding zero messages, and the customer got a
 * 500.
 *
 * These tests assert the invariant that prevents it: **one construction, no
 * matter how many properties are read or which environment it runs in.**
 */

const constructed = vi.hoisted(() => ({ count: 0 }));

vi.mock("@/generated/prisma/client", () => ({
  PrismaClient: class {
    constructor() {
      constructed.count += 1;
    }
    supportTicket = { name: "supportTicket" };
    supportTicketMessage = { name: "supportTicketMessage" };
    supportTicketEvent = { name: "supportTicketEvent" };
    hoaServiceRequest = { name: "hoaServiceRequest" };
    $transaction = () => Promise.resolve([]);
    $queryRaw = () => Promise.resolve([]);
  },
}));

vi.mock("@prisma/adapter-pg", () => ({
  PrismaPg: class {
    constructor(public options: unknown) {}
  },
}));

const globalForPrisma = globalThis as unknown as { prisma?: unknown };

/**
 * `process.env.NODE_ENV` is typed read-only by `@types/node`, but the value is
 * exactly what this test varies, so it is written through a widened view.
 */
const env = process.env as Record<string, string | undefined>;

const originalNodeEnv = process.env.NODE_ENV;
const originalDatabaseUrl = process.env.DATABASE_URL;

beforeEach(() => {
  constructed.count = 0;
  delete globalForPrisma.prisma;
  vi.resetModules();
  process.env.DATABASE_URL = "postgresql://user:pw@localhost:5432/test";
});

afterEach(() => {
  delete globalForPrisma.prisma;
  env.NODE_ENV = originalNodeEnv;
  if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDatabaseUrl;
});

describe.each(["production", "development", "test"] as const)(
  "the Prisma client in NODE_ENV=%s",
  (nodeEnv) => {
    it("is constructed exactly once no matter how many properties are read", async () => {
      env.NODE_ENV = nodeEnv;
      const { db } = await import("@/lib/server/db");

      // The exact access pattern `createSupportTicket` uses.
      void db.$queryRaw;
      void db.supportTicket;
      void db.supportTicketMessage;
      void db.supportTicketEvent;
      void db.$transaction;
      void db.supportTicket;

      expect(constructed.count).toBe(1);
    });

    it("hands every delegate out from the same underlying client", async () => {
      env.NODE_ENV = nodeEnv;
      const { db } = await import("@/lib/server/db");

      // Identity of the delegate object is what proves a shared client: two
      // clients would each build their own `supportTicket` delegate, and a
      // batch mixing them could never share a transaction.
      expect(db.supportTicket).toBe(db.supportTicket);
      expect(db.supportTicketMessage).toBe(db.supportTicketMessage);
      expect(db.$transaction).toBe(db.$transaction);
    });
  },
);

it("does not construct a client merely by importing the module", async () => {
  env.NODE_ENV = "production";
  await import("@/lib/server/db");
  // `next build` imports every route with no DATABASE_URL available.
  expect(constructed.count).toBe(0);
});

it("reports a missing connection string instead of connecting to nothing", async () => {
  env.NODE_ENV = "production";
  delete process.env.DATABASE_URL;
  const originalDirect = process.env.DIRECT_URL;
  delete process.env.DIRECT_URL;

  const { db } = await import("@/lib/server/db");
  expect(() => db.supportTicket).toThrow(/DATABASE_URL/);

  if (originalDirect !== undefined) process.env.DIRECT_URL = originalDirect;
});
